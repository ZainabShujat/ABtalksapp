import "server-only";
import { CertificateType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { HackathonCertificateVariant } from "./constants";
import { generateCertificateId } from "./generate-certificate-id";

/** Stamped into metadata so a future event can be told apart from this one. */
export const HACKATHON_EVENT_KEY = "vicodathon-2026";

/** 00:00 IST on 14 Aug 2026 — DATE OF ISSUE on ViCoDathon certs. */
export const HACKATHON_CERTIFICATE_ISSUED_AT = new Date(
  "2026-08-13T18:30:00.000Z",
);

export type HackathonCertificateResult =
  | { ok: true; data: { certificateId: string; alreadyIssued: boolean } }
  | { ok: false; message: string };

const PARTICIPANT_SELECT = {
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
} as const;

export async function ensureHackathonCertificate(
  userId: string,
): Promise<HackathonCertificateResult> {
  const participant = await prisma.hackathonParticipant.findUnique({
    where: { userId },
    select: PARTICIPANT_SELECT,
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

function metadataVariant(
  metadata: unknown,
): string | undefined {
  if (
    metadata !== null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    "hackathonVariant" in metadata
  ) {
    const value = (metadata as { hackathonVariant?: unknown }).hackathonVariant;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export async function ensureHackathonAwardCertificate(input: {
  userId: string;
  variant: HackathonCertificateVariant;
  recipientName: string;
}): Promise<HackathonCertificateResult> {
  const { userId, variant } = input;
  const recipientName = input.recipientName.trim();
  if (!recipientName) {
    return { ok: false, message: "Recipient name is required" };
  }

  const participant = await prisma.hackathonParticipant.findUnique({
    where: { userId },
    select: PARTICIPANT_SELECT,
  });

  if (!participant) {
    return { ok: false, message: "Not registered for the hackathon" };
  }

  const existingRows = await prisma.certificate.findMany({
    where: { userId, type: CertificateType.HACKATHON },
    select: { certificateId: true, metadata: true },
  });
  const existingAward = existingRows.find(
    (row) => metadataVariant(row.metadata) === variant,
  );
  if (existingAward) {
    return {
      ok: true,
      data: { certificateId: existingAward.certificateId, alreadyIssued: true },
    };
  }

  const submission = participant.team.submission;
  const repoUrl = submission?.repoUrl.trim() ?? "";
  const liveUrl = submission?.liveUrl.trim() ?? "";

  try {
    const certificateId = await generateCertificateId(CertificateType.HACKATHON);
    const created = await prisma.certificate.create({
      data: {
        certificateId,
        userId,
        type: CertificateType.HACKATHON,
        recipientName,
        domain: null,
        enrollmentId: null,
        issuedAt: HACKATHON_CERTIFICATE_ISSUED_AT,
        metadata: {
          event: HACKATHON_EVENT_KEY,
          teamId: participant.team.id,
          teamCode: participant.team.teamCode,
          teamName: participant.team.teamName,
          entryType: participant.team.entryType,
          isLeader: participant.isLeader,
          problemTitle: submission?.problem?.title ?? null,
          repoUrl,
          liveUrl,
          submittedAt: submission?.updatedAt.toISOString() ?? null,
          hackathonVariant: variant,
        },
      },
      select: { certificateId: true },
    });
    return {
      ok: true,
      data: { certificateId: created.certificateId, alreadyIssued: false },
    };
  } catch (error) {
    logger.error("Could not issue hackathon award certificate", {
      userId,
      variant,
      error: String(error),
    });
    return { ok: false, message: "Could not issue certificate" };
  }
}
