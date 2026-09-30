/**
 * The candidate-safe rewrite of the admin discoverability report. Run with:
 *   npm run test:recruiter-view
 *
 * No network, no database. Two things are pinned here:
 *
 *  1. The rule `candidate-discoverability.ts` states in its own header — a
 *     blocker in the deletion / account / moderation / index groups is "always
 *     something the platform or an admin did, never something the candidate
 *     chose, and this panel must never phrase one as a candidate decision." So
 *     every such gate collapses into ONE neutral row with no detail and no fix
 *     link, and no admin `action` string reaches the page.
 *  2. Every row a candidate CAN act on carries a real wizard step key, so a fix
 *     button can never point at a step that does not exist.
 *
 * These drive the real `evaluateDiscoverability` rather than hand-written check
 * arrays, so a new admin check cannot land on a candidate's page wearing admin
 * wording without one of these failing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateDiscoverability,
  type DiscoverabilityFacts,
} from "@/features/admin/candidate-discoverability";
import { toCandidateSafeChecks } from "@/features/profile/recruiter-view-checks";
import { recruiterVisibleName } from "@/features/profile/recruiter-view-name";

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

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const root = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(root, rel), "utf8"));

const ASSEMBLER = "src/features/profile/recruiter-view.ts";
const OWN_EVIDENCE = "src/features/hire/own-track-evidence.ts";
const PAGE = "src/app/profile/recruiter-view/page.tsx";
const SCREEN = "src/components/profile/recruiter-view/recruiter-view-screen.tsx";

const D = (iso: string) => new Date(iso);

/** A candidate with nothing wrong: usable profile, one track, gate clear. */
function healthy(): DiscoverabilityFacts {
  return {
    deletedAt: null,
    anonymizedAt: null,
    disabledAt: null,
    disabledReason: null,
    sessionInvalidatedAt: null,
    gate: { exists: true, searchableByRecruiters: true, withdrawnAt: null },
    passesSearchGate: true,
    profile: {
      exists: true,
      fullName: "Asha Menon",
      headline: "Frontend engineer",
      locationCity: "Bengaluru",
      countryCode: "IN",
      educationCount: 1,
      experienceCount: 1,
      hasNoWorkExperience: false,
    },
    skills: { claimed: 6, withEvidence: 0 },
    inProfilePool: true,
    profilePoolAhead: 12,
    profilePoolCap: 600,
    tracks: {
      challengeWithSubmissions: 1,
      programMemberships: 0,
      hackathonWithSubmission: 0,
    },
  };
}

function thinProfile(): DiscoverabilityFacts {
  const f = healthy();
  f.profile = {
    exists: true,
    fullName: "Asha Menon",
    headline: null,
    locationCity: null,
    countryCode: null,
    educationCount: 0,
    experienceCount: 0,
    hasNoWorkExperience: false,
  };
  return f;
}

function moderated(): DiscoverabilityFacts {
  const f = healthy();
  f.gate = { exists: true, searchableByRecruiters: false, withdrawnAt: null };
  f.passesSearchGate = false;
  f.inProfilePool = false;
  return f;
}

const view = (f: DiscoverabilityFacts) =>
  toCandidateSafeChecks(evaluateDiscoverability(f));

/* ── The verdict line ─────────────────────────────────────────────────────── */

suite("a complete, discoverable profile reads as clear with nothing to fix", () => {
  const out = view(healthy());
  assert(out.appears, "should appear");
  assert(!out.platformHold, "no platform hold expected");
  assert(
    out.headline ===
      "You are appearing in recruiter search, with nothing holding you back.",
    `unexpected headline: ${out.headline}`,
  );
  assert(
    out.rows.every((r) => r.tone === "ok"),
    "every row should be a tick",
  );
  assert(
    out.rows.every((r) => r.fixStep === null),
    "a clear profile must offer no fix links",
  );
});

suite("counts the narrowing conditions in the headline", () => {
  const f = healthy();
  f.profile = { ...f.profile, headline: null, locationCity: null, countryCode: null };
  const out = view(f);
  assert(out.appears, "still appears — these only narrow reach");
  assert(
    out.headline ===
      "You are appearing in recruiter search, but 2 things are narrowing who finds you.",
    `unexpected headline: ${out.headline}`,
  );
});

suite("one narrowing condition is phrased in the singular", () => {
  const f = healthy();
  f.profile = { ...f.profile, headline: null };
  const out = view(f);
  assert(
    out.headline ===
      "You are appearing in recruiter search, but one thing is narrowing who finds you.",
    `unexpected headline: ${out.headline}`,
  );
});

/* ── The platform row: the rule this file exists to enforce ───────────────── */

suite("collapses a moderation stop into one neutral row, no detail, no fix", () => {
  const out = view(moderated());
  assert(out.platformHold, "platform hold expected");
  assert(out.rows[0]?.id === "platform-hold", "platform row must be pinned first");
  assert(out.rows[0]?.fixStep === null, "platform row must offer no fix step");
  assert(out.rows[0]?.fixLabel === null, "platform row must offer no fix button");
  assert(
    out.headline ===
      "You are not appearing in recruiter search, and the reason is on ABTalks' side.",
    `unexpected headline: ${out.headline}`,
  );
});

suite("several platform gates at once still produce exactly one row", () => {
  const f = moderated();
  f.gate = {
    exists: true,
    searchableByRecruiters: false,
    withdrawnAt: D("2026-01-04T00:00:00Z"),
  };
  f.disabledAt = D("2026-01-02T00:00:00Z");
  const out = view(f);
  assert(
    out.rows.filter((r) => r.id === "platform-hold").length === 1,
    "exactly one platform row, however many gates are in force",
  );
});

suite("never phrases a platform gate as something the candidate did", () => {
  const f = moderated();
  f.gate = { exists: false, searchableByRecruiters: false, withdrawnAt: null };
  const out = view(f);
  const platform = out.rows.find((r) => r.id === "platform-hold");
  assert(Boolean(platform), "platform row expected");
  assert(/managed by ABTalks/i.test(platform!.detail), "must name ABTalks as owner");
  assert(
    /not something you can change/i.test(platform!.detail),
    "must say the candidate cannot change it",
  );
  // The admin wording for this gate talks about discovery records, backfills and
  // enrolment. None of that vocabulary may reach a candidate.
  for (const leak of [/discovery record/i, /backfill/i, /enrol/i, /admin/i]) {
    assert(!leak.test(platform!.detail), `platform row leaks ${leak}`);
  }
});

suite("leaks no admin action string onto the candidate's page", () => {
  const f = moderated();
  f.profile = {
    exists: false,
    fullName: "",
    headline: null,
    locationCity: null,
    countryCode: null,
    educationCount: 0,
    experienceCount: 0,
    hasNoWorkExperience: false,
  };
  f.skills = { claimed: 0, withEvidence: 0 };

  const admin = evaluateDiscoverability(f);
  const actions = admin.checks
    .map((c) => c.action)
    .filter((a): a is string => Boolean(a));
  assert(actions.length > 0, "the admin engine should emit action strings here");

  const shown = toCandidateSafeChecks(admin)
    .rows.map((r) => `${r.label} ${r.detail} ${r.fixLabel ?? ""}`)
    .join(" \u0000 ");
  for (const action of actions) {
    assert(!shown.includes(action), `admin action leaked verbatim: ${action}`);
  }
});

/* ── Candidate-fixable rows ───────────────────────────────────────────────── */

suite("every candidate-fixable gap carries a wizard step and a label", () => {
  const out = view(thinProfile());
  const gaps = out.rows.filter((r) => r.tone !== "ok");
  assert(gaps.length > 0, "thin profile should report gaps");
  for (const gap of gaps) {
    assert(gap.fixStep !== null, `${gap.id} has no fix step`);
    assert(Boolean(gap.fixLabel), `${gap.id} has no fix label`);
    assert(gap.detail.trim().length > 0, `${gap.id} has no detail`);
  }
  const steps = gaps.map((g) => g.fixStep);
  for (const want of ["basic", "education", "experience"]) {
    assert(steps.includes(want as never), `expected a ${want} fix among ${steps}`);
  }
});

suite("every fixStep is a real wizard step key on /profile", () => {
  // The keys `src/app/profile/page.tsx` builds its steps array from.
  const valid = new Set([
    "basic",
    "experience",
    "education",
    "projects",
    "skills",
    "accomplishments",
    "resume",
    "links",
    "preferences",
  ]);
  const f = thinProfile();
  f.profile = { ...f.profile, fullName: "" };
  f.skills = { claimed: 0, withEvidence: 0 };
  for (const row of view(f).rows) {
    if (row.fixStep) {
      assert(valid.has(row.fixStep), `${row.fixStep} is not a wizard step key`);
    }
  }
});

suite("puts gaps above ticks so the actionable rows are not buried", () => {
  const f = healthy();
  f.profile = { ...f.profile, headline: null };
  const rows = view(f).rows;
  const firstOk = rows.findIndex((r) => r.tone === "ok");
  const lastGap = rows.map((r) => r.tone).lastIndexOf("gap");
  assert(firstOk > -1 && lastGap > -1, "expected both ticks and gaps");
  assert(lastGap < firstOk, "gaps must sort above ticks");
});

suite("speaks in the second person, never about 'the candidate'", () => {
  const f = thinProfile();
  f.skills = { claimed: 0, withEvidence: 0 };
  for (const row of view(f).rows) {
    assert(
      !/\bthe candidate\b/i.test(row.detail),
      `${row.id} still reads like an admin note: ${row.detail}`,
    );
    assert(
      !/\bthis candidate\b/i.test(row.detail),
      `${row.id} still reads like an admin note: ${row.detail}`,
    );
  }
});

/* ── Dropped rows ─────────────────────────────────────────────────────────── */

suite("drops the skill-evidence check, which no candidate action can clear", () => {
  // `SkillEvidence` has had no live writer since the backfill (CLAUDE.md, verified
  // 2026-09-04; P0-0 in plan 112). Telling a candidate to earn evidence would be
  // advice that cannot work, so the row must not appear at all.
  const admin = evaluateDiscoverability(healthy());
  assert(
    admin.checks.some((c) => c.id === "skills-evidence"),
    "the admin engine should still emit skills-evidence",
  );
  assert(
    !toCandidateSafeChecks(admin).rows.some((r) => r.id === "skills-evidence"),
    "skills-evidence must not reach the candidate",
  );
});

suite("drops the admin-only informational rows", () => {
  const f = healthy();
  f.sessionInvalidatedAt = D("2026-02-01T00:00:00Z");
  const rows = view(f).rows;
  assert(
    !rows.some((r) => r.id === "sessions-invalidated"),
    "sessions-invalidated is admin-only",
  );
  assert(!rows.some((r) => r.id === "track-pools"), "track-pools is admin-only");
});

/* ── Source guards: what the preview must never do ────────────────────────── */

suite("the preview is reads only — it records no view event", () => {
  const src = code(ASSEMBLER) + code(OWN_EVIDENCE);
  for (const banned of [
    "recordDetailView",
    "recordCandidateViewAction",
    "DETAIL_VIEW",
    "RESUME_UNLOCK",
    "prisma.$transaction",
    ".create(",
    ".update(",
    ".upsert(",
    ".delete(",
  ]) {
    assert(
      !src.includes(banned),
      `the preview must not write: found ${banned}. A candidate reading their own preview must not move their own "recruiters viewed you" counter.`,
    );
  }
});

suite("the preview never reaches a recruiter Server Action", () => {
  const src = code(ASSEMBLER) + code(OWN_EVIDENCE) + code(PAGE);
  assert(
    !src.includes("@/app/actions/hire-"),
    "the candidate page must not call hire-* Server Actions — they are ref-scoped, not session-scoped",
  );
  assert(
    !src.includes("loadInspector"),
    "the candidate page must not call the recruiter inspector actions",
  );
});

suite("no contact, no unlock, no résumé reaches the preview", () => {
  const src = code(ASSEMBLER) + code(OWN_EVIDENCE) + code(SCREEN);
  for (const banned of [
    "UnlockContactDialog",
    "revealContactAction",
    "LockedField",
    "evidenceResumeHref",
    "resumeUrl",
    "linkedinUrl",
    "githubUsername",
  ]) {
    assert(!src.includes(banned), `contact surface leaked into the preview: ${banned}`);
  }
});

suite("the candidate page never imports the recruiter stylesheet or its components", () => {
  const src = code(PAGE) + code(SCREEN);
  assert(!src.includes("hire-scout.css"), "must not import the recruiter stylesheet");
  for (const banned of [
    "components/hire/match-card",
    "components/hire/candidate-inspector",
    "components/hire/hire-chrome",
    "ShortlistButton",
    "AddToPipelineButton",
  ]) {
    assert(!src.includes(banned), `recruiter component leaked onto a candidate route: ${banned}`);
  }
});

suite("own-track-evidence returns no coverage and cannot feed ranking", () => {
  const src = code(OWN_EVIDENCE);
  assert(
    !/coverage:/.test(src),
    "coverage is a property of a pool, not a person — it must not be returned",
  );
  for (const banned of ["scoreCandidate", "rankCandidates", "selectSearchResults"]) {
    assert(!src.includes(banned), `must not call the ranking path: ${banned}`);
  }
});

suite("the assembler emits no total, no tier, and no spec-relative number", () => {
  const src = code(ASSEMBLER);
  for (const banned of ["stackScore", "experienceScore", "assessRole", "tierFor", "reweight"]) {
    assert(
      !src.includes(banned),
      `${banned} is spec-relative machinery and must stay out of the candidate preview`,
    );
  }
  assert(
    !/\btier\b/.test(src),
    "no tier: STRONG/PARTIAL/NONE is a claim about fit to one search",
  );
  // The three spec-relative dimensions must be declared search-relative.
  for (const key of ['key: "stack"', 'key: "role"', 'key: "experience"']) {
    const at = src.indexOf(key);
    assert(at > -1, `${key} should be present`);
    const window = src.slice(at, at + 200);
    assert(
      window.includes('kind: "search-relative"'),
      `${key} must be search-relative, never a measured number`,
    );
  }
});

/* ── Name masking: pinned to the recruiter card's own rule ────────────────── */

const DESK_CARD = "src/components/hire/desk-match-card.tsx";

suite("the preview's masking rule still matches the recruiter card's source", () => {
  /*
   * A SOURCE pin, not a behavioural one, and deliberately so.
   *
   * `splitName` lives in `desk-match-card.tsx`, which is a "use client" module.
   * It cannot be called from here in either mode: plain tsx makes `server-only`
   * in its import graph throw, and `--conditions=react-server` breaks
   * `react.createContext`. That is the same reason `recruiter-view-name.ts`
   * re-states the rule instead of importing it — a server-only module importing
   * a named export from a client module can be handed a client reference rather
   * than the function.
   *
   * So the fence is textual: if either half of the rule changes on the card, this
   * fails and someone re-syncs `recruiter-view-name.ts` by hand.
   */
  const card = code(DESK_CARD);

  assert(
    card.includes("export function splitName("),
    `${DESK_CARD} no longer exports splitName — re-check recruiter-view-name.ts`,
  );
  // Rule 1: a single-token name is left alone.
  assert(
    card.includes("if (parts.length < 2) return { given: name.trim(), masked: null };"),
    "the card's single-token rule changed — re-sync recruiter-view-name.ts",
  );
  // Rule 2: the four-glyph floor on the mask length.
  assert(
    card.includes("Math.max(4, Array.from(family).length)"),
    "the card's mask-length rule changed — re-sync recruiter-view-name.ts",
  );
  // Rule 3: how the family name is assembled from the remaining tokens.
  assert(
    card.includes('const family = parts.slice(1).join(" ");'),
    "the card's family-name rule changed — re-sync recruiter-view-name.ts",
  );

  // And the local module really does implement those three.
  const mine = code("src/features/profile/recruiter-view-name.ts");
  assert(
    mine.includes("parts.length < 2") &&
      mine.includes("Math.max(4, Array.from(family).length)") &&
      mine.includes('parts.slice(1).join(" ")'),
    "recruiter-view-name.ts has drifted from the card's rule",
  );
});

suite("masking behaves correctly on the cases that matter", () => {
  const cases: [string, string, number | null][] = [
    ["Asha Menon", "Asha", 5],
    ["Asha", "Asha", null],
    ["  Asha   Menon  ", "Asha", 5],
    ["Ravi Kumar Iyer", "Ravi", 10],
    ["A B", "A", 4],
    ["", "", null],
    ["   ", "", null],
  ];
  for (const [input, given, len] of cases) {
    const out = recruiterVisibleName(input);
    assert(
      out.given === given,
      `given for ${JSON.stringify(input)}: got ${JSON.stringify(out.given)}, want ${JSON.stringify(given)}`,
    );
    assert(
      out.maskedLength === len,
      `maskedLength for ${JSON.stringify(input)}: got ${out.maskedLength}, want ${len}`,
    );
  }
});

suite("the preview sends a mask LENGTH, never a surname or a decoy of one", () => {
  const out = recruiterVisibleName("Asha Menon");
  assert(typeof out.maskedLength === "number", "maskedLength should be a number");
  assert(
    !Object.values(out).some((v) => typeof v === "string" && v.includes("Menon")),
    "the surname must not appear anywhere in the payload",
  );
  const card = code("src/components/profile/recruiter-view/search-card-preview.tsx");
  assert(
    card.includes("maskedLength") && !card.includes("maskedName"),
    "the card must render from the length, not from a name string",
  );
  assert(
    !card.includes("decoy") && !code("src/features/profile/recruiter-view-name.ts").includes("decoySurname"),
    "the preview must not build a decoy surname — it renders blocks from a number",
  );
});

suite("the server-only assembler does not import a client module", () => {
  const src = code(ASSEMBLER);
  assert(
    !src.includes("@/components/hire/desk-match-card"),
    'server-only must not import from a "use client" module — in the App Router a ' +
      "named export from one can arrive as a client reference rather than the function",
  );
  assert(
    src.includes("recruiter-view-name"),
    "masking should come from the pure module",
  );
});

if (failed > 0) {
  console.log(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
