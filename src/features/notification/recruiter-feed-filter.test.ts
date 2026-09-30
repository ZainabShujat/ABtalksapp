/**
 * T-249 recruiter feed filter — behavioural test.
 *
 *   npm run test:t249-feed-filter
 *
 * Unlike the shape tests, this actually runs the filter against fixture
 * data and asserts the produced arrays. Exercises the three arms of the
 * recruiter-side gate:
 *
 * 1. Derived event items (hackathon registration, workshop invites) are
 *    dropped for a recruiter, kept for a candidate.
 * 2. Admin items are narrowed to `category === "GENERAL"` for a
 *    recruiter; track-flavoured ones (HACKATHON, WORKSHOP, COHORT,
 *    CHALLENGE) survive only on the candidate side.
 * 3. Personal `UserNotification` items are narrowed to the
 *    recruiter-facing eventTypes for a recruiter; job.alert.match /
 *    profile.viewed / job.closed vanish on `/hire`.
 *
 * A candidate view is a control case: `isRecruiter = false` must return
 * the input arrays unchanged.
 */
import {
  filterFeedForView,
  RECRUITER_EVENT_TYPES,
  type FeedInputRow,
} from "./recruiter-feed-filter";
import type { DerivedNotification } from "./derive-event-notifications";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
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

function adminRow(
  key: string,
  category: FeedInputRow["category"],
): FeedInputRow {
  return {
    key: `admin:${key}`,
    title: `Admin ${key}`,
    body: null,
    href: null,
    category,
    publishedAt: new Date().toISOString(),
  };
}

function userRow(key: string, eventType: string | undefined): FeedInputRow {
  return {
    key: `user:${key}`,
    title: `User ${key}`,
    body: null,
    href: "/hire/pipeline",
    category: "GENERAL",
    publishedAt: new Date().toISOString(),
    eventType,
  };
}

function derivedRow(key: string): DerivedNotification {
  return {
    key: `derived:${key}`,
    title: `Derived ${key}`,
    body: null,
    href: null,
    category: "HACKATHON",
    publishedAt: new Date().toISOString(),
  };
}

console.log("\nT-249 recruiter-feed filter behaviour");

const fixture = {
  adminItems: [
    adminRow("hackathon-warmup", "HACKATHON"),
    adminRow("workshop-open", "WORKSHOP"),
    adminRow("cohort-open", "COHORT"),
    adminRow("challenge-drop", "CHALLENGE"),
    adminRow("company-wide-notice", "GENERAL"),
  ],
  derivedItems: [
    derivedRow("hackathon-registration"),
    derivedRow("workshop-lead-time"),
  ],
  userItems: [
    // Recruiter-facing events — must survive on /hire.
    userRow("apply-received", "application.received"),
    userRow("assessment-done", "assessment.completed"),
    userRow("pipeline-nudge", "application.status_changed"),
    userRow("outreach-reply", "outreach.reply_received"),
    userRow("system-notice", "system.notice"),
    // Candidate-facing events — must be dropped on /hire.
    userRow("job-alert", "job.alert.match"),
    userRow("profile-view", "profile.viewed"),
    userRow("job-closed-notice", "job.closed"),
    // A row with no eventType at all — treat as unknown but keep.
    userRow("legacy-row", undefined),
  ],
};

suite("candidate view is a no-op (identity through)", () => {
  const out = filterFeedForView(fixture, false);
  assert(
    out.adminItems.length === fixture.adminItems.length,
    "candidate view keeps every admin item",
  );
  assert(
    out.derivedItems.length === fixture.derivedItems.length,
    "candidate view keeps every derived item (hackathon/workshop prompts)",
  );
  assert(
    out.userItems.length === fixture.userItems.length,
    "candidate view keeps every personal item",
  );
});

suite("recruiter view drops all derived items", () => {
  const out = filterFeedForView(fixture, true);
  assert(
    out.derivedItems.length === 0,
    `expected no derived items on recruiter view, got ${out.derivedItems.length}`,
  );
});

suite("recruiter view narrows admin items to GENERAL only", () => {
  const out = filterFeedForView(fixture, true);
  assert(
    out.adminItems.length === 1,
    `expected 1 admin item (GENERAL only), got ${out.adminItems.length}: ${out.adminItems.map((r) => r.key).join(", ")}`,
  );
  assert(
    out.adminItems[0].key === "admin:company-wide-notice",
    "the surviving admin item must be the GENERAL 'company-wide-notice' row",
  );
  for (const dropped of ["HACKATHON", "WORKSHOP", "COHORT", "CHALLENGE"]) {
    assert(
      !out.adminItems.some((r) => r.category === dropped),
      `admin item with category ${dropped} must not survive on the recruiter view`,
    );
  }
});

suite("recruiter view keeps every recruiter-facing eventType", () => {
  const out = filterFeedForView(fixture, true);
  for (const eventType of [
    "application.received",
    "assessment.completed",
    "application.status_changed",
    "outreach.reply_received",
    "system.notice",
  ]) {
    assert(
      out.userItems.some((r) => r.eventType === eventType),
      `${eventType} must survive on the recruiter view`,
    );
  }
});

suite("recruiter view drops candidate-facing eventTypes", () => {
  const out = filterFeedForView(fixture, true);
  for (const eventType of [
    "job.alert.match",
    "profile.viewed",
    "job.closed",
  ]) {
    assert(
      !out.userItems.some((r) => r.eventType === eventType),
      `${eventType} must NOT survive on the recruiter view — it is candidate-facing`,
    );
  }
});

suite("recruiter view keeps a row with no eventType (defensive)", () => {
  const out = filterFeedForView(fixture, true);
  assert(
    out.userItems.some((r) => r.eventType === undefined),
    "a row with no eventType must survive so an unrecognised row does not vanish silently",
  );
});

suite("the recruiter-events allowlist matches the plan exactly", () => {
  const expected = [
    "application.received",
    "application.status_changed",
    "assessment.completed",
    "outreach.reply_received",
    "outreach.message_received",
    "system.notice",
    "auth.password_reset",
  ];
  for (const key of expected) {
    assert(
      RECRUITER_EVENT_TYPES.has(key),
      `RECRUITER_EVENT_TYPES must include ${key}`,
    );
  }
  assert(
    RECRUITER_EVENT_TYPES.size === expected.length,
    `RECRUITER_EVENT_TYPES has ${RECRUITER_EVENT_TYPES.size} entries; expected ${expected.length}. Any drift is a plan violation.`,
  );
});

suite("total surviving items on the recruiter view (regression pin)", () => {
  const out = filterFeedForView(fixture, true);
  const total =
    out.adminItems.length + out.derivedItems.length + out.userItems.length;
  // 1 GENERAL admin + 0 derived + 5 recruiter events + 1 legacy row (no
  // eventType) = 7. If this changes, a new arm was added — update the
  // test intentionally, not silently.
  assert(
    total === 7,
    `expected 7 items on recruiter view (1 admin + 0 derived + 6 user), got ${total}`,
  );
});

suite("recruiter view keeps broadcasts addressed to ALL or RECRUITER, any category", () => {
  const out = filterFeedForView(
    {
      adminItems: [
        { ...adminRow("videothon-everyone", "HACKATHON"), audience: "ALL" },
        { ...adminRow("recruiter-workshop", "WORKSHOP"), audience: "RECRUITER" },
        { ...adminRow("challenge-only", "CHALLENGE"), audience: "CHALLENGE" },
        { ...adminRow("candidate-cohort", "COHORT"), audience: "CANDIDATE" },
        { ...adminRow("candidate-general", "GENERAL"), audience: "CANDIDATE" },
      ],
      derivedItems: [],
      userItems: [],
    },
    true,
  );
  const keys = out.adminItems.map((r) => r.key);
  assert(keys.includes("admin:videothon-everyone"), "ALL + HACKATHON must reach recruiters");
  assert(keys.includes("admin:recruiter-workshop"), "RECRUITER + WORKSHOP must reach recruiters");
  assert(!keys.includes("admin:challenge-only"), "CHALLENGE + CHALLENGE must not reach recruiters");
  assert(!keys.includes("admin:candidate-cohort"), "CANDIDATE + COHORT must not reach recruiters");
  // Upstream audience gating already drops CANDIDATE rows for a recruiter;
  // the filter itself keeps GENERAL rows (pre-existing behaviour).
  assert(keys.includes("admin:candidate-general"), "GENERAL rows keep the pre-existing pass-through");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
