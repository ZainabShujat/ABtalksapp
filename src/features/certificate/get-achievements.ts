import "server-only";
import { CertificateStatus, CertificateType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateIST } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import { CERTIFICATE_TYPES } from "./constants";
import { ensureClaudeCertificate } from "./issue-certificate";

export type AchievementView = {
  key: string;
  title: string;
  subtitle: string;
  certificateId: string;
  issuedOn: string;
  statusLabel: string;
  stats: { label: string; value: string }[];
  status: "COMPLETED" | "REVOKED";
};

export async function getAchievements(userId: string): Promise<AchievementView[]> {
  try {
    await ensureClaudeCertificate(userId);
  } catch (error) {
    logger.error("ensureClaudeCertificate failed during getAchievements", {
      userId,
      error: String(error),
    });
  }

  const certificates = await prisma.certificate.findMany({
    where: { userId },
    select: {
      id: true,
      certificateId: true,
      type: true,
      status: true,
      issuedAt: true,
      metadata: true,
    },
    orderBy: { issuedAt: "desc" },
  });

  return certificates.map((cert) => {
    const meta =
      cert.metadata !== null &&
      typeof cert.metadata === "object" &&
      !Array.isArray(cert.metadata)
        ? (cert.metadata as Record<string, unknown>)
        : {};
    const typeConfig = CERTIFICATE_TYPES[cert.type];

    let statusLabel = "Issued";
    let stats: { label: string; value: string }[] = [];

    if (cert.type === CertificateType.CLAUDE_CHALLENGE) {
      statusLabel = "Completed";
      const daysCompleted =
        typeof meta.daysCompleted === "number" ? meta.daysCompleted : 0;
      const longestStreak =
        typeof meta.longestStreak === "number" ? meta.longestStreak : 0;
      stats = [
        { label: "Days completed", value: String(daysCompleted) },
        { label: "Longest streak", value: String(longestStreak) },
      ];
    } else if (cert.type === CertificateType.HACKATHON) {
      statusLabel = "Participated";
      stats = [
        {
          label: "Team",
          value: typeof meta.teamName === "string" ? meta.teamName : "Solo entry",
        },
        {
          label: "Brief",
          value: typeof meta.problemTitle === "string" ? meta.problemTitle : "—",
        },
      ];
    }

    return {
      key: cert.id,
      title: typeConfig.title,
      subtitle: typeConfig.subtitle,
      certificateId: cert.certificateId,
      issuedOn: formatDateIST(cert.issuedAt),
      statusLabel,
      stats,
      status:
        cert.status === CertificateStatus.REVOKED ? "REVOKED" : "COMPLETED",
    };
  });
}
