import { z } from "zod";
import { jobSpecSchema } from "@/lib/validations/hire";

/**
 * Boundary schemas for the virtual candidate flow.
 *
 * The recruiter-facing shapes carry the requirement and the recruiter's own
 * constraints, and nothing else. There is deliberately no field here for a
 * candidate name, contact or employer: the request is for work to be done, and
 * a schema that cannot express an identity is one fewer place an identity can
 * be invented.
 */

export const virtualCandidateRequestSchema = z.object({
  /** The requirement, as Scout assembled it. */
  spec: jobSpecSchema,
  /** The TalentRequest this was asked from, when there is one. */
  talentRequestId: z.string().cuid().optional().nullable(),
  /** How long the recruiter can wait. Their constraint, not our promise. */
  timelineDays: z.number().int().min(1).max(365).optional().nullable(),
  recruiterNote: z.string().trim().max(2000).optional().nullable(),
});

export type VirtualCandidateRequestInput = z.infer<
  typeof virtualCandidateRequestSchema
>;

export const cancelVirtualRequestSchema = z.object({
  requestId: z.string().cuid(),
});

export const virtualRequestStatusSchema = z.enum([
  "REQUESTED",
  "SOURCING",
  "CANDIDATE_FOUND",
  "CANDIDATE_SHARED",
  "FULFILLED",
  "CANCELLED",
  "EXPIRED",
]);

export const updateVirtualRequestSchema = z.object({
  requestId: z.string().cuid(),
  status: virtualRequestStatusSchema,
  note: z.string().trim().max(2000).optional().nullable(),
  /** ISO date. When the sourcing team expects to have someone. */
  expectedBy: z.string().datetime().optional().nullable(),
  assignedAdminId: z.string().cuid().optional().nullable(),
});

export const linkRealCandidateSchema = z.object({
  requestId: z.string().cuid(),
  /** A real User id. Validated against the table before anything is written. */
  candidateUserId: z.string().cuid(),
  note: z.string().trim().max(2000).optional().nullable(),
});

export const listVirtualRequestsSchema = z.object({
  status: virtualRequestStatusSchema.optional(),
  page: z.number().int().min(1).max(1000).optional(),
  perPage: z.number().int().min(1).max(100).optional(),
});
