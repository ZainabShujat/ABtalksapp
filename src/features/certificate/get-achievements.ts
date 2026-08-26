import "server-only";
import { CertificateStatus, CertificateType } from "@prisma/client";
import { formatDateIST } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import { listForUser } from "@/repositories/credentials";
import type { CredentialView } from "@/repositories/types";
import {
  CERTIFICATE_TYPES,
  HACKATHON_VARIANT_LABELS,
  certificateTypeFromCredentialTitle,
  parseHackathonVariant,
} from "./constants";
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

function metaRecord(metadata: unknown): Record<string, unknown> {
  if (metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function achievementFromCredential(row: CredentialView): AchievementView | null {
  const type = certificateTypeFromCredentialTitle(row.title);
  if (!type) return null;

  const meta = metaRecord(row.metadata);
  const typeConfig = CERTIFICATE_TYPES[type];

  let statusLabel = "Issued";
  let stats: { label: string; value: string }[] = [];

  if (type === CertificateType.CLAUDE_CHALLENGE) {
    statusLabel = "Completed";
    const daysCompleted =
      typeof meta.daysCompleted === "number" ? meta.daysCompleted : 0;
    const longestStreak =
      typeof meta.longestStreak === "number" ? meta.longestStreak : 0;
    stats = [
      { label: "Days completed", value: String(daysCompleted) },
      { label: "Longest streak", value: String(longestStreak) },
    ];
  } else if (type === CertificateType.HACKATHON) {
    const hackathonVariant = parseHackathonVariant(meta.hackathonVariant);
    statusLabel = hackathonVariant
      ? HACKATHON_VARIANT_LABELS[hackathonVariant]
      : "Participated";
    stats = [
      ...(hackathonVariant
        ? [
            {
              label: "Placement",
              value: HACKATHON_VARIANT_LABELS[hackathonVariant],
            },
          ]
        : []),
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
    key: row.credentialId,
    title: typeConfig.title,
    subtitle: typeConfig.subtitle,
    certificateId: row.credentialId,
    issuedOn: formatDateIST(row.issuedAt),
    statusLabel,
    stats,
    status: row.status === CertificateStatus.REVOKED ? "REVOKED" : "COMPLETED",
  };
}

export async function getAchievements(userId: string): Promise<AchievementView[]> {
  try {
    await ensureClaudeCertificate(userId);
  } catch (error) {
    logger.error("ensureClaudeCertificate failed during getAchievements", {
      userId,
      error: String(error),
    });
  }

  const rows = await listForUser(userId);
  const achievements: AchievementView[] = [];
  for (const row of rows) {
    const view = achievementFromCredential(row);
    if (!view) {
      logger.error("Skipping credential with unmapped certificate title", {
        userId,
        credentialId: row.credentialId,
        title: row.title,
      });
      continue;
    }
    achievements.push(view);
  }
  return achievements;
}
