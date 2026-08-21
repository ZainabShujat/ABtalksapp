/**
 * 078 Phase 2b — CandidateVisibility. Default CLOSED; opt-in ONLY from
 * ProgramMember.recruiterVisibilityConsentAt.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import {
  assertChildBranch,
  chunked,
  resolveSampleUserIds,
  runStep,
  whereUserId,
} from "./migrate-078-shared";

const prisma = new PrismaClient();

async function main() {
  config({ path: ".env.local" });
  config();
  assertChildBranch();
  await runStep(prisma, "2b-visibility", async (ctx) => {
    const sample = await resolveSampleUserIds(ctx.prisma);
    const users = await ctx.prisma.user.findMany({
      where: sample ? { id: { in: sample } } : undefined,
      select: { id: true },
    });
    const existing = await ctx.prisma.candidateVisibility.findMany({
      select: { userId: true },
    });
    const have = new Set(existing.map((r) => r.userId));
    const missing = users.filter((u) => !have.has(u.id)).map((u) => ({
      userId: u.id,
      searchableByRecruiters: false,
    }));
    let inserted = 0;
    await chunked(missing, 200, async (chunk) => {
      const result = await ctx.prisma.candidateVisibility.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      inserted += result.count;
    });

    const consented = await ctx.prisma.programMember.findMany({
      where: { recruiterVisibilityConsentAt: { not: null }, ...whereUserId(sample) },
      select: { userId: true, recruiterVisibilityConsentAt: true },
    });
    const consentByUser = new Map<string, Date>();
    for (const m of consented) {
      const at = m.recruiterVisibilityConsentAt;
      if (!at) continue;
      const prev = consentByUser.get(m.userId);
      if (!prev || at < prev) consentByUser.set(m.userId, at);
    }

    let optedIn = 0;
    const consentEntries = [...consentByUser.entries()];
    await chunked(consentEntries, 50, async (chunk) => {
      await ctx.prisma.$transaction(
        chunk.map(([userId, consentedAt]) =>
          ctx.prisma.candidateVisibility.update({
            where: { userId },
            data: {
              searchableByRecruiters: true,
              consentedAt,
              consentSource: "program_apply_migrated",
              withdrawnAt: null,
            },
          }),
        ),
      );
      optedIn += chunk.length;
    });

    const closed = await ctx.prisma.candidateVisibility.updateMany({
      where: {
        searchableByRecruiters: true,
        userId: { notIn: [...consentByUser.keys()] },
      },
      data: { searchableByRecruiters: false, consentSource: null, consentedAt: null },
    });

    return {
      users: users.length,
      inserted,
      optedIn,
      forcedClosed: closed.count,
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
