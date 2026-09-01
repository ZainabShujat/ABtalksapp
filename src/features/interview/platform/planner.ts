import { buildRubricSnapshot } from "@/features/interview/rubric";
import { pickFor } from "@/features/interview/agent/policy";
import { getPack } from "@/features/interview/platform/packs";
import { rubricSnapshotFor } from "@/features/interview/platform/rubrics";
import { resolveStrategy } from "@/features/interview/platform/question-strategy";
import type { InterviewDomain } from "@/features/interview/platform/types";
import type { InterviewPlan, PlatformPlanContext } from "@/features/interview/types";

/**
 * Turns a domain into the frozen plan an attempt runs on.
 *
 * The platform equivalent of `cohort/planner.ts:planCohortInterview`, and
 * deliberately thinner: there is no grounding (a mock candidate has no submitted
 * artifacts to point at), no extension questions (no milestone to be beyond),
 * and no model-phrasing call (the pack wording is the comparability guarantee,
 * and generation already happened offline under human review).
 *
 * What IS frozen here, and why each matters:
 *   questions      so a pack edit cannot alter an attempt already in flight
 *   rubric         so a stored report stays interpretable against the rubric it
 *                  was actually scored under
 *   capabilities   so a domain-config change cannot add a workspace to a room
 *                  that is already running
 *   packId/Version so a report can always be traced to the exact questions asked
 *
 * Pure module: no `server-only`, no Prisma. It takes a domain and a name, which
 * is all a plan needs.
 */

/* ------------------------------------------------------------ the opening */

/**
 * The interviewer's opening line.
 *
 * Written here rather than by widening `policy.ts:openingLine`, which is typed
 * `Record<"DAY_15" | "DAY_31", …>` and speaks in cohort terms ("your Day 15
 * checkpoint", "the thirty-one days"). Neither the type nor the words fit a mock
 * interview, and forcing them to would be the same mistake as passing a fake
 * blueprint.
 *
 * Seeded rather than random, for the reason `policy.ts` documents: the opening
 * is spoken once and stored in the transcript, so replaying an attempt must
 * reproduce it. Authored rather than model-drafted, because this is the one line
 * guaranteed to be spoken and it cannot depend on a provider being up.
 *
 * 4 x 3 x 3 = 36 openings per domain.
 */
const GREETINGS = [
  (n: string) => (n ? `Hi ${n}, thanks for making the time.` : "Thanks for making the time."),
  (n: string) => (n ? `${n}, good to meet you. Thanks for doing this.` : "Good to meet you. Thanks for doing this."),
  (n: string) => (n ? `Hi ${n}. Thanks for sitting down with me.` : "Thanks for sitting down with me."),
  (n: string) => (n ? `Hey ${n}, glad we could do this.` : "Glad we could do this."),
] as const;

const SHAPES = [
  (label: string, minutes: number) =>
    `This is a practice ${label} interview, about ${minutes} minutes. I'll ask you a few questions and dig into some of your answers as we go.`,
  (label: string, minutes: number) =>
    `We're doing a practice ${label} interview. It runs about ${minutes} minutes, and I'll follow up on anything I want to understand better.`,
  (label: string, minutes: number) =>
    `This is ${label} practice, roughly ${minutes} minutes. I'll push on a few of your answers along the way.`,
] as const;

const PERMISSIONS = [
  "Think out loud rather than giving me the short version. If you'd like me to repeat or clarify anything, just ask, and if you don't know something, say so and we'll move on.",
  "Talk me through your reasoning as you go. Ask me to repeat or rephrase anything you need, and if something isn't familiar, just say so and we'll keep going.",
  "I'd rather hear your thinking than a polished answer. Stop me any time if you want a question again, and saying you don't know is completely fine.",
] as const;

/**
 * Said only when the candidate actually has a profile worth acknowledging.
 *
 * Deliberately vague about WHAT it read. The first question is authored and
 * fixed, so a specific promise ("let's start with your RAG work") would be a
 * lie. This claims only what is true — that the interviewer arrived informed —
 * and leaves the specifics to the turns, where the model has the profile in
 * front of it and a real answer to attach them to.
 */
const CONTEXT_CLAUSES = [
  "I've had a look at your profile, so I have some idea of what you've been working on.",
  "I've read through your profile beforehand, so I know roughly where you've been working.",
  "I had a look at your background before we started.",
] as const;

export function platformOpeningLine(params: {
  domain: InterviewDomain;
  firstName?: string | null;
  /** True when there is a real profile behind this attempt. */
  hasProfile?: boolean;
  /** Unique per attempt in production; tests pass a constant to pin the output. */
  seed?: string;
}): string {
  const name = (params.firstName ?? "").trim();
  const seed = params.seed ?? "";
  const minutes = Math.round(params.domain.durationSec / 60);

  const greeting = pickFor(GREETINGS, `p:greet:${seed}`)(name);
  const shape = pickFor(SHAPES, `p:shape:${seed}`)(params.domain.label, minutes);
  const permission = pickFor(PERMISSIONS, `p:perm:${seed}`);

  const context = params.hasProfile
    ? ` ${pickFor(CONTEXT_CLAUSES, `p:ctx:${seed}`)}`
    : "";

  return `${greeting}${context} ${shape}\n\n${permission}`;
}

/* --------------------------------------------------------------- the plan */

export function buildPlatformPlan(
  domain: InterviewDomain,
  context: {
    candidateFirstName?: string | null;
    /**
     * Compact description of the candidate from their own profile. Frozen into
     * the plan so a profile edited mid-interview cannot change the conversation
     * underneath them. CONTEXT ONLY — see `platform/profile-context.ts`.
     */
    profileContext?: string | null;
  } = {},
): InterviewPlan {
  if (!domain.packRef || !domain.rubricId) {
    throw new Error(
      `[platform-planner] ${domain.slug} has no ${!domain.packRef ? "packRef" : "rubricId"} ` +
        `and cannot be planned. Only a LIVE domain is startable — ` +
        `getStartableDomain should have rejected this before now.`,
    );
  }

  const pack = getPack(domain.packRef);
  const strategy = resolveStrategy(domain.strategy);
  const questions = strategy.buildQuestions(domain, context);

  if (questions.length === 0) {
    throw new Error(
      `[platform-planner] ${domain.slug} produced no questions.`,
    );
  }

  const contextSummary: PlatformPlanContext = {
    kind: "PLATFORM",
    domainSlug: domain.slug,
    domainLabel: domain.label,
    packId: pack.id,
    packVersion: pack.version,
    questionCount: questions.length,
    sections: pack.sections.map((s) => ({ id: s.id, label: s.label })),
    rubric: rubricSnapshotFor(domain.rubricId),
    capabilities: [...domain.capabilities],
    candidateFirstName: context.candidateFirstName ?? null,
    profileContext: context.profileContext ?? null,
  };

  return {
    questions,
    // Cohort provenance field. Written for shape compatibility and read by
    // nothing — platform scoring reads `contextSummary.rubric`. See the comment
    // on `InterviewPlan.rubricSnapshot`.
    rubricSnapshot: buildRubricSnapshot(),
    contextSummary,
  };
}

/** Narrows a plan to a platform one. Used wherever the context kind matters. */
export function platformContextOf(
  plan: InterviewPlan,
): PlatformPlanContext | null {
  return plan.contextSummary.kind === "PLATFORM" ? plan.contextSummary : null;
}
