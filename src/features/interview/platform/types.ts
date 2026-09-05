import type { Competency, PlannedQuestion } from "@/features/interview/types";
import type { ProctorEvent } from "@/features/interview/proctoring/types";
import type {
  DeepProbe,
  QuestionMode,
  ScaffoldProbe,
} from "@/features/interview/cohort/question-bank";

/**
 * The interview platform's vocabulary (plan 103).
 *
 * This module exists to unbundle what `blueprint` currently does five jobs for:
 * who may take an interview, what it covers, which questions it asks, how often
 * it may be taken, and how it is scored and reported. Each is a field on an
 * `InterviewDomain` here, so a new interview is a config entry plus a pack
 * rather than a fork of the feature.
 *
 * Pure module: no `server-only`, no Prisma, no network. Everything below is a
 * type or a constant, so the whole platform config layer is testable from a
 * plain script.
 *
 * NOTE on the cohort imports: `DeepProbe`, `ScaffoldProbe` and `QuestionMode`
 * are `import type` only. They are generic question-shape types that
 * `PlannedQuestion` already refers to by the same path, so re-declaring them
 * here would create two incompatible spellings of one shape. Being type-only,
 * the import is erased at compile time — no cohort module is loaded at runtime,
 * and no cohort VALUE (a blueprint, a day number) enters this folder.
 */

/* ------------------------------------------------------------ capabilities */

/**
 * A workspace an interview can offer alongside the voice channel.
 *
 * Phase 1 serves `VOICE` only. The other two are declared now so that adding
 * them later is a new component plus a domain-config edit, rather than a change
 * to the turn loop: the room mounts workspaces from `plan.capabilities`, which
 * is frozen at open exactly as the question set is.
 */
export const CAPABILITIES = ["VOICE", "CODE_SANDBOX", "WHITEBOARD"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Capabilities Phase 1 can actually serve. Asserted in `domains.ts`. */
export const SERVEABLE_CAPABILITIES: readonly Capability[] = ["VOICE"];

/* ------------------------------------------------------------ submissions */

export type TurnArtifactKind = "CODE" | "DIAGRAM" | "FILE";

/**
 * Non-text evidence produced by a workspace.
 *
 * Always absent in Phase 1. It exists now because the alternative is worse: a
 * code sandbox added later against a bare `answerText: string` would have to
 * change the Server Action signature, the graph's entry channel, the persisted
 * turn row and every evidence path in one commit. Introducing the wrapper while
 * only `text` is populated costs one type and one nullable column.
 */
export type TurnArtifact = {
  kind: TurnArtifactKind;
  /** e.g. "text/x-python", "application/json". */
  mime: string;
  content: string;
  /** Workspace-specific detail: language, cursor state, execution result. */
  meta?: Record<string, string | number | boolean | null>;
};

/**
 * What a candidate submits for one turn.
 *
 * `text` is the spoken transcript (or the typed emergency fallback) and is the
 * only field the Phase 1 pipeline reads. Everything downstream of the Server
 * Action still receives a plain string, so the engine is untouched.
 */
export type TurnSubmission = {
  text: string;
  artifacts?: TurnArtifact[];
  /**
   * Proctoring observations for this turn (Proctoring v0.1).
   *
   * Already validated and normalised by the Server Action before it gets here,
   * so the service stores them without inspecting them. Nothing in the engine,
   * the planner or the scorer reads this field — it is an audit trail written
   * alongside the turn, not an input to it.
   */
  clientEvents?: ProctorEvent[];
};

/* ---------------------------------------------------------------- rubrics */

/**
 * One scored dimension of a domain rubric.
 *
 * `id` is a string rather than the engine's five-value `Competency` union
 * because a Behavioral or DSA interview measures things the cohort rubric has
 * no name for. Scores keyed by these ids are stored as JSON, not as the named
 * columns `GeneralInterview` uses — which is precisely why the platform needs
 * its own table.
 */
export type PlatformCompetency = {
  id: string;
  label: string;
  /** Weights across a rubric must total 100. Asserted at module load. */
  weight: number;
  expectations: string;
  /**
   * True when this dimension is judged across every answer rather than by
   * questions assigned to it — the cohort's COMMUNICATION case, generalised.
   *
   * The cohort selects that behaviour with a hard-coded
   * `competency === "COMMUNICATION"` check in `evidence.ts`. Making it a flag
   * means a rubric without a communication axis simply has no such dimension,
   * instead of silently scoring one it never measured.
   */
  observedAcrossAnswers: boolean;
};

export type RubricDefinition = {
  id: string;
  label: string;
  competencies: readonly PlatformCompetency[];
};

/* ------------------------------------------------------------------ packs */

export type PackSection = {
  id: string;
  label: string;
};

/**
 * One authored question in a pack.
 *
 * Intentionally the same shape as a cohort `CoreQuestion` minus the cohort-only
 * fields (`sourceDays`, `sourceLabel`, `groundsOn`) and plus the two the
 * platform needs (`sectionId`, `platformCompetencyId`). Keeping the evidence
 * contract identical is what lets the existing depth ladder, policy and
 * `scoreQuestion` work on a pack question with no changes at all.
 */
export type PackQuestion = {
  /** Stable id. Persisted in plans, turns, evidence and reports — never renumber. */
  id: string;
  sectionId: string;
  /**
   * The ENGINE competency, one of the five. Drives the competence signal and
   * the escalation ceiling in `depth.ts`. Not what the report reports.
   */
  competency: Competency;
  /** The DOMAIN RUBRIC competency this question scores against. */
  platformCompetencyId: string;
  difficulty: "easy" | "medium" | "hard";
  mode: QuestionMode;
  /** Asked verbatim. The grading target; never rewritten. */
  text: string;
  /** What a complete spoken answer contains. Drives evaluation and follow-ups. */
  expectedEvidence: string[];
  /** Items needed before the answer counts as sufficient. */
  minEvidence: number;
  /** Follow-up budget. 0 means never probe. */
  maxFollowUps: number;
  /** Deterministic fallback probe when model drafting fails. */
  followUpPrompt: string | null;
  /** Escalation rungs for a candidate who already cleared the bar. */
  deepProbes?: readonly DeepProbe[];
  /** Narrower probes for a candidate below the bar. */
  scaffoldProbes?: readonly ScaffoldProbe[];
};

/**
 * A published, immutable pack version.
 *
 * Immutability is not a style preference: reports cite question ids
 * permanently, so editing a published pack silently changes what a stored
 * report is claiming. Changes create a new `version`, and domains pin one.
 */
export type InterviewPack = {
  id: string;
  version: number;
  domainSlug: string;
  /** Rubric this pack's questions are written against. Cross-checked at load. */
  rubricId: string;
  sections: readonly PackSection[];
  questions: readonly PackQuestion[];
};

export type PackRef = {
  packId: string;
  version: number;
};

/* ---------------------------------------------------------------- domains */

export type DomainStatus = "LIVE" | "COMING_SOON" | "RETIRED";

/** Which builder turns a domain into a plan. See `question-strategy.ts`. */
export type QuestionStrategyId = "AUTHORED_PACK" | "SCENARIO";

/** Which optional sections a domain's report renders. */
export type ReportProfile = {
  sections: boolean;
  competencies: boolean;
  skills: boolean;
  transcriptExcerpts: boolean;
  agentInsights: boolean;
};

export type InterviewDomain = {
  /** URL segment and stable identity. Persisted on every attempt. */
  slug: string;
  label: string;
  /** One line for the catalogue card. */
  blurb: string;
  /**
   * A fuller explanation of what this interview is for, shown on its detail
   * page. Exists because a one-line blurb cannot stop a candidate confusing two
   * adjacent domains — the reader needs to know what the interview is NOT as
   * much as what it is. Optional: a domain with an unambiguous name can omit it.
   */
  purpose?: string;
  /** Catalogue grouping, e.g. "AI", "General". Presentation only. */
  family: string;
  status: DomainStatus;
  /**
   * The rubric this domain is scored against.
   *
   * NULL until the domain has one. A COMING_SOON entry genuinely has no rubric
   * yet, and naming an unrelated one to satisfy the type would be worse than a
   * null: the next person to read the registry would reasonably assume the
   * pairing was a decision. `assertDomainIntegrity` requires non-null for LIVE,
   * so a startable domain can never be missing it.
   */
  rubricId: string | null;
  strategy: QuestionStrategyId;
  /** Null until the domain has an authored pack. Required for LIVE. */
  packRef: PackRef | null;
  durationSec: number;
  capabilities: readonly Capability[];
  reportProfile: ReportProfile;
  /** Whether an interrupted attempt may be re-entered. False in Phase 1. */
  resumable: boolean;
  /** Null means unlimited retakes, which is the point of a mock interview. */
  maxAttempts: number | null;
};

/** What the catalogue and the domain page are allowed to see. Plain data only. */
export type DomainSummary = {
  slug: string;
  label: string;
  blurb: string;
  family: string;
  status: DomainStatus;
  durationSec: number;
  questionCount: number;
  capabilities: string[];
};

/* ------------------------------------------------------------------ plans */

/**
 * A platform question as the engine sees it.
 *
 * Alias rather than a new type: `runInterviewTurn` takes an `InterviewPlan`, so
 * a platform question must BE a `PlannedQuestion`. The alias documents that
 * `sectionId` and `platformCompetencyId` are always populated on this path.
 */
export type PlatformPlannedQuestion = PlannedQuestion &
  Required<Pick<PlannedQuestion, "sectionId" | "platformCompetencyId">>;
