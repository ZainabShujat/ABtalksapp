import "server-only";
import { CertificateStatus, CertificateType } from "@prisma/client";
import { formatDateIST } from "@/lib/date-utils";
import { certificateIdSchema } from "@/lib/validations/certificate";
import { getByPublicId } from "@/repositories/credentials";
import type { CredentialView } from "@/repositories/types";
import {
  CERTIFICATE_TYPES,
  HACKATHON_VARIANT_LABELS,
  certificateDomainLabel,
  certificateTypeFromCredentialTitle,
  domainForCertificateType,
  parseHackathonVariant,
  type HackathonCertificateVariant,
} from "./constants";

export type PublicCertificateView = {
  certificateId: string;
  recipientName: string;
  type: CertificateType;
  title: string;
  subtitle: string;
  issuedOn: string;
  /** "Completed" for the challenge, "Participated" for the hackathon. */
  statusLabel: string;
  /** Extra rows for the details list. Already stringified. */
  details: { label: string; value: string }[];
  /** Placement artwork for extra HACKATHON rows. Null = participation. */
  hackathonVariant: HackathonCertificateVariant | null;
  isRevoked: boolean;
};

function metaRecord(metadata: unknown): Record<string, unknown> {
  if (metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

export function publicCertificateFromCredential(
  row: CredentialView,
): PublicCertificateView | null {
  const type = certificateTypeFromCredentialTitle(row.title);
  if (!type) return null;

  const meta = metaRecord(row.metadata);
  const typeConfig = CERTIFICATE_TYPES[type];
  const domain = domainForCertificateType(type);

  let statusLabel = "Issued";
  const details: { label: string; value: string }[] = [];

  if (type === CertificateType.CLAUDE_CHALLENGE) {
    statusLabel = "Completed";
    if (domain != null) {
      details.push({
        label: "Track",
        value: certificateDomainLabel(domain),
      });
    }
    if (typeof meta.daysCompleted === "number") {
      details.push({
        label: "Days completed",
        value: String(meta.daysCompleted),
      });
    }
    if (typeof meta.longestStreak === "number") {
      details.push({
        label: "Longest streak",
        value: String(meta.longestStreak),
      });
    }
  } else if (type === CertificateType.HACKATHON) {
    const hackathonVariant = parseHackathonVariant(meta.hackathonVariant);
    statusLabel = hackathonVariant
      ? HACKATHON_VARIANT_LABELS[hackathonVariant]
      : "Participated";
    details.push({
      label: "Team",
      value: typeof meta.teamName === "string" ? meta.teamName : "Solo entry",
    });
    details.push({
      label: "Brief",
      value: typeof meta.problemTitle === "string" ? meta.problemTitle : "—",
    });
  }

  const hackathonVariant =
    type === CertificateType.HACKATHON
      ? parseHackathonVariant(meta.hackathonVariant)
      : null;

  return {
    certificateId: row.credentialId,
    recipientName: row.recipientName,
    type,
    title: typeConfig.title,
    subtitle: typeConfig.subtitle,
    issuedOn: formatDateIST(row.issuedAt),
    statusLabel,
    details,
    hackathonVariant,
    isRevoked: row.status === CertificateStatus.REVOKED,
  };
}

export async function getPublicCertificate(
  rawId: string,
): Promise<PublicCertificateView | null> {
  const parsed = certificateIdSchema.safeParse(rawId);
  if (!parsed.success) return null;

  const row = await getByPublicId(parsed.data);
  if (!row) return null;
  return publicCertificateFromCredential(row);
}
