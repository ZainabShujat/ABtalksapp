/**
 * 078 Phase 2c — UserRoleAssignment backfill.
 * CANDIDATE per CandidateProfile; RECRUITER per RecruiterProfile; ADMIN per ADMIN_EMAILS.
 */
import { config } from "dotenv";
import { PlatformRole, PrismaClient, RoleScopeType } from "@prisma/client";
import {
  assertChildBranch,
  chunked,
  resolveSampleUserIds,
  runStep,
  whereUserId,
} from "./migrate-078-shared";

const prisma = new PrismaClient();

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function main() {
  config({ path: ".env.local" });
  config();
  assertChildBranch();
  await runStep(prisma, "2c-roles", async (ctx) => {
    const sample = await resolveSampleUserIds(ctx.prisma);
    const uw = whereUserId(sample);
    const [candidates, recruiters, admins] = await Promise.all([
      ctx.prisma.candidateProfile.findMany({
        where: uw,
        select: {
          userId: true,
          user: { select: { createdAt: true } },
        },
      }),
      ctx.prisma.recruiterProfile.findMany({
        where: uw,
        select: {
          userId: true,
          user: { select: { createdAt: true } },
        },
      }),
      ctx.prisma.user.findMany({
        where: { email: { in: adminEmails(), mode: "insensitive" } },
        select: { id: true, createdAt: true, email: true },
      }),
    ]);

    type Row = {
      userId: string;
      role: PlatformRole;
      scopeType: RoleScopeType;
      grantedAt: Date;
    };
    const rows: Row[] = [];
    for (const c of candidates) {
      rows.push({
        userId: c.userId,
        role: PlatformRole.CANDIDATE,
        scopeType: RoleScopeType.GLOBAL,
        grantedAt: c.user.createdAt,
      });
    }
    for (const r of recruiters) {
      rows.push({
        userId: r.userId,
        role: PlatformRole.RECRUITER,
        scopeType: RoleScopeType.GLOBAL,
        grantedAt: r.user.createdAt,
      });
    }
    for (const a of admins) {
      rows.push({
        userId: a.id,
        role: PlatformRole.ADMIN,
        scopeType: RoleScopeType.GLOBAL,
        grantedAt: a.createdAt,
      });
    }

    const existing = await ctx.prisma.userRoleAssignment.findMany({
      where: { revokedAt: null },
      select: { userId: true, role: true, scopeType: true, scopeId: true },
    });
    const have = new Set(
      existing.map((e) => `${e.userId}|${e.role}|${e.scopeType}|${e.scopeId ?? ""}`),
    );
    const fresh = rows.filter(
      (r) => !have.has(`${r.userId}|${r.role}|${r.scopeType}|`),
    );

    let created = 0;
    await chunked(fresh, 200, async (chunk) => {
      const result = await ctx.prisma.userRoleAssignment.createMany({
        data: chunk.map((r) => ({
          userId: r.userId,
          role: r.role,
          scopeType: r.scopeType,
          grantedByUserId: null,
          grantedAt: r.grantedAt,
        })),
        skipDuplicates: true,
      });
      created += result.count;
    });

    return {
      candidateSources: candidates.length,
      recruiterSources: recruiters.length,
      adminSources: admins.length,
      created,
    };
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
