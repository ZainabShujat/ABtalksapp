/**
 * 078 Phase 2g — Certificate → Credential. Public id is reused verbatim.
 */
import { config } from "dotenv";
import {
  CertificateStatus,
  CertificateType,
  CredentialSourceType,
  CredentialStatus,
  CredentialType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  assertChildBranch,
  chunked,
  peIdForEnrollment,
  resolveSampleUserIds,
  runStep,
  whereUserId,
} from "./migrate-078-shared";

const prisma = new PrismaClient();

function mapStatus(s: CertificateStatus): CredentialStatus {
  return s === CertificateStatus.REVOKED ? CredentialStatus.REVOKED : CredentialStatus.ISSUED;
}

function hackathonVariant(metadata: Prisma.JsonValue | null): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const v = (metadata as { hackathonVariant?: unknown }).hackathonVariant;
  return typeof v === "string" ? v : undefined;
}

function mapType(cert: {
  type: CertificateType;
  metadata: Prisma.JsonValue | null;
}): CredentialType {
  if (cert.type === CertificateType.HACKATHON) {
    return hackathonVariant(cert.metadata) ? CredentialType.PLACEMENT : CredentialType.PARTICIPATION;
  }
  if (cert.type === CertificateType.WORKSHOP) return CredentialType.PARTICIPATION;
  return CredentialType.COMPLETION;
}

function mapSource(cert: {
  type: CertificateType;
  enrollmentId: string | null;
  id: string;
  metadata: Prisma.JsonValue | null;
}): { sourceType: CredentialSourceType; sourceKey: string } {
  if (cert.type === CertificateType.HACKATHON) {
    const meta = cert.metadata;
    const teamId =
      meta && typeof meta === "object" && !Array.isArray(meta)
        ? (meta as { teamId?: unknown }).teamId
        : null;
    return {
      sourceType: CredentialSourceType.HACKATHON_TEAM,
      sourceKey: typeof teamId === "string" ? `${teamId}:${cert.id}` : cert.id,
    };
  }
  if (cert.type === CertificateType.WORKSHOP) {
    return { sourceType: CredentialSourceType.WORKSHOP_REGISTRATION, sourceKey: cert.id };
  }
  if (cert.type === CertificateType.COHORT) {
    return { sourceType: CredentialSourceType.COHORT, sourceKey: cert.id };
  }
  if (cert.enrollmentId) {
    return {
      sourceType: CredentialSourceType.PROGRAM_ENROLLMENT,
      sourceKey: peIdForEnrollment(cert.enrollmentId),
    };
  }
  return { sourceType: CredentialSourceType.PROGRAM_ENROLLMENT, sourceKey: cert.id };
}

async function main() {
  config({ path: ".env.local" });
  config();
  assertChildBranch();
  await runStep(prisma, "2g-credentials", async (ctx) => {
    const sample = await resolveSampleUserIds(ctx.prisma);
    const certs = await ctx.prisma.certificate.findMany({ where: whereUserId(sample) });
    let copied = 0;
    await chunked(certs, 50, async (chunk) => {
      for (const c of chunk) {
        const source = mapSource(c);
        await ctx.prisma.credential.upsert({
          where: { credentialId: c.certificateId },
          create: {
            credentialId: c.certificateId,
            userId: c.userId,
            type: mapType(c),
            sourceType: source.sourceType,
            sourceKey: source.sourceKey,
            status: mapStatus(c.status),
            title: c.type,
            recipientName: c.recipientName,
            metadata: (c.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            issuedAt: c.issuedAt,
            revokedAt: c.revokedAt,
            revokedReason: c.revokedReason,
          },
          update: {
            status: mapStatus(c.status),
            recipientName: c.recipientName,
            metadata: (c.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            revokedAt: c.revokedAt,
            revokedReason: c.revokedReason,
          },
        });
        copied += 1;
      }
    });
    return { credentials: copied };
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
