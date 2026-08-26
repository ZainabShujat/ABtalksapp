import { z } from "zod";

export const talentSenioritySchema = z.enum([
  "INTERN",
  "JUNIOR",
  "MID",
  "SENIOR",
  "LEAD",
]);

export const talentWorkModeSchema = z.enum([
  "ONSITE",
  "HYBRID",
  "REMOTE",
  "FLEXIBLE",
]);

export const talentEmploymentTypeSchema = z.enum([
  "FULL_TIME",
  "CONTRACT",
  "INTERNSHIP",
  "PART_TIME",
]);

export const talentMatchTierSchema = z.enum(["STRONG", "PARTIAL", "NONE"]);

export const evidenceDimensionSchema = z.enum([
  "missions",
  "clean_pass",
  "projects",
  "consistency",
  "interview",
  "stack",
  "data",
  "ai_prompting",
  "communication",
  "ship_speed",
]);

/** Partial job spec Scout accumulates across turns. */
export const jobSpecSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  seniority: talentSenioritySchema.optional().nullable(),
  openings: z.number().int().min(1).max(50).optional(),
  mustHaveStack: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  niceToHaveStack: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  evidencePriority: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  salaryMin: z.number().int().min(0).max(100_000_000).optional().nullable(),
  salaryMax: z.number().int().min(0).max(100_000_000).optional().nullable(),
  salaryCurrency: z.string().trim().min(3).max(3).optional(),
  salaryPeriod: z.enum(["ANNUAL", "MONTHLY"]).optional(),
  workMode: talentWorkModeSchema.optional().nullable(),
  locationCity: z.string().trim().max(80).optional().nullable(),
  employmentType: talentEmploymentTypeSchema.optional().nullable(),
  noticePeriodDays: z.number().int().min(0).max(180).optional().nullable(),
  minExperience: z.number().int().min(0).max(50).optional().nullable(),
  maxExperience: z.number().int().min(0).max(50).optional().nullable(),
  requiresDegree: z.boolean().optional(),
  extra: z.record(z.string(), z.unknown()).optional().nullable(),
});

export type JobSpec = z.infer<typeof jobSpecSchema>;

export const scoutOptionSchema = z.object({
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(120),
});

/** Phase A structured response from Scout conversation model. */
export const scoutTurnSchema = z.object({
  spec: jobSpecSchema,
  nextQuestion: z.string().max(500).nullable(),
  options: z.array(scoutOptionSchema).max(12),
  allowFreeText: z.boolean(),
  readyToSearch: z.boolean(),
  summary: z.string().max(1000),
  /**
   * An instruction to the client, decided by the engine.
   *
   * "Search verified talent" was a chip the client intercepted by its literal
   * value, so the button worked and typing "show me" did nothing. The engine
   * now says what should happen and the chip and the sentence take one path.
   */
  action: z.enum(["search", "reset"]).nullable().optional(),
  /**
   * A standalone message that is not an answer to a question — an honest limit
   * ("nobody has shared a location"), or the answer to something the recruiter
   * asked. Rendered above the question rather than glued onto it.
   */
  notice: z.string().max(700).nullable().optional(),
});

export type ScoutTurn = z.infer<typeof scoutTurnSchema>;

/* ── Scout agent tool arguments ──────────────────────────────────────────────
 *
 * The boundary between the model and the engine. Every argument the agent can
 * send arrives through one of these, so "Zod at every boundary" becomes the tool
 * definition itself rather than a convention someone has to remember.
 *
 * Optionality is `.nullish()`, and that is not cosmetic. With `.nullable()` every
 * field lands in the schema's `required` list, and Groq then rejects the call
 * outright — "missing properties: 'niceToHaveStack'" — because the model sends
 * only the fields it actually has values for. The whole turn 400s and the
 * recruiter gets a fallback sentence. `.nullish()` keeps them out of `required`,
 * so the model may omit a field or send null and both are accepted.
 */

/**
 * What the agent may state about the role.
 *
 * `salaryText` is a STRING on purpose, and it is the field worth explaining. The
 * model is not allowed to compute money: it quotes the recruiter ("20k", "25
 * LPA") and `parseMoney` decides the figure. When the model was asked for a
 * number instead, "20k" for an internship came back as ₹20,000 a year — a
 * twelvefold error, and silent, because nothing read the figure back.
 */
export const updateBriefArgsSchema = z.object({
  title: z.string().max(200).nullish(),
  seniority: talentSenioritySchema.nullish(),
  mustHaveStack: z.array(z.string().max(60)).max(12).nullish(),
  niceToHaveStack: z.array(z.string().max(60)).max(12).nullish(),
  evidencePriority: z.array(evidenceDimensionSchema).max(5).nullish(),
  employmentType: talentEmploymentTypeSchema.nullish(),
  workMode: talentWorkModeSchema.nullish(),
  locationCity: z.string().max(80).nullish(),
  noticePeriodDays: z.number().min(0).max(180).nullish(),
  minExperience: z.number().min(0).max(50).nullish(),
  maxExperience: z.number().min(0).max(50).nullish(),
  salaryText: z.string().max(120).nullish(),
});

export type UpdateBriefArgs = z.infer<typeof updateBriefArgsSchema>;

/**
 * Which candidates count.
 *
 * `trackSlugs` is `string[]` and deliberately NOT an enum. An enum here is
 * exactly what makes a track added next month unspeakable — the model could not
 * name a Java challenge that was never compiled into the schema. Unknown slugs
 * are rejected at execution time against the registry, and the rejection names
 * the tracks that do exist so the model can correct itself on the next hop.
 */
export const setPoolFiltersArgsSchema = z.object({
  trackSlugs: z.array(z.string().max(40)).max(8).nullish(),
  geo: z.enum(["IN", "US"]).nullish(),
  minEvidenceDays: z.number().min(1).max(60).nullish(),
  resultLimit: z.number().min(1).max(25).nullish(),
});

export type SetPoolFiltersArgs = z.infer<typeof setPoolFiltersArgsSchema>;

/**
 * Quick replies the agent may put under its own question.
 *
 * Protocol prefixes (`action:` / `edit:` / `skip:` / `salary:`) are reserved
 * for the engine. The model must not forge them — a chip with those values
 * would fire a search or clear a slot without the recruiter meaning to.
 */
const PROTOCOL_PREFIX = /^(action|edit|skip|salary):/i;

export const offerOptionsArgsSchema = z.object({
  options: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        value: z.string().trim().min(1).max(120),
      }),
    )
    .min(2)
    .max(4)
    .superRefine((options, ctx) => {
      options.forEach((option, i) => {
        if (PROTOCOL_PREFIX.test(option.value)) {
          ctx.addIssue({
            code: "custom",
            message: "That value is reserved for the engine.",
            path: [i, "value"],
          });
        }
      });
    }),
});

export type OfferOptionsArgs = z.infer<typeof offerOptionsArgsSchema>;

export const recordSampleDemandSchema = z
  .object({
    requestId: z.string().cuid().optional(),
    spec: jobSpecSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.requestId) return;
    if (!v.spec) {
      ctx.addIssue({
        code: "custom",
        message: "A request or a spec is required.",
        path: ["spec"],
      });
      return;
    }
    if (!v.spec.title?.trim() && (v.spec.mustHaveStack?.length ?? 0) === 0) {
      ctx.addIssue({
        code: "custom",
        message: "The spec has nothing to record.",
        path: ["spec"],
      });
    }
  });

export type RecordSampleDemandInput = z.infer<typeof recordSampleDemandSchema>;

/** `list_tracks`, `get_pool_stats`, `preview_matches`, `search_pool`. */
export const noArgsSchema = z.object({});

/**
 * Ordered question slots, highest information gain first.
 *
 * Shared by the server (which picks the next question and merges the reply into
 * exactly that slot) and the client (which renders progress). One list means an
 * answer can never land in the wrong field — the previous free-text parser
 * guessed, and filed job titles as required skills.
 */
export const HIRE_SLOTS = [
  "title",
  "seniority",
  "mustHaveStack",
  "evidencePriority",
  "salary",
  "employmentType",
  "workMode",
  "locationCity",
  "noticePeriodDays",
  "experience",
] as const;

export type HireSlot = (typeof HIRE_SLOTS)[number];

/**
 * Asked only if the recruiter brings them up. The default walk is role →
 * seniority → stack → budget. These stay on the spec so a typed "remote"
 * or an old request still stores them — we just stop opening with them.
 */
export const DEFAULT_SKIPPED_SLOTS: readonly HireSlot[] = [
  "evidencePriority",
  "employmentType",
  "workMode",
  "locationCity",
  "noticePeriodDays",
  "experience",
];

/** Mark the default-skipped slots so nextSlot does not ask them. */
export function applyDefaultSkipped(spec: JobSpec): JobSpec {
  const already = skippedSlots(spec);
  const add: HireSlot[] = [];
  for (const slot of DEFAULT_SKIPPED_SLOTS) {
    if (!already.has(slot) && !isSlotFilled(spec, slot)) add.push(slot);
  }
  if (add.length === 0) return spec;
  const prior = (spec.extra ?? {}) as Record<string, unknown>;
  return {
    ...spec,
    extra: { ...prior, skipped: [...already, ...add] },
  };
}

/**
 * Slots the recruiter explicitly declined to answer.
 *
 * Most slots have a sentinel that reads as a real answer — "any city",
 * "flexible", "evidence only". Seniority and evidence priority have none, so
 * the refusal itself is the record. Without this, a chip-only question the
 * recruiter could not answer had no exit at all and the conversation could
 * never reach the end.
 */
export function skippedSlots(spec: JobSpec): Set<HireSlot> {
  const raw = (spec.extra as { skipped?: unknown } | null | undefined)?.skipped;
  if (!Array.isArray(raw)) return new Set<HireSlot>();
  return new Set(
    raw.filter((s): s is HireSlot => HIRE_SLOTS.includes(s as HireSlot)),
  );
}

/** Slots that don't apply to this spec, so progress stays honest. */
export function inapplicableSlots(spec: JobSpec): Set<HireSlot> {
  const skip = skippedSlots(spec);
  // A remote role has no office city to ask about.
  if (spec.workMode === "REMOTE") skip.add("locationCity");
  return skip;
}

export function isSlotFilled(spec: JobSpec, slot: HireSlot): boolean {
  switch (slot) {
    case "title":
      return Boolean(spec.title?.trim());
    case "seniority":
      return spec.seniority != null;
    case "mustHaveStack":
      return (spec.mustHaveStack?.length ?? 0) > 0;
    case "evidencePriority":
      return (spec.evidencePriority?.length ?? 0) > 0;
    case "salary":
      return spec.salaryMin != null || spec.salaryMax != null;
    case "employmentType":
      return spec.employmentType != null;
    case "workMode":
      return spec.workMode != null;
    case "locationCity":
      return Boolean(spec.locationCity?.trim());
    case "noticePeriodDays":
      return spec.noticePeriodDays != null;
    case "experience":
      return spec.minExperience != null || spec.maxExperience != null;
  }
}

/** Progress for the UI: how many applicable slots are answered. */
export function hireProgress(spec: JobSpec): { done: number; total: number } {
  const skip = inapplicableSlots(spec);
  const applicable = HIRE_SLOTS.filter((s) => !skip.has(s));
  return {
    done: applicable.filter((s) => isSlotFilled(spec, s)).length,
    total: applicable.length,
  };
}

export const candidateAvailabilitySchema = z
  .object({
    openToWork: z.boolean(),
    expectedSalaryMin: z.number().int().min(0).max(100_000_000).nullable().optional(),
    expectedSalaryMax: z.number().int().min(0).max(100_000_000).nullable().optional(),
    salaryCurrency: z.string().trim().min(3).max(3).default("INR"),
    noticePeriodDays: z.number().int().min(0).max(180).nullable().optional(),
    preferredWorkMode: talentWorkModeSchema.nullable().optional(),
    preferredCities: z.array(z.string().trim().min(1).max(60)).max(5).default([]),
    openToRelocate: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (
      v.expectedSalaryMin != null &&
      v.expectedSalaryMax != null &&
      v.expectedSalaryMax < v.expectedSalaryMin
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Max salary must be ≥ min salary.",
        path: ["expectedSalaryMax"],
      });
    }
  });

export type CandidateAvailabilityInput = z.infer<
  typeof candidateAvailabilitySchema
>;

export const sendScoutMessageSchema = z.object({
  requestId: z.string().cuid().optional(),
  message: z.string().trim().min(1).max(2000),
  /**
   * What the recruiter actually saw, when they tapped a chip whose machine
   * value differs from its label ("Within 30 days" → "30"). Display only —
   * the engine always parses `message`.
   */
  display: z.string().trim().min(1).max(200).optional(),
});

export const runMatchSchema = z.object({
  requestId: z.string().cuid(),
});

export const guestScoutHistorySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2000),
});

export const guestScoutMessageSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  display: z.string().trim().min(1).max(200).optional(),
  spec: jobSpecSchema,
  history: z.array(guestScoutHistorySchema).max(40),
});

export const guestMatchSchema = z.object({
  spec: jobSpecSchema,
});

/** Persist a guest Scout transcript onto a TalentRequest after sign-in. */
export const adoptGuestScoutSessionSchema = z.object({
  spec: jobSpecSchema,
  summary: z.string().max(1000).optional(),
  searched: z.boolean().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4000),
        options: z.array(scoutOptionSchema).max(12).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
});
