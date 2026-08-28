import { z } from "zod";

export const talentCandidateSourceSchema = z.enum([
  "PROGRAM",
  "CHALLENGE_60",
  "CLAUDE",
  "HACKATHON",
]);

export const talentEngagementStatusSchema = z.enum([
  "DRAFT",
  "SUBMITTED",
  "IN_REVIEW",
  "CONTACT_SHARED",
  "DECLINED",
  "CLOSED",
]);

/**
 * A candidate handle: the source, then the internal id for that source.
 *
 * Never the AB-#### label — that is a display string and must not be usable to
 * address a row. Shape is validated here; *eligibility* is re-checked against
 * the source's own table in the action, because a well-formed ref proves
 * nothing about whether this recruiter should be able to reach that person.
 */
export const candidateRefSchema = z
  .string()
  .regex(/^(PROGRAM|CLAUDE):c[a-z0-9]{6,}$/, "Invalid candidate reference.");

/** A recruiter asking to be introduced to one candidate. */
export const placeEngagementRequestSchema = z.object({
  candidateRef: candidateRefSchema,
  requestId: z.string().cuid().optional(),
  note: z.string().trim().max(2000).optional(),
});

/**
 * One submission covering several shortlisted candidates.
 *
 * Capped at 25 because this is a hiring shortlist, not a mailing list — and
 * every row here becomes work for a human on the ABTalks side.
 */
export const placeBulkEngagementRequestSchema = z.object({
  candidateRefs: z.array(candidateRefSchema).min(1).max(25),
  requestId: z.string().cuid().optional(),
  note: z.string().trim().max(2000).optional(),
});

export const engagementMessageSchema = z.object({
  engagementId: z.string().cuid(),
  body: z.string().trim().min(1).max(2000),
});

/** Admin decision on a request. Only these transitions are offered. */
export const decideEngagementSchema = z.object({
  engagementId: z.string().cuid(),
  decision: z.enum(["IN_REVIEW", "CONTACT_SHARED", "DECLINED", "CLOSED"]),
  note: z.string().trim().max(2000).optional(),
});

export type PlaceEngagementRequestInput = z.infer<
  typeof placeEngagementRequestSchema
>;
