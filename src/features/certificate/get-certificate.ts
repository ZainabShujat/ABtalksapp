import "server-only";
import { CertificateStatus, CertificateType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateIST } from "@/lib/date-utils";
import { certificateIdSchema } from "@/lib/validations/certificate";
import {
  CERTIFICATE_TYPES,
  certificateDomainLabel,
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
  isRevoked: boolean;
};

export async function getPublicCertificate(
  rawId: string,
): Promise<PublicCertificateView | null> {
  const parsed = certificateIdSchema.safeParse(rawId);
  if (!parsed.success) return null;

  const cert = await prisma.certificate.findUnique({
    where: { certificateId: parsed.data },
    select: {
      certificateId: true,
      recipientName: true,
      type: true,
      status: true,
      domain: true,
      issuedAt: true,
      metadata: true,
    },
  });

  if (!cert) return null;

  const meta =
    cert.metadata !== null &&
    typeof cert.metadata === "object" &&
    !Array.isArray(cert.metadata)
      ? (cert.metadata as Record<string, unknown>)
      : {};
  const typeConfig = CERTIFICATE_TYPES[cert.type];

  let statusLabel = "Issued";
  const details: { label: string; value: string }[] = [];

  if (cert.type === CertificateType.CLAUDE_CHALLENGE) {
    statusLabel = "Completed";
    if (cert.domain != null) {
      details.push({
        label: "Track",
        value: certificateDomainLabel(cert.domain),
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
  } else if (cert.type === CertificateType.HACKATHON) {
    statusLabel = "Participated";
    details.push({
      label: "Team",
      value: typeof meta.teamName === "string" ? meta.teamName : "Solo entry",
    });
    details.push({
      label: "Brief",
      value: typeof meta.problemTitle === "string" ? meta.problemTitle : "—",
    });
  }

  return {
    certificateId: cert.certificateId,
    recipientName: cert.recipientName,
    type: cert.type,
    title: typeConfig.title,
    subtitle: typeConfig.subtitle,
    issuedOn: formatDateIST(cert.issuedAt),
    statusLabel,
    details,
    isRevoked: cert.status === CertificateStatus.REVOKED,
  };
}
