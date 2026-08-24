/**
 * 078 Phase 2b — CandidateVisibility.
 *
 * Legacy users (present at the first successful 2b run, or created before that
 * run's finishedAt): searchable ONLY when ProgramMember.recruiterVisibilityConsentAt
 * is set. Do not silently open existing users who never opted in.
 *
 * Users created after that first successful 2b run: platform-default searchable
 * (consentSource = platform_default). The schema default is also true so app
 * creates without an explicit value are searchable.
 *
 * openToWork / CandidatePreference is independent and is not written here.
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

const LEGACY_CONSENT_SOURCE = "program_apply_migrated";
const PLATFORM_DEFAULT_SOURCE = "platform_default";

async function main() {
  config({ path: ".env.local" });
  config();
  assertChildBranch();
  await runStep(prisma, "2b-visibility", async (ctx) => {
    const priorOk = await ctx.prisma.migrationRun.findFirst({
      where: {
        step: "2b-visibility",
        ok: true,
        id: { not: ctx.runId },
        finishedAt: { not: null },
      },
      orderBy: { finishedAt: "asc" },
      select: { finishedAt: true },
    });
    const cutoff = priorOk?.finishedAt ?? null;

    const sample = await resolveSampleUserIds(ctx.prisma);
    const users = await ctx.prisma.user.findMany({
      where: sample ? { id: { in: sample } } : undefined,
      select: { id: true, createdAt: true },
    });
    const existing = await ctx.prisma.candidateVisibility.findMany({
      select: { userId: true },
    });
    const have = new Set(existing.map((r) => r.userId));

    const consented = await ctx.prisma.programMember.findMany({
      where: {
        recruiterVisibilityConsentAt: { not: null },
        ...whereUserId(sample),
      },
      select: { userId: true, recruiterVisibilityConsentAt: true },
    });
    const consentByUser = new Map<string, Date>();
    for (const m of consented) {
      const at = m.recruiterVisibilityConsentAt;
      if (!at) continue;
      const prev = consentByUser.get(m.userId);
      if (!prev || at < prev) consentByUser.set(m.userId, at);
    }

    const missing = users
      .filter((u) => !have.has(u.id))
      .map((u) => {
        const legacy = !cutoff || u.createdAt < cutoff;
        if (consentByUser.has(u.id)) {
          return {
            userId: u.id,
            searchableByRecruiters: true,
            consentSource: LEGACY_CONSENT_SOURCE,
            consentedAt: consentByUser.get(u.id)!,
          };
        }
        if (legacy) {
          return {
            userId: u.id,
            searchableByRecruiters: false,
            consentSource: null as string | null,
            consentedAt: null as Date | null,
          };
        }
        return {
          userId: u.id,
          searchableByRecruiters: true,
          consentSource: PLATFORM_DEFAULT_SOURCE,
          consentedAt: new Date(),
        };
      });

    let inserted = 0;
    await chunked(missing, 200, async (chunk) => {
      const result = await ctx.prisma.candidateVisibility.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      inserted += result.count;
    });

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
              consentSource: LEGACY_CONSENT_SOURCE,
              withdrawnAt: null,
            },
          }),
        ),
      );
      optedIn += chunk.length;
    });

    const closeIds = sample
      ? sample.filter((id) => !consentByUser.has(id))
      : null;
    const closed =
      closeIds && closeIds.length === 0
        ? { count: 0 }
        : await ctx.prisma.candidateVisibility.updateMany({
            where: {
              searchableByRecruiters: true,
              consentSource: LEGACY_CONSENT_SOURCE,
              userId: closeIds
                ? { in: closeIds }
                : { notIn: [...consentByUser.keys()] },
            },
            data: {
              searchableByRecruiters: false,
              consentSource: null,
              consentedAt: null,
            },
          });

    console.log(
      "2b-visibility cutoff",
      cutoff ? cutoff.toISOString() : "first-run (treat all missing as legacy)",
    );
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
