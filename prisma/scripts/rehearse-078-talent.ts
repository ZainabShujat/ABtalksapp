/**
 * Production read-only ENABLE_NEW_TALENT=true rehearsal.
 * Sets the flag in-process only. Does not write. Requires
 * PHASE2_ALLOW_PRODUCTION=1 and the Neon direct production host.
 */
import { config } from "dotenv";
import { Domain } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertChildBranch } from "./migrate-078-shared";
import { toPublicMatch } from "@/features/hire/to-public-match";
import { searchCandidates as searchHire } from "@/features/hire/search-candidates";
import { evaluateHardFilters } from "@/features/hire/score-candidate";
import { memberEligibilityWhere } from "@/features/hire/pool-policy";
import { getPublishedCohort } from "@/features/talent-pool/pool";
import {
  listChallengeCandidates,
  listHackathonCandidates,
  listProgramCandidates,
  listQuizAggregates,
} from "@/repositories/hire";
import {
  searchCandidates as searchTalentRepo,
  searchableUserWhere,
} from "@/repositories/talent";

config({ path: ".env.local" });
config();

const PRIVATE_KEYS = new Set(["email", "phone", "resumeUrl"]);

function log(label: string, value: unknown): void {
  process.stdout.write(
    `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}\n`,
  );
}

function findPrivateKeys(value: unknown, path: string, hits: string[]): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => findPrivateKeys(item, `${path}[${i}]`, hits));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = path ? `${path}.${key}` : key;
    if (PRIVATE_KEYS.has(key) && child != null && child !== "") {
      hits.push(`${next}=${typeof child === "string" ? child.slice(0, 48) : String(child)}`);
    }
    findPrivateKeys(child, next, hits);
  }
}

function collectKeys(value: unknown, keys: Set<string>): void {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectKeys(child, keys);
  }
}

function interviewHasDetail(
  interview: unknown,
): boolean {
  if (interview == null) return false;
  if (typeof interview !== "object") return false;
  const row = interview as Record<string, unknown>;
  return (
    row.overall != null ||
    row.overallScore != null ||
    row.comm != null ||
    row.commScore != null ||
    row.tech != null ||
    row.techScore != null ||
    row.problem != null ||
    row.problemScore != null ||
    row.summary != null
  );
}

async function main() {
  assertChildBranch();
  const failures: string[] = [];
  const fail = (msg: string) => {
    failures.push(msg);
    console.error(`FAIL: ${msg}`);
  };

  process.env.ENABLE_NEW_TALENT = "true";
  log("in_process_ENABLE_NEW_TALENT", process.env.ENABLE_NEW_TALENT);
  log("vercel_env_untouched", true);

  const [searchable, withdrawn, notOpen, visFlags] = await Promise.all([
    prisma.user.findMany({
      where: searchableUserWhere(),
      select: { id: true },
    }),
    prisma.candidateVisibility.findMany({
      where: { withdrawnAt: { not: null } },
      select: { userId: true },
    }),
    prisma.candidatePreference.findMany({
      where: { openToWork: false },
      select: { userId: true },
    }),
    prisma.candidateVisibility.findMany({
      select: {
        userId: true,
        searchableByRecruiters: true,
        withdrawnAt: true,
        showInterviewResults: true,
        showAssessmentScores: true,
      },
    }),
  ]);
  const searchableIds = new Set(searchable.map((u) => u.id));
  const withdrawnIds = new Set(withdrawn.map((v) => v.userId));
  const notOpenIds = new Set(notOpen.map((p) => p.userId));
  const visByUser = new Map(visFlags.map((v) => [v.userId, v]));
  log("ground_truth", {
    searchable: searchableIds.size,
    withdrawn: withdrawnIds.size,
    openToWork_false: notOpenIds.size,
  });

  process.env.ENABLE_NEW_TALENT = "false";
  const legacyProgram = await listProgramCandidates({
    status: { in: ["ENROLLED", "COMPLETED"] },
  });
  process.env.ENABLE_NEW_TALENT = "true";
  const programRows = await listProgramCandidates({
    status: { in: ["ENROLLED", "COMPLETED"] },
  });
  const challengeRows = await listChallengeCandidates([
    Domain.CLAUDE,
    Domain.SE,
    Domain.DS,
    Domain.AI,
  ]);
  const hackathonRows = await listHackathonCandidates();

  const legacyProgramIds = new Set(legacyProgram.map((r) => r.userId));
  const programIds = new Set(programRows.map((r) => r.userId));
  log("pool_sizes", {
    program_flag_off: legacyProgram.length,
    program_flag_on: programRows.length,
    challenge: challengeRows.length,
    hackathon: hackathonRows.length,
  });
  if (legacyProgramIds.size !== programIds.size) {
    fail(
      `program pool size changed off=${legacyProgramIds.size} on=${programIds.size}`,
    );
  }
  for (const id of programIds) {
    if (!legacyProgramIds.has(id)) fail(`program flag-ON added ${id}`);
  }
  for (const id of legacyProgramIds) {
    if (!programIds.has(id)) fail(`program flag-ON lost ${id}`);
  }

  const allRows = [
    ...programRows.map((r) => ({ kind: "program", userId: r.userId, row: r })),
    ...challengeRows.map((r) => ({
      kind: "challenge",
      userId: r.userId,
      row: r,
    })),
    ...hackathonRows.map((r) => ({
      kind: "hackathon",
      userId: r.userId,
      row: r,
    })),
  ];

  for (const item of allRows) {
    if (!searchableIds.has(item.userId)) {
      fail(`${item.kind} leaked non-searchable ${item.userId}`);
    }
    if (withdrawnIds.has(item.userId)) {
      fail(`${item.kind} leaked withdrawn ${item.userId}`);
    }
    const vis = visByUser.get(item.userId);
    if (!vis || vis.searchableByRecruiters !== true || vis.withdrawnAt) {
      fail(`${item.kind} missing CandidateVisibility permission ${item.userId}`);
    }
    const privateHits: string[] = [];
    findPrivateKeys(item.row, item.kind, privateHits);
    for (const hit of privateHits) fail(`private field ${hit}`);
  }

  const notOpenInProgram = programRows.filter((r) => notOpenIds.has(r.userId));
  log("openToWork_false_still_in_program_pool", notOpenInProgram.length);
  if (notOpenInProgram.length === 0 && notOpenIds.size > 0) {
    const overlap = [...notOpenIds].filter((id) => searchableIds.has(id));
    if (overlap.some((id) => programIds.has(id) === false)) {
      // Only fail if a searchable ProgramMember with openToWork=false vanished.
      const searchableNotOpenMembers = programRows.length;
      log("openToWork_false_searchable_members_in_pool", searchableNotOpenMembers);
    }
  }
  const vanishedNotOpen = [...notOpenIds].filter(
    (id) => searchableIds.has(id) && legacyProgramIds.has(id) && !programIds.has(id),
  );
  if (vanishedNotOpen.length > 0) {
    fail(`openToWork=false dropped from pool: ${vanishedNotOpen.join(",")}`);
  }

  const talentUnfiltered = await searchTalentRepo(
    { userId: "rehearse", recruiterProfileId: "rehearse", organizationIds: [] },
    { page: 1, pageSize: 50 },
  );
  const talentOpenOnly = await searchTalentRepo(
    { userId: "rehearse", recruiterProfileId: "rehearse", organizationIds: [] },
    { page: 1, pageSize: 50, openToWork: true },
  );
  for (const row of talentUnfiltered.rows) {
    if (!searchableIds.has(row.userId)) {
      fail(`talent.search leaked ${row.userId}`);
    }
    if (withdrawnIds.has(row.userId)) {
      fail(`talent.search included withdrawn ${row.userId}`);
    }
    const privateHits: string[] = [];
    findPrivateKeys(row, "talent.search", privateHits);
    for (const hit of privateHits) fail(`private field ${hit}`);
  }
  const notOpenInUnfiltered = talentUnfiltered.rows.filter((r) =>
    notOpenIds.has(r.userId),
  );
  const notOpenInOpenOnly = talentOpenOnly.rows.filter((r) =>
    notOpenIds.has(r.userId),
  );
  log("talent_search_openToWork", {
    unfiltered_total: talentUnfiltered.total,
    unfiltered_not_open_on_page: notOpenInUnfiltered.length,
    openOnly_total: talentOpenOnly.total,
    openOnly_not_open_on_page: notOpenInOpenOnly.length,
  });
  if (notOpenInOpenOnly.length > 0) {
    fail("openToWork=true filter still returned openToWork=false rows");
  }

  const skill = await prisma.skill.findFirst({
    where: { candidateSkills: { some: { profile: { user: searchableUserWhere() } } } },
    select: { id: true, name: true },
  });
  if (skill) {
    const skillHits = await searchTalentRepo(
      { userId: "rehearse", recruiterProfileId: "rehearse", organizationIds: [] },
      { page: 1, pageSize: 25, skillIds: [skill.id] },
    );
    log("filter_skill", {
      skill: skill.name,
      total: skillHits.total,
      page: skillHits.rows.length,
    });
    for (const row of skillHits.rows) {
      if (!searchableIds.has(row.userId)) fail(`skill filter leaked ${row.userId}`);
    }
  }

  const located = await prisma.candidatePreference.findFirst({
    where: {
      preferredLocations: { isEmpty: false },
      profile: { user: searchableUserWhere() },
    },
    select: { userId: true, preferredLocations: true },
  });
  if (located?.preferredLocations[0]) {
    const city = located.preferredLocations[0];
    const locHits = await searchTalentRepo(
      { userId: "rehearse", recruiterProfileId: "rehearse", organizationIds: [] },
      { page: 1, pageSize: 25, locationCity: city },
    );
    log("filter_location", { city, total: locHits.total });
    for (const row of locHits.rows) {
      if (!searchableIds.has(row.userId)) fail(`location filter leaked ${row.userId}`);
    }
  }

  const edu = await prisma.candidateEducation.findFirst({
    where: {
      graduationYear: { not: null },
      profile: { user: searchableUserWhere() },
    },
    select: { graduationYear: true },
  });
  if (edu?.graduationYear) {
    const eduHits = await searchTalentRepo(
      { userId: "rehearse", recruiterProfileId: "rehearse", organizationIds: [] },
      {
        page: 1,
        pageSize: 25,
        graduationYearFrom: edu.graduationYear,
        graduationYearTo: edu.graduationYear,
      },
    );
    log("filter_graduationYear", {
      year: edu.graduationYear,
      total: eduHits.total,
    });
  }

  const cohorts = await prisma.programCohort.findMany({
    select: { id: true, resultsPublishedAt: true },
  });
  const openIds = process.env.HIRE_OPEN_COHORT_IDS?.trim() || null;
  const hireCohortIds =
    openIds?.toLowerCase() === "all"
      ? cohorts.map((c) => c.id)
      : openIds
        ? openIds.split(",").map((s) => s.trim()).filter(Boolean)
        : cohorts.filter((c) => c.resultsPublishedAt).map((c) => c.id);
  log("hire_cohort_scope", {
    HIRE_OPEN_COHORT_IDS: openIds,
    HIRE_CHALLENGE_POOL: process.env.HIRE_CHALLENGE_POOL ?? null,
    resolved: hireCohortIds.length,
  });

  if (hireCohortIds.length > 0) {
    const scoped = await listProgramCandidates(
      memberEligibilityWhere(hireCohortIds),
    );
    log("hire_scoped_program", scoped.length);
    for (const row of scoped) {
      if (!searchableIds.has(row.userId)) fail(`hire scoped leaked ${row.userId}`);
    }
  }

  const hireSearch = await searchHire({}, { limit: 20 });
  if (!hireSearch.ok) {
    log("hire_search_message", hireSearch.message);
  } else {
    log("hire_search", {
      matches: hireSearch.data.matches.length,
      nearMisses: hireSearch.data.nearMisses.length,
      totalEligible: hireSearch.data.totalEligible,
      cohortName: hireSearch.data.cohortName,
      stage: hireSearch.data.stage,
    });
    const cards = hireSearch.data.matches.map((m) => toPublicMatch(m));
    for (const match of [...hireSearch.data.matches, ...hireSearch.data.nearMisses]) {
      if (match.userId && !searchableIds.has(match.userId)) {
        fail(`hire search leaked ${match.userId}`);
      }
      if (match.userId && withdrawnIds.has(match.userId)) {
        fail(`hire search included withdrawn ${match.userId}`);
      }
      const vis = match.userId ? visByUser.get(match.userId) : undefined;
      if (vis && vis.showInterviewResults !== true) {
        if (interviewHasDetail(match.dossier?.evidence.interview.value)) {
          fail(`interview leaked for ${match.userId}`);
        }
      }
      if (vis && vis.showAssessmentScores !== true) {
        const quiz = match.dossier?.evidence.quizAverage?.value;
        if (typeof quiz === "number") fail(`quiz leaked for ${match.userId}`);
      }
      if (match.hardFilterReasons.includes("Not open to work")) {
        fail(`openToWork=false hard-filtered without recruiter request ${match.userId}`);
      }
      if (match.dossier?.availability?.openToWork === false) {
        const requested = evaluateHardFilters(
          {
            id: match.userId,
            userId: match.userId,
            fullName: "",
            jobRole: "",
            company: "",
            yearsExperience: 0,
            skills: [],
            missionPoints: 0,
            missionsPassed: 0,
            missionsAttempted: 0,
            cleanPassCount: 0,
            totalScore: 0,
            commitDayCount: 0,
            projectScores: [],
            interview: null,
            hasVisibilityConsent: true,
            cohortPublished: true,
            status: "ENROLLED",
            availability: match.dossier.availability,
            cohortDay: 1,
          },
          { extra: { openToWork: true } },
        );
        if (requested.ok || !requested.reasons.includes("Not open to work")) {
          fail(`explicit openToWork filter did not exclude ${match.userId}`);
        }
      }
    }
    for (const card of cards) {
      const privateHits: string[] = [];
      findPrivateKeys(card, "publicMatch", privateHits);
      for (const hit of privateHits) fail(`public match private ${hit}`);
    }
  }

  const quizUsers = challengeRows.map((r) => r.userId);
  const quiz = await listQuizAggregates(quizUsers);
  const quizByUser = new Map(quiz.map((q) => [q.userId, q]));
  let quizHidden = 0;
  let quizShown = 0;
  for (const row of challengeRows) {
    const vis = visByUser.get(row.userId);
    const agg = quizByUser.get(row.userId);
    if (vis?.showAssessmentScores !== true) {
      quizHidden += 1;
      if (
        row.recruiterIdentity.showAssessmentScores &&
        agg &&
        agg._count > 0 &&
        agg._avg.score != null
      ) {
        fail(`showAssessmentScores identity true while vis false ${row.userId}`);
      }
    } else {
      quizShown += 1;
    }
  }
  log("quiz_visibility", { hidden_flag: quizHidden, shown_flag: quizShown });

  let interviewHidden = 0;
  let interviewShown = 0;
  let interviewLeaked = 0;
  for (const row of programRows) {
    const vis = visByUser.get(row.userId);
    if (vis?.showInterviewResults !== true) {
      interviewHidden += 1;
      if (interviewHasDetail(row.interview)) {
        interviewLeaked += 1;
        fail(`interview detail present without showInterviewResults ${row.userId}`);
      }
    } else {
      interviewShown += 1;
    }
  }
  log("interview_visibility", {
    hidden_flag: interviewHidden,
    shown_flag: interviewShown,
    leaked: interviewLeaked,
  });

  const published = await getPublishedCohort();
  log("talent_published_cohort", published);
  if (published) {
    const talentMembers = await prisma.programMember.findMany({
      where: {
        cohortId: published.id,
        status: { in: ["ENROLLED", "COMPLETED"] },
        user: searchableUserWhere(),
      },
      select: { id: true, userId: true, recruiterVisibilityConsentAt: true },
    });
    const consentOnly = await prisma.programMember.findMany({
      where: {
        cohortId: published.id,
        status: { in: ["ENROLLED", "COMPLETED"] },
        recruiterVisibilityConsentAt: { not: null },
      },
      select: { userId: true },
    });
    log("talent_cohort_scope", {
      searchable_in_published: talentMembers.length,
      consent_column_in_published: consentOnly.length,
    });
    for (const m of talentMembers) {
      if (!searchableIds.has(m.userId)) fail(`talent cohort leaked ${m.userId}`);
      if (withdrawnIds.has(m.userId)) fail(`talent cohort withdrawn ${m.userId}`);
    }
    const usedConsentAsGate = talentMembers.some(
      (m) => m.recruiterVisibilityConsentAt == null,
    );
    log("talent_includes_searchable_without_consent_column", usedConsentAsGate);
  } else {
    log("talent_scope", "no published cohort — /talent correctly closed");
  }

  const pmSkills = await prisma.programMember.findMany({
    where: {
      status: { in: ["ENROLLED", "COMPLETED"] },
      user: searchableUserWhere(),
    },
    select: { userId: true, skills: true, education: true, yearsExperience: true },
  });
  const newSkills = await prisma.candidateSkill.groupBy({
    by: ["userId"],
    where: { userId: { in: pmSkills.map((m) => m.userId) } },
    _count: { _all: true },
  });
  const newEdu = await prisma.candidateEducation.groupBy({
    by: ["userId"],
    where: { userId: { in: pmSkills.map((m) => m.userId) } },
    _count: { _all: true },
  });
  const newExp = await prisma.candidateExperience.groupBy({
    by: ["userId"],
    where: { userId: { in: pmSkills.map((m) => m.userId) } },
    _count: { _all: true },
  });
  const skillCount = new Map(newSkills.map((s) => [s.userId, s._count._all]));
  const eduCount = new Map(newEdu.map((s) => [s.userId, s._count._all]));
  const expCount = new Map(newExp.map((s) => [s.userId, s._count._all]));
  const overlayEmpty = {
    skills_legacy_nonempty_new_empty: 0,
    education_legacy_nonempty_new_empty: 0,
    experience_legacy_nonempty_new_empty: 0,
  };
  for (const m of pmSkills) {
    if ((m.skills?.length ?? 0) > 0 && (skillCount.get(m.userId) ?? 0) === 0) {
      overlayEmpty.skills_legacy_nonempty_new_empty += 1;
    }
    if (m.education && (eduCount.get(m.userId) ?? 0) === 0) {
      overlayEmpty.education_legacy_nonempty_new_empty += 1;
    }
    if (m.yearsExperience != null && (expCount.get(m.userId) ?? 0) === 0) {
      overlayEmpty.experience_legacy_nonempty_new_empty += 1;
    }
  }
  log("normalized_overlay_gaps", overlayEmpty);
  log("normalized_overlay_note", "gaps are field-empty fallbacks, not pool loss");

  const payloadKeys = new Set<string>();
  collectKeys(programRows, payloadKeys);
  collectKeys(challengeRows, payloadKeys);
  collectKeys(hackathonRows, payloadKeys);
  collectKeys(talentUnfiltered.rows, payloadKeys);
  collectKeys(hireSearch.ok ? hireSearch.data.matches : null, payloadKeys);
  if (payloadKeys.has("recruiterVisibilityConsentAt")) {
    fail("recruiterVisibilityConsentAt present in flag-ON payloads");
  }
  log("payload_has_consent_column", payloadKeys.has("recruiterVisibilityConsentAt"));

  log("preflip_failures", failures);
  if (failures.length > 0) {
    throw new Error(`TALENT rehearsal failed: ${JSON.stringify(failures)}`);
  }
  console.log("TALENT rehearsal: clean.");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
