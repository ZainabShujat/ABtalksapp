/**
 * Detailed candidate profile — Slice 1.
 *
 * Pure-function checks plus source assertions on the invariants that are
 * expensive to get wrong: skill claims must never destroy evidence, legacy
 * mirrors must never overwrite canonical data, and completeness must stay a UX
 * number with no authority over anything.
 *
 * Run: npm run test:profile
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CandidatePersona, GradeType, SkillProficiency } from "@prisma/client";
import { normalizeGithubUsername } from "@/lib/validations/candidate-profile";
import {
  pickPrimaryEducation,
  pickPrimaryExperience,
  toMonthDate,
  totalExperienceMonths,
} from "@/repositories/candidate-primary";
import { computeCompleteness } from "@/features/profile/completeness";
import type { CandidateDetail } from "@/repositories/candidate-detail";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

function suite(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

const root = process.cwd();
const source = (rel: string) => readFileSync(join(root, rel), "utf8");

/**
 * Source with comments stripped. Assertions about what the code does must not
 * pass or fail on prose — a doc comment explaining that a value is never read
 * would otherwise read as that value being used.
 */
function code(rel: string): string {
  const raw = source(rel);
  return rel.endsWith(".sql")
    ? raw.replace(/--.*$/gm, "")
    : raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/* ─── GitHub normalization ───────────────────────────────────────────────── */

suite("GitHub URL and handle both normalize to the handle", () => {
  assert(normalizeGithubUsername("https://github.com/foo") === "foo", "https url");
  assert(normalizeGithubUsername("foo") === "foo", "bare handle");
  assert(normalizeGithubUsername("github.com/foo") === "foo", "no protocol");
  assert(
    normalizeGithubUsername("https://www.github.com/foo/") === "foo",
    "www + trailing slash",
  );
  assert(
    normalizeGithubUsername("https://github.com/foo?tab=repositories") === "foo",
    "query string dropped",
  );
  assert(
    normalizeGithubUsername("https://github.com/Sarthakgupta7") ===
      "Sarthakgupta7",
    "mixed case preserved",
  );
  assert(normalizeGithubUsername("@foo") === "foo", "at-prefixed");
  assert(normalizeGithubUsername("  foo  ") === "foo", "whitespace");
});

suite("GitHub normalization rejects what is not a handle", () => {
  assert(normalizeGithubUsername("") === null, "empty");
  assert(normalizeGithubUsername("   ") === null, "blank");
  assert(normalizeGithubUsername("https://github.com/") === null, "no segment");
  assert(normalizeGithubUsername("foo bar") === null, "space");
  assert(normalizeGithubUsername("-foo") === null, "leading hyphen");
  assert(normalizeGithubUsername("foo-") === null, "trailing hyphen");
  assert(normalizeGithubUsername("a".repeat(40)) === null, "too long");
});

/* ─── Primary education precedence ───────────────────────────────────────── */

const edu = (
  over: Partial<Parameters<typeof pickPrimaryEducation>[0][number]> & {
    name: string;
  },
) => ({
  isCurrent: false,
  startYear: null,
  startMonth: null,
  graduationYear: null,
  endMonth: null,
  sortOrder: 0,
  ...over,
});

suite("primary education: currently studying wins", () => {
  const rows = [
    edu({ name: "school", graduationYear: 2021, sortOrder: 0 }),
    edu({ name: "college", isCurrent: true, startYear: 2022, sortOrder: 1 }),
  ];
  assert(pickPrimaryEducation(rows)?.name === "college", "current row");
});

suite("primary education: latest start wins among several current rows", () => {
  const rows = [
    edu({ name: "older", isCurrent: true, startYear: 2022, startMonth: 8 }),
    edu({ name: "newer", isCurrent: true, startYear: 2024, startMonth: 1 }),
  ];
  assert(pickPrimaryEducation(rows)?.name === "newer", "latest start");
});

suite("primary education: falls back to the most recent end date", () => {
  const rows = [
    edu({ name: "school", graduationYear: 2019, endMonth: 5 }),
    edu({ name: "degree", graduationYear: 2023, endMonth: 6 }),
    edu({ name: "masters", graduationYear: 2023, endMonth: 12 }),
  ];
  assert(pickPrimaryEducation(rows)?.name === "masters", "latest end month");
});

suite("primary education: undated rows fall back to sortOrder", () => {
  const rows = [
    edu({ name: "second", sortOrder: 1 }),
    edu({ name: "first", sortOrder: 0 }),
  ];
  assert(pickPrimaryEducation(rows)?.name === "first", "lowest sortOrder");
  assert(pickPrimaryEducation([]) === null, "empty list");
});

/* ─── Primary experience precedence ──────────────────────────────────────── */

const exp = (
  over: Partial<Parameters<typeof pickPrimaryExperience>[0][number]> & {
    name: string;
  },
) => ({
  isCurrent: false,
  startMonth: 1,
  startYear: 2020,
  endMonth: null,
  endYear: null,
  ...over,
});

suite("primary experience: currently working wins", () => {
  const rows = [
    exp({ name: "past", startYear: 2019, endYear: 2021, endMonth: 6 }),
    exp({ name: "current", isCurrent: true, startYear: 2021, startMonth: 7 }),
  ];
  assert(pickPrimaryExperience(rows)?.name === "current", "current row");
});

suite("primary experience: otherwise the most recently ended", () => {
  const rows = [
    exp({ name: "intern-1", startYear: 2022, endYear: 2022, endMonth: 6 }),
    exp({ name: "intern-2", startYear: 2023, endYear: 2023, endMonth: 8 }),
  ];
  assert(pickPrimaryExperience(rows)?.name === "intern-2", "latest end");
  assert(pickPrimaryExperience([]) === null, "empty list");
});

/* ─── Merged experience duration ─────────────────────────────────────────── */

const NOW = new Date(Date.UTC(2026, 7, 31)); // 2026-08

suite("experience months are inclusive of both endpoints", () => {
  const one = totalExperienceMonths(
    [exp({ name: "x", startYear: 2024, startMonth: 1, endYear: 2024, endMonth: 1 })],
    NOW,
  );
  assert(one === 1, `single month should be 1, got ${one}`);

  const year = totalExperienceMonths(
    [exp({ name: "x", startYear: 2024, startMonth: 1, endYear: 2024, endMonth: 12 })],
    NOW,
  );
  assert(year === 12, `full year should be 12, got ${year}`);
});

suite("overlapping roles are not double counted", () => {
  const rows = [
    exp({ name: "a", startYear: 2024, startMonth: 1, endYear: 2024, endMonth: 12 }),
    exp({ name: "b", startYear: 2024, startMonth: 6, endYear: 2025, endMonth: 6 }),
  ];
  // Jan 2024 → Jun 2025 inclusive is 18 months; a naive sum would say 25.
  const merged = totalExperienceMonths(rows, NOW);
  assert(merged === 18, `expected 18, got ${merged}`);
});

suite("disjoint roles are summed, current roles run to today", () => {
  const gap = totalExperienceMonths(
    [
      exp({ name: "a", startYear: 2020, startMonth: 1, endYear: 2020, endMonth: 6 }),
      exp({ name: "b", startYear: 2023, startMonth: 1, endYear: 2023, endMonth: 6 }),
    ],
    NOW,
  );
  assert(gap === 12, `expected 12, got ${gap}`);

  const current = totalExperienceMonths(
    [exp({ name: "a", isCurrent: true, startYear: 2026, startMonth: 1 })],
    NOW,
  );
  assert(current === 8, `Jan→Aug 2026 should be 8, got ${current}`);
  assert(totalExperienceMonths([], NOW) === 0, "no rows");
});

suite("month packing lands on the first of the month, UTC", () => {
  const d = toMonthDate(2024, 3);
  assert(d.getUTCFullYear() === 2024, "year");
  assert(d.getUTCMonth() === 2, "zero-based month");
  assert(d.getUTCDate() === 1, "first of month");
});

/* ─── Skill ownership: the deletion bug must stay fixed ──────────────────── */

suite("legacy skill sync is additive — it can no longer delete claims", () => {
  const src = source("src/repositories/dual-write.ts");
  const fn = src.slice(
    src.indexOf("export async function syncCandidateSkillsFromLegacy"),
    src.indexOf("export async function syncProfileOwnedEducation"),
  );
  assert(fn.length > 0, "function located");
  assert(!fn.includes("candidateSkill.delete"), "no delete of skill rows");
  assert(!fn.includes("deleteMany"), "no bulk delete");
  assert(fn.includes("upsert"), "still mirrors declared skills");
  // Scenario from the brief: 15 canonical skills, 10 in the legacy array. The
  // legacy write must not touch the other 5.
  assert(
    !fn.includes("declaredIds"),
    "no set-difference pass that could prune canonical rows",
  );
});

suite("legacy skill sync does not overwrite the candidate's own rating", () => {
  const src = source("src/repositories/dual-write.ts");
  const fn = src.slice(
    src.indexOf("export async function syncCandidateSkillsFromLegacy"),
    src.indexOf("export async function syncProfileOwnedEducation"),
  );
  assert(fn.includes("update: {}"), "existing rows are left alone");
});

suite("removing a skill withdraws the claim but keeps the evidence", () => {
  const src = source("src/repositories/candidate-detail.ts");
  const fn = src.slice(src.indexOf("export async function saveSkillClaims"));
  assert(fn.includes("claimedByCandidate: false"), "claim withdrawn");
  assert(fn.includes("selfRated: null"), "rating cleared");
  assert(
    fn.includes("evidenceCount > 0 || row._count.evidence > 0"),
    "evidence-bearing rows are detected",
  );
  assert(fn.includes("keepIds"), "evidence-bearing rows are kept, not deleted");
  // SkillEvidence cascades off CandidateSkill: deleting the row destroys history.
  assert(
    fn.indexOf("keepIds.push") < fn.indexOf("dropIds.push"),
    "keeping is the first branch",
  );
});

suite("a deactivated catalog skill is left alone, not silently withdrawn", () => {
  const src = code("src/repositories/candidate-detail.ts");
  const fn = src.slice(src.indexOf("export async function saveSkillClaims"));
  // Withdrawal must key on what was submitted; keying on catalog validity would
  // un-claim a skill the candidate resubmits every time.
  assert(
    fn.includes("existing.filter((row) => !wanted.has(row.skillId))"),
    "withdrawal keys on the submitted set",
  );
  assert(
    !fn.includes("existing.filter((row) => !validIds.has(row.skillId))"),
    "not on catalog validity",
  );
});

suite("only the detailed profile may remove skill claims", () => {
  const detail = source("src/repositories/candidate-detail.ts");
  const dualWrite = source("src/repositories/dual-write.ts");
  const deletesInDetail = detail.split("candidateSkill.deleteMany").length - 1;
  assert(deletesInDetail === 1, "exactly one deletion site");
  assert(
    !dualWrite.includes("candidateSkill.delete"),
    "the legacy path has none",
  );
});

/* ─── Multi-row education / experience ───────────────────────────────────── */

suite("the identity view no longer filters to the migration singletons", () => {
  const src = source("src/repositories/candidate.ts");
  assert(
    !src.includes('startsWith: "edu_sp_"'),
    "education id filter removed",
  );
  assert(
    !src.includes('startsWith: "exp_sp_"'),
    "experience id filter removed",
  );
  assert(src.includes("pickPrimaryEducation"), "uses the precedence rule");
  assert(src.includes("pickPrimaryExperience"), "uses the precedence rule");
});

suite("the detailed read returns whole arrays, not one row", () => {
  const src = source("src/repositories/candidate-detail.ts");
  const fn = src.slice(
    src.indexOf("export async function getCandidateDetail"),
    src.indexOf("/* ─── Legacy compatibility mirrors"),
  );
  for (const rel of ["education", "experience", "projects", "certifications", "links"]) {
    assert(fn.includes(`${rel}: {`), `${rel} selected`);
  }
  assert(!fn.includes("edu_sp_"), "no singleton filter");
  assert(!fn.includes("take: 1"), "no implicit single row");
});

suite("saving a section replaces the list, clearing the migration rows", () => {
  const src = source("src/repositories/candidate-detail.ts");
  for (const model of [
    "candidateEducation",
    "candidateExperience",
    "candidateProjectEntry",
    "candidateCertification",
    "candidateLink",
  ]) {
    assert(
      src.includes(`tx.${model}.deleteMany({ where: { userId } })`),
      `${model} replaced wholesale`,
    );
  }
});

suite("a legacy form cannot overwrite candidate-authored history", () => {
  const src = source("src/repositories/dual-write.ts");
  assert(
    src.includes("if (await hasCandidateAuthoredEducation(tx, userId)) return;"),
    "education guard",
  );
  assert(
    src.includes("if (await hasCandidateAuthoredExperience(tx, userId)) return;"),
    "experience guard",
  );
});

/* ─── Legacy mirroring direction ─────────────────────────────────────────── */

suite("mirrors run canonical → legacy and use the primary row", () => {
  const src = source("src/repositories/candidate-detail.ts");
  assert(
    src.includes("pickPrimaryEducation(rows)"),
    "education mirror picks the primary row",
  );
  assert(
    src.includes("pickPrimaryExperience(shaped)"),
    "experience mirror picks the primary row",
  );
  // The mirror writes college/collegeId/graduationYear and never reads them back.
  const mirror = src.slice(
    src.indexOf("async function mirrorEducationToLegacy"),
    src.indexOf("async function mirrorExperienceToLegacy"),
  );
  assert(mirror.includes("studentProfile.updateMany"), "writes the legacy row");
  assert(
    !mirror.includes("studentProfile.findUnique"),
    "never reads legacy as a source",
  );
});

suite("emptying a section clears the legacy mirror rather than leaving it stale", () => {
  const src = code("src/repositories/candidate-detail.ts");
  const edu = src.slice(
    src.indexOf("async function mirrorEducationToLegacy"),
    src.indexOf("async function mirrorExperienceToLegacy"),
  );
  assert(edu.includes("primary?.institutionName ?? null"), "college cleared");
  assert(edu.includes("primary?.graduationYear ?? null"), "grad year cleared");
  assert(!edu.includes("if (!primary) return;"), "no early return on empty");

  const exp = src.slice(src.indexOf("async function mirrorExperienceToLegacy"));
  const body = exp.slice(0, exp.indexOf("async function mirrorSkillsToLegacy"));
  assert(body.includes("primary?.companyName ?? null"), "organization cleared");
  assert(!body.includes("if (rows.length === 0) return;"), "no early return");
});

suite("basic info writes only its own fields and never domain", () => {
  const src = source("src/repositories/candidate-detail.ts");
  const fn = src.slice(
    src.indexOf("export async function saveBasicInfo"),
    src.indexOf("export type EducationWrite"),
  );
  assert(!fn.includes("domain"), "domain is never copied into CandidateProfile");
  assert(!fn.includes("linkedinUrl"), "does not touch links");
  assert(!fn.includes("resumeUrl"), "does not touch resume");
  assert(!fn.includes("referralCode"), "does not re-mint referral code");
  assert(!fn.includes("phoneVerified"), "verification stays with the OTP flow");
});

suite("no section save clears richer canonical values it did not receive", () => {
  const src = source("src/repositories/candidate-detail.ts");
  // Each write names its own columns explicitly; nothing spreads a whole
  // StudentProfile row over CandidateProfile.
  assert(
    !src.includes("...sp,"),
    "no wholesale legacy spread into CandidateProfile",
  );
  assert(!src.includes("data: sp"), "no wholesale legacy assignment");
});

suite("referral code is never minted or rewritten by the profile editor", () => {
  const raw = source("src/repositories/candidate-detail.ts");
  // Reading the code to display a referral link is fine. What must never
  // happen is a write: no save path may set, rotate, or mint one.
  assert(raw.includes("referralCode: true"), "read as a select");
  const writes = raw
    .slice(raw.indexOf("export type BasicInfoWrite"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert(writes.length > 0, "write half located");
  assert(!writes.includes("referralCode"), "no save path touches the code");
  assert(!raw.includes("mintHireOnlyReferralCode"), "no second minting path");
  assert(raw.includes("ensureCandidateProfile"), "reuses the existing helper");
});

/* ─── Preferences vs visibility ──────────────────────────────────────────── */

suite("preferences never touch CandidateVisibility", () => {
  const src = source("src/repositories/candidate-detail.ts");
  assert(
    !src.includes("candidateVisibility"),
    "the profile editor cannot change recruiter discoverability",
  );
  assert(src.includes("candidatePreference.upsert"), "preferences still saved");
});

suite("evidence is read from real rows only", () => {
  const src = code("src/features/profile/get-evidence.ts");
  assert(src.includes("evidence: { some: {} }"), "verified means it has evidence");
  assert(src.includes("candidateAchievement"), "achievements are read");
  assert(src.includes("CredentialStatus.ISSUED"), "revoked credentials excluded");
  assert(!src.includes("selfRated"), "self-rating is never selected as evidence");
});

/* ─── Completeness ───────────────────────────────────────────────────────── */

function detailFixture(over: Partial<CandidateDetail> = {}): CandidateDetail {
  return {
    userId: "u1",
    fullName: "Test User",
    headline: null,
    summary: null,
    primaryPersona: CandidatePersona.STUDENT,
    phone: null,
    phoneVerified: false,
    locationCity: null,
    locationRegion: null,
    countryCode: null,
    linkedinUrl: null,
    githubUsername: null,
    portfolioUrl: null,
    resumeUrl: null,
    referralCode: "ABC123",
    isReadyForInterview: false,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    education: [],
    experience: [],
    projects: [],
    certifications: [],
    skills: [],
    links: [],
    preference: null,
    ...over,
  };
}

const skill = (id: string, claimed = true) => ({
  skillId: id,
  name: id,
  slug: id,
  categoryName: null,
  selfRated: SkillProficiency.INTERMEDIATE,
  claimedByCandidate: claimed,
  verified: false,
  evidenceScore: 0,
  evidenceCount: 0,
  lastEvidenceAt: null,
});

suite("completeness is deterministic and bounded", () => {
  const empty = computeCompleteness(detailFixture(), { hasAny: false });
  assert(empty.score === 0, `empty profile scores 0, got ${empty.score}`);

  const again = computeCompleteness(detailFixture(), { hasAny: false });
  assert(again.score === empty.score, "same input, same score");
  assert(empty.sections.length === 9, "every section reported");
});

suite("completeness reaches 100 without every optional section", () => {
  // A student with no employment and no external certifications.
  const student = computeCompleteness(
    detailFixture({
      headline: "Final-year CSE student",
      locationCity: "Bangalore",
      phoneVerified: true,
      education: [{ id: "e1" } as never],
      projects: [{ id: "p1" } as never],
      skills: [skill("a"), skill("b"), skill("c")],
      linkedinUrl: "https://linkedin.com/in/x",
      preference: {
        openToWork: false,
        preferredRoles: ["Backend Engineer"],
        preferredLocations: [],
        opportunityTypes: [],
        remotePreference: null,
        willingToRelocate: false,
        noticePeriodDays: null,
        availableFromMonth: null,
        availableFromYear: null,
      },
    }),
    { hasAny: false },
  );
  assert(student.score === 100, `student path should hit 100, got ${student.score}`);
  assert(
    student.sections.find((x) => x.key === "experience")?.complete === false,
    "experience still reported incomplete",
  );
  assert(
    student.sections.find((x) => x.key === "certifications")?.complete === false,
    "certifications still reported incomplete",
  );
});

suite("completeness ignores visibility and openToWork", () => {
  const base = detailFixture({
    headline: "x",
    locationCity: "y",
    preference: {
      openToWork: false,
      preferredRoles: ["Engineer"],
      preferredLocations: [],
      opportunityTypes: [],
      remotePreference: null,
      willingToRelocate: false,
      noticePeriodDays: null,
      availableFromMonth: null,
      availableFromYear: null,
    },
  });
  const notLooking = computeCompleteness(base, { hasAny: false });
  const looking = computeCompleteness(
    detailFixture({
      ...base,
      preference: { ...base.preference!, openToWork: true },
    }),
    { hasAny: false },
  );
  assert(
    notLooking.score === looking.score,
    "declaring you are open to work changes nothing",
  );
  assert(
    notLooking.sections.find((x) => x.key === "preferences")?.complete === true,
    "engaging with the section is enough",
  );

  const src = code("src/features/profile/completeness.ts");
  assert(!src.includes("searchableByRecruiters"), "no visibility input");
  assert(!src.includes("CandidateVisibility"), "visibility is not imported");
  assert(
    src.includes("evidence: { hasAny: boolean }"),
    "the only extra input is whether evidence exists",
  );
});

suite("withdrawn skill claims do not count toward completeness", () => {
  const result = computeCompleteness(
    detailFixture({ skills: [skill("a"), skill("b"), skill("c", false)] }),
    { hasAny: false },
  );
  assert(
    result.sections.find((x) => x.key === "skills")?.complete === false,
    "two live claims is under the threshold",
  );
});

suite("evidence is reported but never scored", () => {
  const without = computeCompleteness(detailFixture(), { hasAny: false });
  const with_ = computeCompleteness(detailFixture(), { hasAny: true });
  assert(without.score === with_.score, "evidence adds no points");
  assert(
    with_.sections.find((x) => x.key === "evidence")?.complete === true,
    "still reported",
  );
  assert(
    with_.sections.find((x) => x.key === "evidence")?.weight === 0,
    "zero weight",
  );
});

/* ─── Migration safety ───────────────────────────────────────────────────── */

suite("the migration is additive and drops nothing", () => {
  const sql = code(
    "prisma/migrations/20260831120000_candidate_profile_detail/migration.sql",
  );
  assert(!/\bDROP\b/i.test(sql), "no DROP");
  assert(!/\bALTER COLUMN\b/i.test(sql), "no column rewrites");
  // "ON DELETE CASCADE" is a constraint clause, not a data deletion.
  assert(!/\bDELETE\s+FROM\b/i.test(sql), "no data deletion");
  assert(!/\bTRUNCATE\b/i.test(sql), "no truncation");
  // "ON UPDATE CASCADE" is a constraint clause, not a data rewrite.
  assert(!/\bUPDATE\s+\S+\s+SET\b/i.test(sql), "no data rewrites");
  assert(sql.includes('ADD COLUMN "startMonth"'), "education month precision");
  assert(sql.includes('ADD COLUMN "gradeType"'), "grade scale");
  assert(
    sql.includes('ADD COLUMN "claimedByCandidate" BOOLEAN NOT NULL DEFAULT true'),
    "existing claims stay claims",
  );
  assert(sql.includes('CREATE TABLE "CandidateLink"'), "link table");
});

suite("flags and dual-write are untouched by this slice", () => {
  const flags = source("src/lib/feature-flags.ts");
  assert(
    flags.includes('process.env.ENABLE_DUAL_WRITE === "true"'),
    "dual-write flag unchanged",
  );
  assert(
    flags.includes('process.env.ENABLE_NEW_CANDIDATE === "true"'),
    "candidate flag unchanged",
  );
  const runDualWrite = source("src/repositories/dual-write.ts");
  assert(runDualWrite.includes("export async function runDualWrite"), "still there");
});

suite("StudentProfile is still written, and still not the read source", () => {
  const src = source("src/repositories/candidate-detail.ts");
  const writes = src.split("studentProfile.updateMany").length - 1;
  assert(writes >= 4, `legacy mirrors still run, found ${writes}`);
  assert(
    !src.includes("studentProfile.findUnique"),
    "never read as a source of truth",
  );
  const page = source("src/app/profile/page.tsx");
  assert(page.includes("getCandidateDetail"), "page reads the canonical tables");
  assert(!page.includes("studentProfile"), "page does not read legacy");
});

/* ─── Grade type enum ────────────────────────────────────────────────────── */

suite("grade type covers the scales Indian institutions actually use", () => {
  const values = Object.values(GradeType);
  for (const v of ["PERCENTAGE", "CGPA_10", "GPA_4", "GRADE", "OTHER"]) {
    assert(values.includes(v as GradeType), `${v} present`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
