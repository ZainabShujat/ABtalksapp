/**
 * 078 Phase 2b — CandidateVisibility.
 *
 * Intended searchable population:
 * - Every ProgramMember (AI Cohort), including members who never set
 *   recruiterVisibilityConsentAt. Recruiter search is a platform default, not a
 *   candidate preference.
 * - Users created after the first successful 2b run (consentSource =
 *   platform_default).
 *
 * Other legacy users stay closed. Explicit recruiterVisibilityConsentAt is
 * copied onto ProgramMembers as program_apply_migrated for audit only.
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

    const members = await ctx.prisma.programMember.findMany({
      where: whereUserId(sample),
      select: {
        userId: true,
        recruiterVisibilityConsentAt: true,
        createdAt: true,
        enrolledAt: true,
      },
    });
    const memberUserIds = new Set(members.map((m) => m.userId));
    const consentByUser = new Map<string, Date>();
    const memberSince = new Map<string, Date>();
    for (const m of members) {
      const since = m.enrolledAt ?? m.createdAt;
      const prevSince = memberSince.get(m.userId);
      if (!prevSince || since < prevSince) memberSince.set(m.userId, since);
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
        if (memberUserIds.has(u.id)) {
          return {
            userId: u.id,
            searchableByRecruiters: true,
            consentSource: PLATFORM_DEFAULT_SOURCE,
            consentedAt: memberSince.get(u.id) ?? u.createdAt,
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

    let cohortOpened = 0;
    const cohortWithoutConsent = [...memberUserIds].filter(
      (id) => !consentByUser.has(id),
    );
    await chunked(cohortWithoutConsent, 50, async (chunk) => {
      const result = await ctx.prisma.candidateVisibility.updateMany({
        where: { userId: { in: chunk }, withdrawnAt: null },
        data: {
          searchableByRecruiters: true,
          consentSource: PLATFORM_DEFAULT_SOURCE,
        },
      });
      cohortOpened += result.count;
    });

    const protectedIds = new Set([...memberUserIds, ...consentByUser.keys()]);
    const closeIds = sample
      ? sample.filter((id) => !protectedIds.has(id))
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
                : { notIn: [...protectedIds] },
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
      cohortOpened,
      cohortMembers: memberUserIds.size,
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
