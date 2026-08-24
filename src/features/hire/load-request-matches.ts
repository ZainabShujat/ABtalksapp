import "server-only";

import { prisma } from "@/lib/db";
import { encodeCandidateRef } from "@/features/hire/candidate-ref";
import { existingEngagements } from "@/features/hire/contact-access";
import { estimateCompensation, formatBandLpa } from "@/features/hire/compensation";
import { roleFamilyFor, tidyRoleLabel } from "@/features/hire/role-family";
import type { MatchTier } from "@/features/hire/types";
import type { MatchCardData } from "@/components/hire/match-card";
import {
  pickPublicEvidence,
  pickPublicScores,
} from "@/features/hire/to-public-match";

/**
 * Matches for one requirement, ready to render, for one recruiter.
 *
 * Shared by the requirement page and the full candidate list. It is one place
 * on purpose: the query is scoped to the caller's own request, and it
 * selects given name for the card heading. Company, email and profile URLs
 * stay off this query.
 */
export async function loadRequestMatches(
  requestId: string,
  recruiterUserId: string,
): Promise<{
  title: string;
  status: string;
  alertWhenAvailable: boolean;
  matches: MatchCardData[];
  cartCount: number;
} | null> {
  const request = await prisma.talentRequest.findFirst({
    where: { id: requestId, recruiterUserId },
    select: {
      title: true,
      status: true,
      alertWhenAvailable: true,
      mustHaveStack: true,
      matches: {
        orderBy: { score: "desc" },
        select: {
          programMemberId: true,
          studentUserId: true,
          source: true,
          score: true,
          tier: true,
          scoreBreakdown: true,
          rationale: true,
          gaps: true,
          availabilityUnknown: true,
          evidence: true,
          programMember: {
            select: {
              jobRole: true,
              fullName: true,
              shortlistedBy: {
                where: { recruiterUserId },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      },
    },
  });
  if (!request) return null;

  // Engagements are keyed on the candidate's user id, which both sources fill —
  // a challenge candidate has no ProgramMember row to key on.
  const candidateUserIds = request.matches
    .map((m) => m.studentUserId)
    .filter((id): id is string => id !== null);

  const [engagements, cartCount, namedUsers] = await Promise.all([
    existingEngagements(recruiterUserId, candidateUserIds),
    prisma.recruiterShortlistItem.count({ where: { recruiterUserId } }),
    candidateUserIds.length
      ? prisma.user.findMany({
          where: { id: { in: candidateUserIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string | null }[]),
  ]);
  const nameByUser = new Map(
    namedUsers
      .filter((u) => u.name && u.name.trim())
      .map((u) => [u.id, u.name!.trim()]),
  );

  return {
    title: request.title,
    status: request.status,
    alertWhenAvailable: request.alertWhenAvailable,
    cartCount,
    matches: request.matches.map((m): MatchCardData => {
      const raw =
        m.evidence && typeof m.evidence === "object"
          ? (m.evidence as Record<string, unknown>)
          : {};
      const evidence = pickPublicEvidence(raw);
      // Older rows stored CandidateEvidence.interview as a nested object.
      const nested = raw.interview;
      if (nested && typeof nested === "object") {
        const iv = nested as Record<string, unknown>;
        if (evidence.interviewOverall == null && typeof iv.overall === "number") {
          evidence.interviewOverall = iv.overall;
        }
        if (evidence.interviewComm == null && typeof iv.comm === "number") {
          evidence.interviewComm = iv.comm;
        }
        if (evidence.interviewTech == null && typeof iv.tech === "number") {
          evidence.interviewTech = iv.tech;
        }
        if (evidence.interviewProblem == null && typeof iv.problem === "number") {
          evidence.interviewProblem = iv.problem;
        }
      }
      const storedLocation =
        typeof raw.locationLabel === "string" && raw.locationLabel.trim()
          ? raw.locationLabel.trim()
          : null;
      const source = m.source === "PROGRAM" ? "PROGRAM" : m.source;
      const isProgram = source === "PROGRAM";
      // The stored evidence blob carries the challenge candidate's role label;
      // there is no ProgramMember row to read it from.
      const rawRole =
        m.programMember?.jobRole ??
        (typeof (m.evidence as { jobRole?: unknown })?.jobRole === "string"
          ? ((m.evidence as { jobRole: string }).jobRole)
          : "");
      // Recomputed rather than stored: the band is a view of the role and the
      // tier, and a frozen copy would drift the moment the table is retuned.
      const band = estimateCompensation({
        roleFamily: roleFamilyFor(rawRole),
        yearsExperience: evidence.yearsExperience ?? 0,
        evidenceTier: m.tier as MatchTier,
        missionsPassed: evidence.missionsPassed ?? 0,
      });
      return {
        candidateRef: encodeCandidateRef(
          source === "PROGRAM" ||
            source === "CLAUDE" ||
            source === "CHALLENGE_60" ||
            source === "HACKATHON"
            ? source
            : "CLAUDE",
          (isProgram ? m.programMemberId : m.studentUserId) ?? "",
        ),
        source:
          source === "PROGRAM" ||
          source === "CLAUDE" ||
          source === "CHALLENGE_60" ||
          source === "HACKATHON"
            ? source
            : "CLAUDE",
        programMemberId: m.programMemberId,
        displayName:
          (m.programMember?.fullName?.trim() ||
            (m.studentUserId ? nameByUser.get(m.studentUserId) : null)) ??
          null,
        jobRole: rawRole ? tidyRoleLabel(rawRole) : "Candidate",
        locationLabel: storedLocation,
        score: m.score,
        tier: m.tier,
        rationale: m.rationale,
        gaps: m.gaps,
        availabilityUnknown: m.availabilityUnknown,
        shortlisted: (m.programMember?.shortlistedBy?.length ?? 0) > 0,
        engagementStatus: m.studentUserId
          ? (engagements.get(m.studentUserId)?.status ?? null)
          : null,
        scores: pickPublicScores(m.scoreBreakdown),
        compensationBand:
          raw.compensationDeclared === true &&
          typeof raw.compensationBand === "string"
            ? raw.compensationBand
            : band
              ? formatBandLpa(band)
              : null,
        compensationDeclared: raw.compensationDeclared === true,
        highlightSkills: request.mustHaveStack.length
          ? request.mustHaveStack
          : undefined,
        evidence,
      };
    }),
  };
}
