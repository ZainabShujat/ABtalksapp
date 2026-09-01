/**
 * Phase A behavioural checks: profile grounding, and the boundary that keeps a
 * profile claim from becoming demonstrated evidence.
 *
 * Pure — no database, no model, no network. `formatProfileContext` takes a
 * `CandidateContext` object, so the whole grounding layer is testable by
 * constructing one, which is the point of reusing the existing builder rather
 * than writing a second profile system that would need a database to exercise.
 *
 * Run: npx tsx scripts/verify-interview-grounding.ts
 */
import assert from "node:assert/strict";

import {
  formatProfileContext,
  hasUsableProfile,
} from "../src/features/interview/platform/profile-context";
import { getStartableDomain } from "../src/features/interview/platform/domains";
import {
  buildPlatformPlan,
  platformContextOf,
  platformOpeningLine,
} from "../src/features/interview/platform/planner";
import { assessPlatformCompetencies } from "../src/features/interview/platform/scoring";
import { createInitialState } from "../src/features/interview/state";
import type { CandidateContext } from "../src/features/interview/types";

let checks = 0;
function check(label: string, fn: () => void): void {
  fn();
  checks += 1;
  console.log(`  ok  ${label}`);
}

/** A candidate context with only the fields a test cares about. */
function candidate(patch: Partial<CandidateContext> = {}): CandidateContext {
  return {
    userId: "u1",
    fullName: "Zainab Shujat",
    domain: "",
    role: null,
    organization: null,
    yearsExperience: null,
    college: null,
    challenge: {
      enrollments: [],
      tasks: [],
      totalCompletedDays: 0,
      completedSubmissionIds: [],
    },
    resume: {
      hasStructuredResume: false,
      headline: null,
      summary: null,
      targetRole: null,
      skills: [],
      experience: [],
      projects: [],
      resumeUrl: null,
    },
    ...patch,
  };
}

const RICH = candidate({
  role: "Data Analyst",
  organization: "Acme",
  yearsExperience: 3,
  resume: {
    hasStructuredResume: true,
    headline: "Python developer moving into AI engineering",
    summary: null,
    targetRole: null,
    skills: ["Python", "RAG", "Chroma", "FastAPI"],
    experience: [
      { title: "Analyst", company: "Acme", highlights: ["Built internal tooling"] },
    ],
    projects: ["A RAG chatbot over our internal documentation"],
    resumeUrl: null,
  },
});

/* ------------------------------------------------------- profile formatting */

console.log("\nprofile grounding");

check("a rich profile produces usable context", () => {
  const text = formatProfileContext(RICH);
  assert.equal(text.length > 0, true);
  assert.match(text, /Data Analyst at Acme/);
  assert.match(text, /Python, RAG, Chroma, FastAPI/);
  assert.match(text, /RAG chatbot/);
  assert.equal(hasUsableProfile(RICH), true);
});

check("an empty profile produces NO context rather than a hedge", () => {
  assert.equal(formatProfileContext(candidate()), "");
  assert.equal(formatProfileContext(null), "");
  assert.equal(hasUsableProfile(candidate()), false);
  assert.equal(hasUsableProfile(null), false);
});

check("nothing is invented from a missing field", () => {
  // Only a role. Every other line must be absent, not guessed at.
  const text = formatProfileContext(candidate({ role: "Backend Engineer" }));
  assert.match(text, /Backend Engineer/);
  assert.equal(/skills/i.test(text), false);
  assert.equal(/built/i.test(text), false);
  assert.equal(/challenge/i.test(text), false);
  assert.equal(text.includes("null"), false);
  assert.equal(text.includes("undefined"), false);
});

check("completed challenge work reads as history, not as capability", () => {
  const text = formatProfileContext(
    candidate({
      challenge: {
        enrollments: [],
        tasks: [],
        totalCompletedDays: 12,
        completedSubmissionIds: [],
      },
    }),
  );
  assert.match(text, /completed 12 days/i);
  // It must not claim they KNOW anything.
  assert.equal(/demonstrated|proficient|knows|expert/i.test(text), false);
});

check("long fields are capped so context cannot crowd out the answer", () => {
  const text = formatProfileContext(
    candidate({
      resume: {
        ...candidate().resume,
        skills: Array.from({ length: 40 }, (_, i) => `skill${i}`),
        projects: Array.from({ length: 20 }, (_, i) => `project ${i} `.repeat(40)),
      },
    }),
  );
  assert.equal(text.length < 2000, true, `context was ${text.length} chars`);
  assert.equal(text.includes("skill30"), false, "skills were not capped");
});

/* ------------------------------------------- profile is CONTEXT, not EVIDENCE */

console.log("\nprofile is context, never evidence");

const domain = getStartableDomain("ai-fluency")!;

check("the profile reaches the plan as context only", () => {
  const plan = buildPlatformPlan(domain, {
    candidateFirstName: "Zainab",
    profileContext: formatProfileContext(RICH),
  });
  const ctx = platformContextOf(plan)!;
  assert.match(ctx.profileContext ?? "", /RAG chatbot/);

  // It must not have leaked into anything the scorer reads.
  for (const q of plan.questions) {
    assert.equal(
      JSON.stringify(q).includes("RAG chatbot"),
      false,
      `${q.id} carries profile text`,
    );
  }
});

check("a candidate who says nothing scores nothing, however strong the profile", () => {
  const plan = buildPlatformPlan(domain, {
    profileContext: formatProfileContext(RICH),
  });
  const ctx = platformContextOf(plan)!;
  // No answers at all — only a profile claiming RAG, Chroma and Python.
  const comps = assessPlatformCompetencies(
    plan,
    createInitialState(),
    ctx.rubric.id,
  );
  assert.equal(
    comps.every((c) => c.unassessed && c.score === 0),
    true,
    "a profile claim produced a score",
  );
  assert.equal(
    comps.every((c) => c.evidenceRefs.length === 0),
    true,
    "a profile claim produced evidence refs",
  );
});

check("an identical plan is produced with and without a profile", () => {
  const withProfile = buildPlatformPlan(domain, {
    profileContext: formatProfileContext(RICH),
  });
  const without = buildPlatformPlan(domain, {});
  // Grounding may change what is ASKED ABOUT conversationally, but it must never
  // change the assessment instrument: same questions, same order, same evidence.
  assert.deepEqual(
    withProfile.questions.map((q) => q.id),
    without.questions.map((q) => q.id),
  );
  assert.deepEqual(
    withProfile.questions.map((q) => q.expectedEvidence),
    without.questions.map((q) => q.expectedEvidence),
  );
});

/* --------------------------------------------------------------- the opening */

console.log("\nprofile-aware opening");

check("an opening acknowledges context when there is some", () => {
  const withProfile = platformOpeningLine({
    domain,
    firstName: "Zainab",
    hasProfile: true,
    seed: "s1",
  });
  assert.match(withProfile, /profile|background/i);
  assert.match(withProfile, /Zainab/);
});

check("an opening claims nothing when there is no profile", () => {
  const bare = platformOpeningLine({
    domain,
    firstName: "Zainab",
    hasProfile: false,
    seed: "s1",
  });
  assert.equal(
    /profile|background/i.test(bare),
    false,
    "claimed to have read a profile that does not exist",
  );
  assert.equal(bare.length > 0, true);
});

check("the opening never states a specific profile fact", () => {
  // It must not promise a direction the authored first question cannot deliver.
  for (let i = 0; i < 12; i += 1) {
    const line = platformOpeningLine({
      domain,
      firstName: "Zainab",
      hasProfile: true,
      seed: `s${i}`,
    });
    assert.equal(/RAG|Python|Chroma|Acme|Analyst/i.test(line), false, line);
  }
});

check("openings stay reproducible per seed and vary across seeds", () => {
  const a = platformOpeningLine({ domain, hasProfile: true, seed: "x" });
  const b = platformOpeningLine({ domain, hasProfile: true, seed: "x" });
  assert.equal(a, b);
  const many = new Set(
    Array.from({ length: 24 }, (_, i) =>
      platformOpeningLine({ domain, hasProfile: true, seed: `v${i}` }),
    ),
  );
  assert.equal(many.size > 1, true);
});

console.log(`\n${checks} checks passed.\n`);
