/**
 * Plan 078 Phase 5 extras. Complements migrate-078-verify.ts (V1–V10).
 *
 * Production: PHASE2_ALLOW_PRODUCTION=1 and a direct (non-pooler) DATABASE_URL.
 * Pass #2: PHASE5_PASS=2 — refused until 24h after pass #1
 * (2026-08-24T15:57:57.897Z). PHASE5_INTERVAL_START defaults to that timestamp.
 *
 * Recruiter-visible population is every ProgramMember plus searchable
 * platform_default rows — not consent-only ProgramMembers.
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

const PASS1_AT = Date.parse("2026-08-24T15:57:57.897Z");
const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000;

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

function assertPass2Interval(): void {
  if (process.env.PHASE5_PASS !== "2") return;
  const earliest = PASS1_AT + TWENTY_FOUR_H_MS;
  if (Date.now() < earliest) {
    throw new Error(
      `Phase 5 pass #2 refused: earliest ${new Date(earliest).toISOString()} ` +
        `(24h after pass #1 ${new Date(PASS1_AT).toISOString()}).`,
    );
  }
}

function intervalStart(): Date {
  const raw = process.env.PHASE5_INTERVAL_START ?? "2026-08-24T15:57:57.897Z";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`PHASE5_INTERVAL_START is not a valid date: ${raw}`);
  }
  return d;
}

async function main() {
  assertChildBranch();
  assertNotSampleChildForFullRun();
  assertPass2Interval();
  const since = intervalStart();

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
  const credentialsMissing = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "Certificate" c
      LEFT JOIN "Credential" cr ON cr."credentialId" = c."certificateId"
     WHERE cr.id IS NULL
  `;

  const cohortMemberCount = await prisma.programMember.groupBy({
    by: ["userId"],
  });
  const cohortMembersNotSearchable = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT m."userId")::bigint AS n FROM "ProgramMember" m
     WHERE NOT EXISTS (
       SELECT 1 FROM "CandidateVisibility" v
        WHERE v."userId" = m."userId"
          AND v."searchableByRecruiters" = true
     )
  `;
  const visibilityLeak = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "CandidateVisibility" v
     WHERE v."searchableByRecruiters" = true
       AND v."consentSource" IS DISTINCT FROM 'platform_default'
       AND NOT EXISTS (
         SELECT 1 FROM "ProgramMember" m WHERE m."userId" = v."userId")
  `;
  const searchableMembers = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT m."userId")::bigint AS n FROM "ProgramMember" m
      JOIN "CandidateVisibility" v ON v."userId" = m."userId"
     WHERE v."searchableByRecruiters" = true
  `;
  const searchablePlatformDefaultNonMembers = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "CandidateVisibility" v
     WHERE v."searchableByRecruiters" = true
       AND v."consentSource" = 'platform_default'
       AND NOT EXISTS (
         SELECT 1 FROM "ProgramMember" m WHERE m."userId" = v."userId")
  `;

  const intervalMissingProfile = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "User" u
      JOIN "StudentProfile" sp ON sp."userId" = u.id
      LEFT JOIN "CandidateProfile" cp ON cp."userId" = u.id
     WHERE u."createdAt" >= ${since} AND cp.id IS NULL
  `;
  const intervalMissingVisibility = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "User" u
     WHERE u."createdAt" >= ${since}
       AND (
         EXISTS (SELECT 1 FROM "Enrollment" e WHERE e."userId" = u.id)
         OR EXISTS (SELECT 1 FROM "ProgramMember" m WHERE m."userId" = u.id)
       )
       AND NOT EXISTS (
         SELECT 1 FROM "CandidateVisibility" v WHERE v."userId" = u.id)
  `;
  const intervalMissingEnrollmentPe = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "Enrollment" e
      LEFT JOIN "ProgramEnrollment" pe ON pe.id = ('pe_enr_' || e.id)
     WHERE e."startedAt" >= ${since} AND pe.id IS NULL
  `;
  const intervalMissingMemberPe = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "ProgramMember" m
      LEFT JOIN "ProgramEnrollment" pe ON pe.id = ('pe_pm_' || m.id)
     WHERE m."createdAt" >= ${since} AND pe.id IS NULL
  `;
  const intervalMissingPoints = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "User" u
     WHERE u."createdAt" >= ${since}
       AND u."synergyPoints" <> 0
       AND NOT EXISTS (
         SELECT 1 FROM "PointsAccount" pa WHERE pa."userId" = u.id)
  `;
  const intervalUsers = await prisma.user.count({
    where: { createdAt: { gte: since } },
  });

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
    intervalStart: since.toISOString(),
    pointsAccountVsUserSynergy: Number(pointsVsUser[0]?.n ?? 0),
    pointsLedgerVsAccount: Number(ledgerVsAccount[0]?.n ?? 0),
    credentialsMissing: Number(credentialsMissing[0]?.n ?? 0),
    cohortMemberCount: cohortMemberCount.length,
    searchableMembers: Number(searchableMembers[0]?.n ?? 0),
    cohortMembersNotSearchable: Number(cohortMembersNotSearchable[0]?.n ?? 0),
    searchablePlatformDefaultNonMembers: Number(
      searchablePlatformDefaultNonMembers[0]?.n ?? 0,
    ),
    visibilityLeak: Number(visibilityLeak[0]?.n ?? 0),
    interval: {
      usersCreated: intervalUsers,
      missingCandidateProfile: Number(intervalMissingProfile[0]?.n ?? 0),
      missingVisibilityIfEnrolled: Number(intervalMissingVisibility[0]?.n ?? 0),
      missingChallengeProgramEnrollment: Number(
        intervalMissingEnrollmentPe[0]?.n ?? 0,
      ),
      missingMemberProgramEnrollment: Number(intervalMissingMemberPe[0]?.n ?? 0),
      missingPointsAccountIfSynergy: Number(intervalMissingPoints[0]?.n ?? 0),
    },
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
  if (report.credentialsMissing !== 0) failures.push("credentialsMissing");
  if (report.cohortMembersNotSearchable !== 0) failures.push("cohortMembersNotSearchable");
  if (report.searchableMembers !== report.cohortMemberCount) {
    failures.push("searchableMembersVsCohort");
  }
  if (report.visibilityLeak !== 0) failures.push("visibilityLeak");
  if (report.interval.missingCandidateProfile !== 0) {
    failures.push("intervalMissingCandidateProfile");
  }
  if (report.interval.missingVisibilityIfEnrolled !== 0) {
    failures.push("intervalMissingVisibility");
  }
  if (report.interval.missingChallengeProgramEnrollment !== 0) {
    failures.push("intervalMissingChallengePe");
  }
  if (report.interval.missingMemberProgramEnrollment !== 0) {
    failures.push("intervalMissingMemberPe");
  }
  if (report.interval.missingPointsAccountIfSynergy !== 0) {
    failures.push("intervalMissingPoints");
  }
  if (statusPairs.some((p) => p.delta !== 0)) failures.push("programMemberStatusDelta");
  if (report.shortlistDelta !== 0) failures.push("shortlistDelta");
  if (report.shadow.slugMismatches !== 0 || report.shadow.statusMismatches !== 0) {
    failures.push("shadowRead");
  }
  if (failures.length > 0) {
    throw new Error(`Phase 5 extras failed: ${failures.join(",")}`);
  }
  const pass = process.env.PHASE5_PASS ?? "unlabeled";
  console.log(
    pass === "2"
      ? "Phase 5 extras: all zero. This is verification pass #2."
      : `Phase 5 extras: all zero. pass=${pass}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
