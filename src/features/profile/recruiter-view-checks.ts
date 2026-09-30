import type {
  CandidateDiscoverability,
  DiscoverabilityCheck,
} from "@/features/admin/candidate-discoverability";

/**
 * The admin discoverability report, rewritten for the candidate whose profile it
 * is (plan 155).
 *
 * PURE: facts in, rows out. No Prisma, no `server-only` — the loader is
 * `features/admin/get-candidate-discoverability.ts` and the tests drive this
 * function directly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 *
 * `candidate-discoverability.ts`'s own header states it: there is no
 * candidate-facing visibility switch anywhere in that gate. `CandidateVisibility`
 * is an admin moderation record — its schema comment says "not a candidate
 * preference", "not a user-facing opt-in" — so a blocker in the deletion,
 * account, moderation or index groups "is always something the platform or an
 * admin did, never something the candidate chose, and this panel must never
 * phrase one as a candidate decision."
 *
 * Therefore every such row collapses into ONE neutral line with no detail and no
 * fix link, and every admin `action` string is dropped rather than reworded.
 * Those strings are runbook instructions ("Clearing it is an admin database
 * change, not an action on this page") and they must not reach a candidate.
 *
 * What survives is only what the candidate can actually change: the fields on
 * their own profile.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Wizard step keys on `/profile`, which `?step=` opens directly. */
export type FixStep =
  | "basic"
  | "experience"
  | "education"
  | "skills"
  | "links"
  | "resume"
  | "preferences";

export type CandidateSafeCheck = {
  id: string;
  /** `ok` — nothing to do. `gap` — narrows reach. `blocked` — cannot be found. */
  tone: "ok" | "gap" | "blocked";
  label: string;
  /** Second person, plain, consequence first. Empty string for the platform row. */
  detail: string;
  /** The wizard step that fixes it, when the candidate can fix it at all. */
  fixStep: FixStep | null;
  /** Button copy for the fix link. Null whenever `fixStep` is null. */
  fixLabel: string | null;
};

export type CandidateFindability = {
  appears: boolean;
  headline: string;
  rows: CandidateSafeCheck[];
  /** True when a platform/admin gate is in force, whatever the reason. */
  platformHold: boolean;
};

/**
 * Checks the candidate can act on, and what to say about each.
 *
 * Keyed by the admin check id so a new admin check cannot silently appear on a
 * candidate's page with admin wording — anything not listed here is either
 * collapsed into the platform row or dropped.
 */
const CANDIDATE_FIXABLE: Record<
  string,
  {
    label: string;
    gapDetail: string;
    okDetail: string;
    fixStep: FixStep;
    fixLabel: string;
  }
> = {
  "profile-name": {
    label: "Your name",
    gapDetail:
      "Your profile has no name, and a profile without one is left out of recruiter search entirely.",
    okDetail: "Recruiters see your given name; your surname is released separately.",
    fixStep: "basic",
    fixLabel: "Add your name",
  },
  "profile-headline": {
    label: "Headline",
    gapDetail:
      "You have no headline. Recruiters typing a role rather than a name match against your headline, so without one they will not find you that way.",
    okDetail: "Your headline is what a recruiter typing a role matches against.",
    fixStep: "basic",
    fixLabel: "Add a headline",
  },
  "profile-location": {
    label: "Location",
    gapDetail:
      "Your profile has no city and no country, so any search filtered by location leaves you out.",
    okDetail: "Your location lets location-filtered searches reach you.",
    fixStep: "basic",
    fixLabel: "Add your location",
  },
  "profile-education": {
    label: "Education",
    gapDetail:
      "You have no education entries, so a search filtered by graduation year leaves you out.",
    okDetail: "Your education lets graduation-year filters reach you.",
    fixStep: "education",
    fixLabel: "Add education",
  },
  "profile-experience": {
    label: "Experience",
    gapDetail:
      "You have no roles listed and have not said you are yet to start work, so any minimum-experience filter leaves you out. Either answer works.",
    okDetail: "Your experience lets minimum-experience filters reach you.",
    fixStep: "experience",
    fixLabel: "Add experience",
  },
  "skills-claimed": {
    label: "Skills",
    gapDetail:
      "You have no skills on your profile. Skills are what a recruiter searches on first, and a profile without any is left out of recruiter search entirely.",
    okDetail: "Your skills are what a recruiter's search matches on first.",
    fixStep: "skills",
    fixLabel: "Add skills",
  },
};

/**
 * Admin checks that are dropped rather than shown or collapsed.
 *
 * `sessions-invalidated` is INFO and the admin panel already says it has no
 * effect on search.
 *
 * `track-pools` describes which pools carry the candidate — useful to an admin
 * triaging a ticket, but the preview shows the candidate their actual track
 * evidence directly, which is the same information without the pool vocabulary.
 *
 * `skills-evidence` is dropped for a harder reason: it is a PLATFORM gap, and
 * the admin check says so itself — "Nothing on the platform writes skill
 * evidence today, so this is true for nearly every candidate — it is a platform
 * gap, not a candidate one." `SkillEvidence` has had no live writer since the
 * backfill (CLAUDE.md, verified 2026-09-04; P0-0 in plan 112), so there is no
 * action a candidate could take that would clear it. Telling them to "take an
 * assessment to earn evidence" would be advice that cannot work.
 */
const DROPPED = new Set(["sessions-invalidated", "track-pools", "skills-evidence"]);

const PLATFORM_ROW: CandidateSafeCheck = {
  id: "platform-hold",
  tone: "blocked",
  label: "Managed by ABTalks",
  detail:
    "Some visibility settings on your account are managed by ABTalks and are not something you can change from your profile. If you think this is wrong, contact support.",
  fixStep: null,
  fixLabel: null,
};

function toneOf(check: DiscoverabilityCheck): "ok" | "gap" | "blocked" {
  if (check.status === "OK") return "ok";
  if (check.status === "BLOCKING") return "blocked";
  return "gap";
}

export function toCandidateSafeChecks(
  d: CandidateDiscoverability,
): CandidateFindability {
  const rows: CandidateSafeCheck[] = [];
  let platformHold = false;

  for (const check of d.checks) {
    if (DROPPED.has(check.id)) continue;

    const fixable = CANDIDATE_FIXABLE[check.id];
    if (!fixable) {
      // Everything else is a platform or admin gate. It is only ever reported as
      // the single neutral row, and only when it is actually in force.
      if (check.status === "BLOCKING") platformHold = true;
      continue;
    }

    const ok = check.status === "OK";
    rows.push({
      id: check.id,
      tone: toneOf(check),
      label: fixable.label,
      detail: ok ? fixable.okDetail : fixable.gapDetail,
      fixStep: ok ? null : fixable.fixStep,
      fixLabel: ok ? null : fixable.fixLabel,
    });
  }

  if (platformHold) rows.unshift(PLATFORM_ROW);

  // Gaps first within their group so the actionable rows are not buried under a
  // list of ticks, but the platform row stays pinned at the top.
  const pinned = rows.filter((r) => r.id === "platform-hold");
  const rest = rows.filter((r) => r.id !== "platform-hold");
  const order = { blocked: 0, gap: 1, ok: 2 } as const;
  rest.sort((a, b) => order[a.tone] - order[b.tone]);

  const openCount = rest.filter((r) => r.tone !== "ok").length;

  return {
    appears: d.appears,
    headline: headlineFor(d.appears, platformHold, openCount),
    rows: [...pinned, ...rest],
    platformHold,
  };
}

/**
 * The verdict line, in the candidate's own terms.
 *
 * Deliberately not `d.verdict`: that string names the blocker in platform
 * vocabulary ("the candidate has no recruiter-discovery record") and is written
 * for an admin reading a ticket.
 */
function headlineFor(
  appears: boolean,
  platformHold: boolean,
  openCount: number,
): string {
  if (!appears && platformHold) {
    return "You are not appearing in recruiter search, and the reason is on ABTalks' side.";
  }
  if (!appears) {
    return openCount > 0
      ? "You are not appearing in recruiter search yet — finish the items below."
      : "You are not appearing in recruiter search yet.";
  }
  if (openCount === 0) {
    return "You are appearing in recruiter search, with nothing holding you back.";
  }
  return openCount === 1
    ? "You are appearing in recruiter search, but one thing is narrowing who finds you."
    : `You are appearing in recruiter search, but ${openCount} things are narrowing who finds you.`;
}
