import "server-only";
import { CertificateType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { generateCertificateId } from "./generate-certificate-id";

/** Stamped into metadata so a future event can be told apart from this one. */
export const HACKATHON_EVENT_KEY = "vicodathon-2026";

export type HackathonCertificateResult =
  | { ok: true; data: { certificateId: string; alreadyIssued: boolean } }
  | { ok: false; message: string };

export async function ensureHackathonCertificate(
  userId: string,
): Promise<HackathonCertificateResult> {
  const participant = await prisma.hackathonParticipant.findUnique({
    where: { userId },
    select: {
      fullName: true,
      isLeader: true,
      team: {
        select: {
          id: true,
          teamCode: true,
          teamName: true,
          entryType: true,
          submission: {
            select: {
              repoUrl: true,
              liveUrl: true,
              aiLogUrl: true,
              updatedAt: true,
              problem: { select: { title: true } },
            },
          },
        },
      },
    },
  });

  if (!participant) {
    return { ok: false, message: "Not registered for the hackathon" };
  }

  const submission = participant.team.submission;
  if (!submission) {
    return { ok: false, message: "Team has no submission" };
  }

  const repoUrl = submission.repoUrl.trim();
  const liveUrl = submission.liveUrl.trim();
  if (!repoUrl || !liveUrl) {
    return { ok: false, message: "Submission is missing a repo URL or a live URL" };
  }

  const existing = await prisma.certificate.findFirst({
    where: { userId, type: CertificateType.HACKATHON },
    select: { certificateId: true },
  });
  if (existing) {
    return {
      ok: true,
      data: { certificateId: existing.certificateId, alreadyIssued: true },
    };
  }

  const fullName = participant.fullName.trim();
  if (!fullName) {
    return {
      ok: false,
      message: "Participant has no name on their hackathon registration",
    };
  }

  try {
    const certificateId = await generateCertificateId(CertificateType.HACKATHON);
    const created = await prisma.certificate.create({
      data: {
        certificateId,
        userId,
        type: CertificateType.HACKATHON,
        recipientName: fullName,
        domain: null,
        enrollmentId: null,
        issuedAt: new Date(),
        metadata: {
          event: HACKATHON_EVENT_KEY,
          teamId: participant.team.id,
          teamCode: participant.team.teamCode,
          teamName: participant.team.teamName,
          entryType: participant.team.entryType,
          isLeader: participant.isLeader,
          problemTitle: submission.problem?.title ?? null,
          repoUrl,
          liveUrl,
          submittedAt: submission.updatedAt.toISOString(),
        },
      },
      select: { certificateId: true },
    });
    return {
      ok: true,
      data: { certificateId: created.certificateId, alreadyIssued: false },
    };
  } catch (error) {
    logger.error("Could not issue hackathon certificate", {
      userId,
      error: String(error),
    });
    return { ok: false, message: "Could not issue certificate" };
  }
}
