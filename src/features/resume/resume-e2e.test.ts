/**
 * End-to-end résumé pipeline, on a real PDF.
 *
 * `fixtures/sample-resume.pdf` is a genuine text-based PDF built by
 * `scripts/build-resume-fixture.ts`. Every link on it is written the way links
 * actually appear on résumés — scheme-less, inline in prose, inside
 * parentheses, behind a "Repo:" label, as `http://`, and as bare label text
 * that is not a link at all.
 *
 * `fixtures/sample-resume.raw.json` is the model's RAW response to that exact
 * PDF, recorded by `scripts/capture-resume-fixture.ts` and replayed here. That
 * split is the point: the assertions run offline and deterministically, with no
 * API key, but the input is something the model genuinely produced rather than
 * a shape invented to make the normaliser look good.
 *
 * Set `RESUME_E2E_LIVE=1` (with `GEMINI_API_KEY`) to re-run the extraction
 * against the live model and assert the same invariants on today's output.
 * Set `RESUME_E2E_PRINT=1` to dump the before/after documents.
 *
 * Run: npm run test:resume:e2e
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateResumeBytes } from "@/features/resume/ingest";
import { normalizeParsedResume, looksLikeResume, allSkills } from "@/features/resume/normalize";
import { analyseResumeStrength } from "@/features/resume/strength";
import {
  RESUME_DOCUMENT_VERSION,
  readResumeDocument,
  resumeDocumentSchema,
} from "@/features/resume/document";
import { planResumeMerge } from "@/features/resume/merge/plan";
import { toResumeView } from "@/features/resume/view";
import type { CandidateDetail } from "@/repositories/candidate-detail";
import type { ParsedResume } from "@/features/resume/types";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

async function suite(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

const FIXTURES = join(process.cwd(), "src", "features", "resume", "fixtures");
const PDF_PATH = join(FIXTURES, "sample-resume.pdf");
const RAW_PATH = join(FIXTURES, "sample-resume.raw.json");

const EMPTY_PROFILE = {
  userId: "u1",
  fullName: "Asha Menon",
  headline: null,
  summary: null,
  primaryPersona: "STUDENT",
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
  education: [],
  experience: [],
  projects: [],
  certifications: [],
  skills: [],
  links: [],
  preference: null,
} as unknown as CandidateDetail;

/** The invariants that must hold whoever produced the document. */
function assertLinkInvariants(p: ParsedResume) {
  // Contact links: written scheme-less on the PDF, stored canonical.
  assert(
    p.linkedin === "https://www.linkedin.com/in/asha-menon",
    `linkedin: ${p.linkedin}`,
  );
  assert(p.github === "https://github.com/ashamenon", `github: ${p.github}`);
  assert(p.portfolio === "https://asha.dev", `portfolio: ${p.portfolio}`);

  const byName = (needle: string) =>
    p.projects.find((x) => (x.title ?? "").toLowerCase().includes(needle));

  // "Repo: https://..." + a bare host for the demo.
  const ledgerly = byName("ledgerly");
  assert(
    ledgerly?.github === "https://github.com/ashamenon/ledgerly",
    `ledgerly repo: ${ledgerly?.github}`,
  );
  assert(
    ledgerly?.demo === "https://ledgerly.vercel.app",
    `ledgerly demo: ${ledgerly?.demo}`,
  );

  // Bare github host, and an http:// demo that must come out https.
  const pulse = byName("pulse");
  assert(
    pulse?.github === "https://github.com/ashamenon/pulse",
    `pulse repo: ${pulse?.github}`,
  );
  assert(
    pulse?.demo === "https://pulse-demo.netlify.app",
    `pulse demo not upgraded to https: ${pulse?.demo}`,
  );

  // Links that appear only inline, inside parentheses, in the prose.
  const atlas = byName("atlas");
  assert(
    atlas?.github === "https://github.com/ashamenon/atlas",
    `atlas repo: ${atlas?.github}`,
  );
  assert(
    atlas?.demo === "https://atlas.pages.dev",
    `atlas demo: ${atlas?.demo}`,
  );

  // "GitHub | Live Demo" is label text, not a link. Neither may survive.
  const kettle = byName("kettle");
  assert(
    kettle?.github === null,
    `kettle turned label text into a repo URL: ${kettle?.github}`,
  );
  assert(
    kettle?.demo === null,
    `kettle turned label text into a demo URL: ${kettle?.demo}`,
  );
}

async function run() {
  const rawText = readFileSync(RAW_PATH, "utf8");
  const raw: unknown = JSON.parse(rawText);
  const normalized = normalizeParsedResume(raw);

  if (process.env.RESUME_E2E_PRINT === "1") {
    console.log("\n───── BEFORE normalisation (raw model output) ─────");
    console.log(rawText.trimEnd());
    console.log("\n───── AFTER normalisation (ParsedResume) ─────");
    console.log(JSON.stringify(normalized, null, 2));
    console.log();
  }

  console.log("\ningest");

  await suite("the fixture is a real, acceptable PDF", () => {
    const bytes = new Uint8Array(readFileSync(PDF_PATH));
    assert(bytes.length > 1000, `suspiciously small: ${bytes.length} bytes`);
    const result = validateResumeBytes(bytes, "sample-resume.pdf");
    assert(result.ok, `rejected: ${result.ok ? "" : result.message}`);
  });

  console.log("\nnormalisation");

  await suite("the recorded response is what the current prompt asks for", () => {
    // Guards the recording itself: if the schema changes and the fixture is not
    // re-recorded, every assertion below would be testing a stale shape.
    const keys = Object.keys(raw as Record<string, unknown>);
    for (const required of [
      "candidate_name",
      "linkedin",
      "github",
      "portfolio",
      "projects",
      "experience",
      "education",
    ]) {
      assert(keys.includes(required), `recording is missing ${required}`);
    }
  });

  await suite("links in every format normalise correctly", () => {
    assertLinkInvariants(normalized);
  });

  await suite("the whole document survives normalisation", () => {
    assert(normalized.candidateName === "Asha Menon", "name");
    assert(normalized.email === "asha.menon@example.com", "email");
    assert(normalized.experience.length === 2, `roles: ${normalized.experience.length}`);
    assert(normalized.projects.length === 4, `projects: ${normalized.projects.length}`);
    assert(normalized.education.length === 1, "education");
    assert(normalized.certifications.length === 1, "certifications");
    assert(allSkills(normalized).length >= 12, "skills");
    assert(looksLikeResume(normalized), "not recognised as a résumé");
  });

  await suite("the normalised document is storable and re-readable", () => {
    const stored = resumeDocumentSchema.parse(normalized);
    const readBack = readResumeDocument(stored, RESUME_DOCUMENT_VERSION);
    assert(readBack !== null, "stored document failed to read back");
    assert(
      JSON.stringify(readBack) === JSON.stringify(normalized),
      "a round-trip through storage changed the document",
    );
  });

  console.log("\nstrength");

  const analysis = analyseResumeStrength(normalized);

  await suite("a complete résumé scores in range and in the expected band", () => {
    assert(
      analysis.overallScore > 0 && analysis.overallScore <= 100,
      `overall: ${analysis.overallScore}`,
    );
    // This fixture has quantified bullets, dated roles, four projects with
    // links and a full contact block, so it must not land in the bottom band.
    assert(
      analysis.overallScore >= 55,
      `a strong résumé scored only ${analysis.overallScore}`,
    );
    assert(analysis.recommendations.length > 0, "no advice at all");
  });

  await suite("project links raise the experience & projects score", () => {
    const noLinks = normalizeParsedResume({
      ...(raw as Record<string, unknown>),
      projects: (raw as { projects: Record<string, unknown>[] }).projects.map((p) => ({
        ...p,
        github: null,
        demo: null,
        description: (p.description as string) ?? "",
        contributions: [],
      })),
    });
    assert(
      analysis.categories.experienceProjectStrength >
        analyseResumeStrength(noLinks).categories.experienceProjectStrength,
      "links made no difference to the projects score",
    );
  });

  console.log("\nmerge into an empty profile");

  const plan = planResumeMerge(normalized, EMPTY_PROFILE);

  await suite("every section of the résumé reaches the profile", () => {
    for (const section of [
      "basic",
      "links",
      "education",
      "experience",
      "projects",
      "certifications",
      "skills",
    ]) {
      assert(plan.sections.includes(section as never), `${section} not planned`);
    }
  });

  await suite("contact links land on the profile in canonical form", () => {
    assert(
      plan.links.linkedinUrl === "https://www.linkedin.com/in/asha-menon",
      `linkedin: ${plan.links.linkedinUrl}`,
    );
    // The profile stores a USERNAME, not a URL.
    assert(
      plan.links.githubUsername === "ashamenon",
      `github username: ${plan.links.githubUsername}`,
    );
    assert(plan.links.portfolioUrl === "https://asha.dev", "portfolio");
  });

  await suite("project repo and demo links are carried onto project rows", () => {
    const ledgerly = plan.projects.create.find((p) =>
      p.title.toLowerCase().includes("ledgerly"),
    );
    assert(
      ledgerly?.repoUrl === "https://github.com/ashamenon/ledgerly",
      `repoUrl: ${ledgerly?.repoUrl}`,
    );
    assert(
      ledgerly?.liveUrl === "https://ledgerly.vercel.app",
      `liveUrl: ${ledgerly?.liveUrl}`,
    );
    const kettle = plan.projects.create.find((p) =>
      p.title.toLowerCase().includes("kettle"),
    );
    assert(
      kettle?.repoUrl === null && kettle?.liveUrl === null,
      "label text became a project link",
    );
  });

  await suite("the degree lands with the year they graduated, not started", () => {
    // The fixture PDF reads "2018 - 2022". Regression for the range bug.
    const edu = plan.education.create[0];
    assert(edu?.institutionName.includes("PES University") === true, "institution");
    assert(edu?.graduationYear === 2022, `graduationYear: ${edu?.graduationYear}`);
    assert(edu?.grade === "8.7/10", `grade: ${edu?.grade}`);
    assert(edu?.fieldOfStudy === "Computer Science", "field of study");
  });

  await suite("dated roles become experience rows, undated ones are skipped", () => {
    assert(plan.experience.create.length === 2, `roles: ${plan.experience.create.length}`);
    const current = plan.experience.create.find((e) => e.isCurrent);
    assert(current?.companyName.includes("Nimbus") === true, "current role");
    assert(current?.startedOn.getUTCFullYear() === 2023, "start year");
    assert(current?.startedOn.getUTCMonth() === 2, "March is month index 2");
    const past = plan.experience.create.find((e) => !e.isCurrent);
    assert(past?.endedOn?.getUTCFullYear() === 2023, "end year");
  });

  await suite("bullets arrive on the experience rows", () => {
    const current = plan.experience.create.find((e) => e.isCurrent);
    assert(current?.description?.includes("40,000 events") === true, "bullet text");
    assert((current?.description?.match(/•/g) ?? []).length === 3, "bullet count");
  });

  console.log("\nre-upload of the same résumé");

  await suite("merging the result again plans no further change", () => {
    // The profile as it stands after the merge above.
    const after = {
      ...EMPTY_PROFILE,
      headline: plan.basic.headline ?? null,
      summary: plan.basic.summary ?? null,
      locationCity: plan.basic.locationCity ?? null,
      linkedinUrl: plan.links.linkedinUrl ?? null,
      githubUsername: plan.links.githubUsername ?? null,
      portfolioUrl: plan.links.portfolioUrl ?? null,
      education: plan.education.create.map((e, i) => ({ id: `e${i}`, ...e })),
      experience: plan.experience.create.map((e, i) => ({
        id: `x${i}`,
        companyName: e.companyName,
        title: e.title,
        employmentType: e.employmentType,
        locationCity: null,
        startMonth: e.startedOn.getUTCMonth() + 1,
        startYear: e.startedOn.getUTCFullYear(),
        endMonth: e.endedOn ? e.endedOn.getUTCMonth() + 1 : null,
        endYear: e.endedOn?.getUTCFullYear() ?? null,
        isCurrent: e.isCurrent,
        totalMonths: 0,
        description: e.description,
      })),
      projects: plan.projects.create.map((p, i) => ({ id: `p${i}`, ...p })),
      certifications: plan.certifications.create.map((c, i) => ({
        id: `c${i}`,
        ...c,
        issuedMonth: null,
        issuedYear: null,
        expiresMonth: null,
        expiresYear: null,
        credentialUrl: null,
      })),
      // Skills resolve through the catalogue at write time; assume all claimed.
      skills: plan.skillNames.map((n) => ({ name: n, slug: n.toLowerCase() })),
    } as unknown as CandidateDetail;

    const second = planResumeMerge(normalized, after);
    assert(second.education.create.length === 0, "would duplicate education");
    assert(second.experience.create.length === 0, "would duplicate experience");
    assert(second.projects.create.length === 0, "would duplicate projects");
    assert(second.certifications.create.length === 0, "would duplicate certifications");
    assert(second.experience.update.length === 0, "would rewrite experience");
    assert(second.projects.update.length === 0, "would rewrite projects");
    assert(Object.keys(second.basic).length === 0, "would rewrite a scalar");
    assert(Object.keys(second.links).length === 0, "would rewrite a link");
    assert(second.skillNames.length === 0, "would re-claim skills");
  });

  console.log("\nwhat the candidate sees");

  await suite("the view carries the score and no copy of the document", () => {
    const view = toResumeView({
      sourceType: "UPLOAD",
      sourceUrl: null,
      blobPathname: "resumes/u1/hash.pdf",
      fileName: "sample-resume.pdf",
      status: "READY",
      failureReason: null,
      parsedData: normalized,
      analysis,
      appliedSections: plan.sections,
      updatedAt: new Date("2026-09-02T12:00:00Z"),
    });

    assert(view.status === "READY", "status");
    assert(view.strength?.overallScore === analysis.overallScore, "score");
    // The candidate-facing shape is intentionally narrow: score, band, tips.
    assert((view.strength?.band.length ?? 0) > 0, "band");
    assert(
      (view.strength?.tips.length ?? 0) <= 3,
      `tips: ${view.strength?.tips.length}`,
    );
    assert(
      !("categories" in (view.strength ?? {})),
      "per-category scores crossed to the client",
    );
    assert(view.addedToProfile.length === 7, `sections: ${view.addedToProfile.length}`);

    const serialised = JSON.stringify(view);
    for (const leaked of [
      "Asha Menon",
      "asha.menon@example.com",
      "98450",
      "Nimbus",
      "PES University",
      "Ledgerly",
      "github.com/ashamenon",
      "resumes/u1",
      "candidate_name",
    ]) {
      assert(!serialised.includes(leaked), `the view leaked ${leaked}`);
    }
  });

  /* ─── Optional: re-run against the live model ──────────────────────────── */

  if (process.env.RESUME_E2E_LIVE === "1") {
    console.log("\nlive extraction");
    await suite("today's model output satisfies the same link invariants", async () => {
      // Only the live branch needs an API key, so the env files are loaded only
      // here — the offline run stays a pure function test with no I/O but the
      // two fixture reads.
      const { config } = await import("dotenv");
      config({ path: ".env.local" });
      config();

      const { parseResumeDocument } = await import("@/features/resume/parse");
      const bytes = new Uint8Array(readFileSync(PDF_PATH));
      const result = await parseResumeDocument({
        bytes,
        mimeType: "application/pdf",
        fileName: "sample-resume.pdf",
      });
      assert(result.ok, `extraction failed: ${result.ok ? "" : result.message}`);
      if (!result.ok) return;
      if (process.env.RESUME_E2E_PRINT === "1") {
        console.log(JSON.stringify(result.data, null, 2));
      }
      assertLinkInvariants(result.data);
      assert(looksLikeResume(result.data), "live output not recognised as a résumé");
    });
  } else {
    console.log("\n  (live extraction skipped — set RESUME_E2E_LIVE=1 to include it)");
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void run();
