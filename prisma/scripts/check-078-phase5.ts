/**
 * Plan 078 Phase 5 extras for an unscoped rehearsal child.
 * Complements migrate-078-verify.ts (V1–V10). Refuses production.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { PrismaClient, ProgramMemberStatus } from "@prisma/client";
import {
  assertChildBranch,
  assertNotSampleChildForFullRun,
} from "./migrate-078-shared";

const prisma = new PrismaClient();

function slugForDomain(domain: string): string {
  const map: Record<string, string> = {
    SE: "software-engineering-challenge",
    DS: "data-science-challenge",
    AI: "ai-engineering-challenge",
    CLAUDE: "claude-challenge",
  };
  return map[domain] ?? domain.toLowerCase();
}

const MEMBER_TO_PE: Record<ProgramMemberStatus, string> = {
  APPLIED: "APPLIED",
  WAITLISTED: "WAITLISTED",
  ENROLLED: "ACTIVE",
  COMPLETED: "COMPLETED",
  DROPPED: "DROPPED",
};

async function main() {
  assertChildBranch();
  assertNotSampleChildForFullRun();

  const pointsVsUser = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
      FROM "PointsAccount" pa
      JOIN "User" u ON u.id = pa."userId"
     WHERE pa.balance <> u."synergyPoints"
  `;
  const ledgerVsAccount = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM (
      SELECT pa."userId"
        FROM "PointsAccount" pa
        LEFT JOIN "PointsTransaction" pt ON pt."userId" = pa."userId"
       GROUP BY pa."userId", pa.balance
      HAVING pa.balance <> COALESCE(SUM(pt.amount), 0)
    ) q
  `;
  const searchable = await prisma.candidateVisibility.count({
    where: {
      searchableByRecruiters: true,
      NOT: { consentSource: "platform_default" },
    },
  });
  const consented = await prisma.programMember.groupBy({
    by: ["userId"],
    where: { recruiterVisibilityConsentAt: { not: null } },
  });
  const leak = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "CandidateVisibility" v
     WHERE v."searchableByRecruiters" = true
       AND v."consentSource" IS DISTINCT FROM 'platform_default'
       AND NOT EXISTS (
         SELECT 1 FROM "ProgramMember" m
          WHERE m."userId" = v."userId" AND m."recruiterVisibilityConsentAt" IS NOT NULL)
  `;

  const memberByStatus = await prisma.programMember.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const peMemberByStatus = await prisma.programEnrollment.groupBy({
    by: ["status"],
    where: { id: { startsWith: "pe_pm_" } },
    _count: { _all: true },
  });
  const peCount = (s: string) =>
    peMemberByStatus.find((r) => r.status === s)?._count._all ?? 0;
  const statusPairs = (Object.keys(MEMBER_TO_PE) as ProgramMemberStatus[]).map(
    (legacy) => {
      const mapped = MEMBER_TO_PE[legacy];
      const left =
        memberByStatus.find((r) => r.status === legacy)?._count._all ?? 0;
      const right = peCount(mapped);
      return { legacy, mapped, legacyCount: left, newCount: right, delta: left - right };
    },
  );

  const recruiters = await prisma.recruiterProfile.count();
  const orgMembers = await prisma.organizationMember.count();
  const shortlists = await prisma.recruiterShortlistItem.count();
  const listItems = await prisma.talentListItem.count();

  const enrollments = await prisma.enrollment.findMany({
    select: { userId: true },
    distinct: ["userId"],
    take: 200,
    orderBy: { startedAt: "desc" },
  });
  const userIds = enrollments.map((e) => e.userId);
  const [legacyEnr, legacyMem, nextPe] = await Promise.all([
    prisma.enrollment.findMany({
      where: { userId: { in: userIds }, status: { in: ["ACTIVE", "COMPLETED"] } },
      select: { userId: true, domain: true, status: true },
    }),
    prisma.programMember.findMany({
      where: { userId: { in: userIds }, status: { in: ["ENROLLED", "COMPLETED"] } },
      select: { userId: true, status: true },
    }),
    prisma.programEnrollment.findMany({
      where: { userId: { in: userIds }, status: { in: ["ACTIVE", "COMPLETED"] } },
      select: {
        userId: true,
        status: true,
        cohort: {
          select: { programVersion: { select: { program: { select: { slug: true } } } } },
        },
      },
    }),
  ]);

  let slugMismatches = 0;
  let statusMismatches = 0;
  let missingNew = 0;
  for (const userId of userIds) {
    const lSlugs = [
      ...legacyEnr.filter((e) => e.userId === userId).map((e) => slugForDomain(e.domain)),
      ...legacyMem.filter((m) => m.userId === userId).map(() => "ai-cohort-program"),
    ].sort();
    const nSlugs = nextPe
      .filter((r) => r.userId === userId)
      .map((r) => r.cohort.programVersion.program.slug)
      .sort();
    const lStatus = [
      ...legacyEnr
        .filter((e) => e.userId === userId)
        .map((e) => (e.status === "COMPLETED" ? "COMPLETED" : "ACTIVE")),
      ...legacyMem
        .filter((m) => m.userId === userId)
        .map((m) => (m.status === "COMPLETED" ? "COMPLETED" : "ACTIVE")),
    ].sort();
    const nStatus = nextPe
      .filter((r) => r.userId === userId)
      .map((r) => (r.status === "COMPLETED" ? "COMPLETED" : "ACTIVE"))
      .sort();
    if (nSlugs.length === 0 && lSlugs.length > 0) missingNew += 1;
    if (JSON.stringify(lSlugs) !== JSON.stringify(nSlugs)) slugMismatches += 1;
    if (JSON.stringify(lStatus) !== JSON.stringify(nStatus)) statusMismatches += 1;
  }

  const report = {
    pointsAccountVsUserSynergy: Number(pointsVsUser[0]?.n ?? 0),
    pointsLedgerVsAccount: Number(ledgerVsAccount[0]?.n ?? 0),
    searchableByRecruiters: searchable,
    consentedProgramMembers: consented.length,
    visibilityCountDelta: searchable - consented.length,
    visibilityLeak: Number(leak[0]?.n ?? 0),
    programMemberStatuses: statusPairs,
    recruiters,
    organizationMembers: orgMembers,
    shortlistItems: shortlists,
    talentListItems: listItems,
    shortlistDelta: shortlists - listItems,
    shadow: {
      compared: userIds.length,
      missingNew,
      slugMismatches,
      statusMismatches,
    },
  };
  console.log(JSON.stringify(report, null, 2));

  const failures: string[] = [];
  if (report.pointsAccountVsUserSynergy !== 0) failures.push("pointsAccountVsUserSynergy");
  if (report.pointsLedgerVsAccount !== 0) failures.push("pointsLedgerVsAccount");
  if (report.visibilityCountDelta !== 0) failures.push("visibilityCountDelta");
  if (report.visibilityLeak !== 0) failures.push("visibilityLeak");
  if (statusPairs.some((p) => p.delta !== 0)) failures.push("programMemberStatusDelta");
  if (report.shortlistDelta !== 0) failures.push("shortlistDelta");
  if (report.shadow.slugMismatches !== 0 || report.shadow.statusMismatches !== 0) {
    failures.push("shadowRead");
  }
  if (failures.length > 0) {
    throw new Error(`Phase 5 extras failed: ${failures.join(",")}`);
  }
  console.log("Phase 5 extras: all zero. This is verification pass #1 only if V1–V10 also passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
