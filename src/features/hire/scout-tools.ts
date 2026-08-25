import "server-only";

import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { logger } from "@/lib/logger";
import {
  jobSpecSchema,
  noArgsSchema,
  offerOptionsArgsSchema,
  setPoolFiltersArgsSchema,
  updateBriefArgsSchema,
  type JobSpec,
  type OfferOptionsArgs,
  type SetPoolFiltersArgs,
  type UpdateBriefArgs,
} from "@/lib/validations/hire";
import type { ScoutChip } from "@/features/hire/scout-chips";
import { findUnsupported } from "@/features/hire/capabilities";
import {
  applyPoolBrief,
  confirmPoolBrief,
  readPoolExtra,
  skipUnfilledIntake,
} from "@/features/hire/pool-brief";
import {
  EVIDENCE_KEYS,
  asRoleTitle,
  formatSpecSalary,
  isMonthlyContext,
  parseMoney,
} from "@/features/hire/spec-fields";
import { describeTracks, trackLabels } from "@/features/hire/track-registry";

/**
 * The only ways Scout can act.
 *
 * Every tool validates its own arguments and hands back what it REJECTED along
 * with what it applied. That return shape is the point: a refusal becomes data
 * the model has to account for on the next hop, instead of a prompt rule it can
 * forget. "Tell the recruiter what you could not do" stops being a hope.
 *
 * Two guarantees live here rather than in the prompt, because a prompt is not a
 * guarantee:
 *   - money is computed by `parseMoney` from the recruiter's own words, never by
 *     the model (`salaryText` is a string, never a number);
 *   - a pool filter needs the recruiter's words to corroborate it
 *     (`confirmPoolBrief`), so neither the model alone nor a stray keyword alone
 *     can move the brief.
 *
 * State lives in a per-turn context rather than a graph channel. The graph is
 * rebuilt every turn with no checkpointer, so a closure is simpler, cannot leak
 * between requests, and — the reason that matters — lets the whole tool surface
 * be tested with no graph, no model and no database.
 *
 * `server-only` stays on, and the evals still reach these executors: they run
 * under `node --conditions=react-server`, which resolves that package to an
 * empty module the way an RSC build does. Testability did not have to cost the
 * guarantee — an accidental client import would put `@langchain/core` in the
 * browser bundle, so keep the marker.
 */

/** Data access, injected so tests need neither Prisma nor a network. */
export type ScoutToolDeps = {
  poolSnapshot: () => Promise<Record<string, unknown>>;
  previewMatch: (spec: JobSpec) => Promise<Record<string, unknown> | null>;
};

export type ScoutToolContext = {
  /** The recruiter's message this turn. */
  userMessage: string;
  /**
   * Everything the recruiter has said, this turn and before.
   *
   * The corroboration half of every filter, and it has to span the CONVERSATION
   * rather than one message. Scoped to the last message it produced a hard loop:
   * "5 students from the cohort challenge" named the track, then "nothing just
   * give me the 5 students" named nothing, so the filter was rejected and Scout
   * asked which track — five times, while the recruiter kept saying they had
   * already answered. A recruiter states a thing once and expects it to stick.
   *
   * The original bug this rule exists for still cannot return: a stray keyword
   * acts only if the MODEL also proposes it, and a geography alone is no longer
   * a brief at all.
   */
  recruiterWords: string;
  /** Mutated only by the executors below. Read back after the graph finishes. */
  spec: JobSpec;
  /** Set by `search_pool` / `reset_brief`. The engine turns this into `turn.action`. */
  action: "search" | "reset" | null;
  /** Every tool result, for the grounding guard. */
  facts: unknown[];
  /** Tool names in call order, for logging and for the evals to assert on. */
  called: string[];
  /**
   * Quick replies the agent offered this turn, if it called `offer_options`.
   * The conversation layer prefers these over the fixed ladder.
   */
  offeredChips: ScoutChip[] | null;
};

export function createScoutToolContext(
  userMessage: string,
  spec: JobSpec,
  priorUserMessages: string[] = [],
): ScoutToolContext {
  return {
    userMessage,
    recruiterWords: [...priorUserMessages, userMessage].join("\n"),
    spec,
    action: null,
    facts: [],
    called: [],
    offeredChips: null,
  };
}

type Rejection = { field: string; value: string; reason: string };

/** Applied plus rejected, always. Both halves are load-bearing. */
function result(
  ctx: ScoutToolContext,
  name: string,
  payload: Record<string, unknown>,
): string {
  ctx.called.push(name);
  ctx.facts.push(payload);
  return JSON.stringify(payload);
}

/** Is there enough here to run a search that means something? */
export function searchable(spec: JobSpec): boolean {
  const extra = readPoolExtra(spec);
  return (
    extra.sources.length > 0 ||
    extra.minEvidenceDays != null ||
    Boolean(spec.title?.trim()) ||
    (spec.mustHaveStack?.length ?? 0) > 0
  );
}

/**
 * What is still needed BEFORE a search can run — nothing more.
 *
 * This used to list the role, skills, seniority and budget unconditionally, and
 * the model read that as a checklist it had to complete. Told "nothing just give
 * me the 5 students" it asked for a job title anyway, because every tool result
 * kept insisting four things were missing. Once a track or a role exists, a
 * search is meaningful and nothing is missing; anything else is a refinement the
 * recruiter may volunteer, not a gate.
 */
function stillMissing(spec: JobSpec): string[] {
  if (searchable(spec)) return [];
  return ["a track to search, or the role you are hiring for"];
}

/* ── update_brief ─────────────────────────────────────────────────────────── */

function applyUpdateBrief(
  ctx: ScoutToolContext,
  args: UpdateBriefArgs,
): Record<string, unknown> {
  const rejected: Rejection[] = [];
  const applied: Record<string, unknown> = {};
  const next: JobSpec = { ...ctx.spec };

  if (args.title?.trim()) {
    // The model occasionally echoes the whole request back as the title, which
    // then appears inside every later question and on the stored request.
    const role = asRoleTitle(args.title);
    if (role) {
      next.title = role;
      applied.title = role;
    } else {
      rejected.push({
        field: "title",
        value: args.title.slice(0, 60),
        reason:
          "That reads as a sentence, not a job title. Give the role in a few words.",
      });
    }
  }

  if (args.seniority) {
    next.seniority = args.seniority;
    applied.seniority = args.seniority;
  }

  const cleanStack = (list: string[] | null | undefined) =>
    (list ?? [])
      .map((s) => String(s).trim())
      .filter((s) => s.length > 0 && s.length <= 60)
      .slice(0, 12);

  const must = cleanStack(args.mustHaveStack);
  if (must.length) {
    next.mustHaveStack = must;
    applied.mustHaveStack = must;
  }
  const nice = cleanStack(args.niceToHaveStack);
  if (nice.length) {
    next.niceToHaveStack = nice;
    applied.niceToHaveStack = nice;
  }

  const evidence = (args.evidencePriority ?? [])
    .map((e) => String(e).trim().toLowerCase())
    .filter((e) => EVIDENCE_KEYS.has(e))
    .slice(0, 5);
  if (evidence.length) {
    next.evidencePriority = evidence;
    applied.evidencePriority = evidence;
  }

  if (args.employmentType) {
    next.employmentType = args.employmentType;
    applied.employmentType = args.employmentType;
  }
  if (args.workMode) {
    next.workMode = args.workMode;
    applied.workMode = args.workMode;
  }

  // The employer's office city is a real field; a *candidate's* location is not
  // one we have, and accepting it silently is how "Noted — US location it is"
  // happened for something no candidate has ever filled in.
  if (args.locationCity?.trim()) {
    const blocked = findUnsupported(ctx.userMessage).find(
      (f) => f.id === "candidate_location",
    );
    if (blocked) {
      rejected.push({
        field: "locationCity",
        value: args.locationCity,
        reason: blocked.reply,
      });
    } else {
      next.locationCity = args.locationCity.trim().slice(0, 80);
      applied.locationCity = next.locationCity;
    }
  }

  if (args.noticePeriodDays != null && Number.isFinite(args.noticePeriodDays)) {
    next.noticePeriodDays = Math.round(Math.min(180, Math.max(0, args.noticePeriodDays)));
    applied.noticePeriodDays = next.noticePeriodDays;
  }

  const years = [args.minExperience, args.maxExperience].filter(
    (n): n is number => n != null && Number.isFinite(n) && n >= 0,
  );
  if (years.length) {
    next.minExperience = Math.round(Math.min(...years));
    next.maxExperience = Math.round(Math.min(50, Math.max(...years)));
    applied.experience = `${next.minExperience}-${next.maxExperience} years`;
  }

  // Money: the model quoted the recruiter, `parseMoney` decides. Seniority is
  // read from the spec AFTER the update above, so "intern, 20k" in one message
  // is correctly monthly.
  if (args.salaryText?.trim()) {
    const money = parseMoney(args.salaryText, isMonthlyContext(next));
    if (money) {
      next.salaryMin = money.min;
      next.salaryMax = money.max;
      next.salaryCurrency = "INR";
      next.salaryPeriod = money.period;
      // Read back in the units the recruiter used, so a misreading is visible.
      applied.salary = formatSpecSalary(next);
    } else {
      rejected.push({
        field: "salaryText",
        value: args.salaryText,
        reason: "I could not read a figure in that.",
      });
    }
  }

  const parsed = jobSpecSchema.safeParse(next);
  if (!parsed.success) {
    logger.error("[scout-tools] update_brief produced an invalid spec", {
      err: parsed.error.message.slice(0, 200),
    });
    return {
      applied: {},
      rejected: [
        ...rejected,
        { field: "brief", value: "", reason: "That did not fit the brief." },
      ],
      stillMissing: stillMissing(ctx.spec),
    };
  }
  ctx.spec = parsed.data;

  // An empty `applied` used to come back beside `readyToSearch: true`, which
  // reads like success. Asked to "start over" the model called this with no
  // arguments, got that, and told the recruiter "all previous details cleared"
  // — a state change that had not happened. Nothing is worse than a tool that
  // looks like it worked.
  const changed = Object.keys(applied).length > 0;
  const canSearch = searchable(ctx.spec);
  return {
    applied,
    rejected,
    ...(canSearch
      ? { canSearchNow: true, next: "You have enough to search. If they asked for candidates, call search_pool now instead of asking for more." }
      : {}),
    ...(changed
      ? {}
      : {
          note: "Nothing was changed — no values were passed. This tool only ADDS to the brief; it cannot clear it. Use reset_brief to start over.",
        }),
    stillMissing: stillMissing(ctx.spec),
    readyToSearch: searchable(ctx.spec),
  };
}

/* ── set_pool_filters ─────────────────────────────────────────────────────── */

function applySetPoolFilters(
  ctx: ScoutToolContext,
  args: SetPoolFiltersArgs,
): Record<string, unknown> {
  const { brief, rejected } = confirmPoolBrief(
    ctx.recruiterWords,
    args,
    ctx.userMessage,
  );

  // Nothing survived corroboration: say so, and say what does exist, rather
  // than reporting an empty success the model will describe as a filter.
  if (
    brief.sources.length === 0 &&
    brief.minEvidenceDays == null &&
    brief.resultLimit == null
  ) {
    return {
      applied: {},
      rejected,
      tracksThatExist: describeTracks().map((t) => ({
        slug: t.slug,
        label: t.label,
      })),
    };
  }

  // An explicit pool brief IS the search scope, so the intake questions stop
  // being asked — a recruiter who said "5 from the claude challenge" is not
  // waiting to be walked through a form.
  ctx.spec = skipUnfilledIntake(applyPoolBrief(ctx.spec, brief));

  return {
    applied: {
      tracks: trackLabels(brief.sources),
      geo: brief.geo,
      minEvidenceDays: brief.minEvidenceDays,
      resultLimit: brief.resultLimit,
    },
    rejected,
    readyToSearch: searchable(ctx.spec),
  };
}

/* ── offer_options ────────────────────────────────────────────────────────── */

const PROTOCOL_PREFIX = /^(action|edit|skip|salary):/i;

function applyOfferOptions(
  ctx: ScoutToolContext,
  args: OfferOptionsArgs | unknown,
): Record<string, unknown> {
  const parsed = offerOptionsArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      offered: false,
      reason:
        "Need 2–4 short options. Labels ≤ 40 characters. Do not use action:, edit:, skip: or salary: values — those are reserved.",
    };
  }
  const reserved = parsed.data.options.filter((o) =>
    PROTOCOL_PREFIX.test(o.value),
  );
  if (reserved.length > 0) {
    return {
      offered: false,
      reason:
        "Those values are reserved for the engine. Pick ordinary answers the recruiter would tap.",
    };
  }
  ctx.offeredChips = parsed.data.options.map((o) => ({
    label: o.label,
    value: o.value,
  }));
  return { offered: true, count: ctx.offeredChips.length };
}

/* ── the tools ────────────────────────────────────────────────────────────── */

export function createScoutTools(
  ctx: ScoutToolContext,
  deps: ScoutToolDeps,
) {
  const listTracks = tool(
    async () =>
      result(ctx, "list_tracks", {
        tracks: describeTracks(),
        note: "Slugs are what set_pool_filters takes. evidenceKinds is the proof this track produces.",
      }),
    {
      name: "list_tracks",
      description:
        "The candidate tracks that exist right now, with the evidence each one verifies. ALWAYS call this before naming or filtering any track: tracks change and your memory of them is not authoritative. Refer to a track by its label, never its slug. If a track the recruiter names is not in this list, tell them which ones are.",
      schema: noArgsSchema,
    },
  );

  const getPoolStats = tool(
    async () => {
      const snap = await deps.poolSnapshot();
      return result(ctx, "get_pool_stats", { facts: snap });
    },
    {
      name: "get_pool_stats",
      description:
        "Live counts and skill distribution for the searchable pool. Call this for ANY question about how many people there are, what skills they have, or what evidence exists — never refuse such a question, and never answer it from memory. Only for questions; a statement of requirements is update_brief instead.",
      schema: noArgsSchema,
    },
  );

  const updateBrief = tool(
    async (args: UpdateBriefArgs) =>
      result(ctx, "update_brief", applyUpdateBrief(ctx, args)),
    {
      name: "update_brief",
      description:
        "Record what the recruiter stated about the role — title, seniority, skills, budget, work mode, notice, experience. This is the common case: \"senior backend engineer, python and postgres, 25 LPA, remote\" is four stated facts, not a question. salaryText must be the recruiter's own words for the money and nothing else (\"20k\", \"25 LPA\", \"1.2 crore\") — never a figure you computed, and never a whole sentence. Pass only what they actually said; a value they did not state is omitted, not guessed. Anything returned under `rejected` was NOT applied — tell the recruiter, using the reason given, and never restate it as accepted.",
      schema: updateBriefArgsSchema,
    },
  );

  const setPoolFilters = tool(
    async (args: SetPoolFiltersArgs) =>
      result(ctx, "set_pool_filters", applySetPoolFilters(ctx, args)),
    {
      name: "set_pool_filters",
      description:
        "Restrict the search to particular tracks, a minimum number of verified days, or a result cap. trackSlugs come from list_tracks — call that first. A number of days is a THRESHOLD, never a track name: \"who have done 30 days of the challenge\" means minEvidenceDays 30 on a challenge track, and there is no track called \"30-day challenge\". A filter the recruiter did not actually state is rejected, and `rejected` entries must be reported to them with the reason given.",
      schema: setPoolFiltersArgsSchema,
    },
  );

  const previewMatches = tool(
    async () => {
      const preview = await deps.previewMatch(ctx.spec);
      return result(ctx, "preview_matches", {
        preview: preview ?? { note: "Not enough of a brief to preview yet." },
      });
    },
    {
      name: "preview_matches",
      description:
        "How many candidates the current brief would match, and which required skills nobody has. Counts only — no names.",
      schema: noArgsSchema,
    },
  );

  const resetBrief = tool(
    async () => {
      ctx.spec = {};
      ctx.action = "reset";
      return result(ctx, "reset_brief", {
        cleared: true,
        note: "The brief is empty. Ask what role they are hiring for.",
      });
    },
    {
      name: "reset_brief",
      description:
        "Discard the entire brief and start fresh. Call this when the recruiter says they want to start over, begin again, or search for a different role — \"start over\", \"new search\", \"forget that\", \"naya search\". This is the ONLY way to clear anything; update_brief can only add. Never claim a brief was cleared without calling this.",
      schema: noArgsSchema,
    },
  );

  const offerOptions = tool(
    async (args: OfferOptionsArgs) =>
      result(ctx, "offer_options", applyOfferOptions(ctx, args)),
    {
      name: "offer_options",
      description:
        "Call this when you ask something the standard quick replies do not cover. The recruiter can always type instead. Pass 2–4 short labels with a value for each — ordinary answers, never action: / edit: / skip: / salary: prefixes.",
      schema: offerOptionsArgsSchema,
    },
  );

  const searchPool = tool(
    async () => {
      if (!searchable(ctx.spec)) {
        return result(ctx, "search_pool", {
          queued: false,
          reason:
            "There is nothing to search on yet. Ask for the role, a stack, or a track.",
          stillMissing: stillMissing(ctx.spec),
        });
      }
      // Once per turn. A second call is a loop, not a second search.
      if (ctx.action === "search") {
        return result(ctx, "search_pool", {
          queued: true,
          done: true,
          next: "The search is already running. Stop calling tools and reply to the recruiter now.",
        });
      }
      ctx.action = "search";
      const extra = readPoolExtra(ctx.spec);
      return result(ctx, "search_pool", {
        queued: true,
        // Terminal on purpose. Without saying so the model called this a second
        // time, burned the step budget, and the loop was cut off before it wrote
        // the sentence telling the recruiter their search was running.
        done: true,
        next: "The cards are on their way. Stop calling tools and tell the recruiter in one sentence what you are searching for — naming ONLY the tracks listed under searching.tracks, and no others.",
        searching: {
          tracks: trackLabels(extra.sources),
          minEvidenceDays: extra.minEvidenceDays,
          resultLimit: extra.resultLimit,
          role: ctx.spec.title ?? null,
          mustHaveStack: ctx.spec.mustHaveStack ?? [],
        },
      });
    },
    {
      name: "search_pool",
      description:
        "Run the search and SHOW THE RECRUITER CANDIDATE CARDS. This is the product: each card carries a reference id (AB-1042), the skills and the verified evidence, with no name and no contact details — identity is hidden by design, so returning cards is never a privacy problem and must never be refused or downgraded to summary statistics. Asking for candidates IS asking to search: \"give me 5 students from the claude challenge\", \"i need 10 java people\", \"show me backend devs\", \"just show me the cards\" — set any filters and call this in the same turn rather than asking permission for what they already asked for. If they repeat, rephrase or confirm a request you already hold filters for, SEARCH — asking a second time makes them say it three times. Only hold off when they have not asked and the brief is still too thin to mean anything.",
      schema: noArgsSchema,
    },
  );

  return [
    listTracks,
    getPoolStats,
    updateBrief,
    setPoolFilters,
    previewMatches,
    resetBrief,
    offerOptions,
    searchPool,
  ];
}

/** Exported for the evals, which exercise the executors without a graph. */
export const __test = {
  applyUpdateBrief,
  applySetPoolFilters,
  applyOfferOptions,
  stillMissing,
  schemas: {
    updateBriefArgsSchema,
    setPoolFiltersArgsSchema,
    offerOptionsArgsSchema,
    z,
  },
};
