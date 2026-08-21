/**
 * Plan 078 Phase 2 verification pack (V1–V10). Every query must return 0 rows.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import {
  assertChildBranch,
  isSampleMode,
  resolveSampleUserIds,
  SAMPLE_DAY_CAP,
  sqlIn,
} from "./migrate-078-shared";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();

async function count(label: string, sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM (${sql}) q`,
  );
  const n = rows[0]?.n ?? 0;
  console.log(`${label}: ${n}`);
  return n;
}

async function main() {
  assertChildBranch();
  const sample = await resolveSampleUserIds(prisma);
  if (isSampleMode()) {
    console.log(`Verification scoped to ${sample?.length ?? 0} sample users`);
  }
  const v1 = await count(
    "V1 missing enrollments",
    `SELECT e.id FROM "Enrollment" e
      LEFT JOIN "ProgramEnrollment" pe
        ON pe."userId" = e."userId" AND pe."cohortId" = (SELECT id FROM "Cohort" WHERE slug = 'legacy-' || lower(e.domain::text))
     WHERE pe.id IS NULL AND ${sqlIn('e."userId"', sample)}`,
  );
  const v2 = await count(
    "V2 missing submissions",
    `SELECT s.id FROM "Submission" s
      LEFT JOIN "ActivityAttempt" a ON a.payload->>'legacySubmissionId' = s.id
     WHERE a.id IS NULL AND ${sqlIn('s."userId"', sample)}
       ${sample ? `AND s."dayNumber" <= ${SAMPLE_DAY_CAP}` : ""}`,
  );
  const v3 = await count(
    "V3 points drift",
    `SELECT pa."userId" FROM "PointsAccount" pa
      LEFT JOIN "PointsTransaction" pt ON pt."userId" = pa."userId"
     WHERE ${sqlIn('pa."userId"', sample)}
     GROUP BY pa."userId", pa.balance
     HAVING pa.balance <> COALESCE(SUM(pt.amount), 0)`,
  );
  const v4 = await count(
    "V4 visibility leak",
    `SELECT v."userId" FROM "CandidateVisibility" v
     WHERE v."searchableByRecruiters" = true
       AND ${sqlIn('v."userId"', sample)}
       AND NOT EXISTS (
         SELECT 1 FROM "ProgramMember" m
          WHERE m."userId" = v."userId" AND m."recruiterVisibilityConsentAt" IS NOT NULL)`,
  );
  const v5 = await count(
    "V5 missing shortlist items",
    `SELECT si.id FROM "RecruiterShortlistItem" si
      JOIN "ProgramMember" m ON m.id = si."memberId"
      LEFT JOIN "TalentListItem" tli
        ON tli."candidateUserId" = m."userId"
       JOIN "TalentList" tl ON tl.id = tli."talentListId"
       JOIN "RecruiterProfile" rp ON rp.id = tl."ownerRecruiterId"
     WHERE rp."userId" = si."recruiterUserId" AND tli.id IS NULL
       AND ${sqlIn('si."recruiterUserId"', sample)}`,
  );
  const v6 = await count(
    "V6 missing credentials",
    `SELECT c.id FROM "Certificate" c
      LEFT JOIN "Credential" cr ON cr."credentialId" = c."certificateId"
     WHERE cr.id IS NULL AND ${sqlIn('c."userId"', sample)}`,
  );
  const v7 = await count(
    "V7 missing candidate profiles",
    `SELECT sp."userId" FROM "StudentProfile" sp
      LEFT JOIN "CandidateProfile" cp ON cp."userId" = sp."userId"
     WHERE cp.id IS NULL AND ${sqlIn('sp."userId"', sample)}`,
  );
  const v8 = await count(
    "V8 orphan attempts",
    `SELECT a.id FROM "ActivityAttempt" a
      LEFT JOIN "ProgramEnrollment" pe ON pe.id = a."enrollmentId"
     WHERE pe.id IS NULL`,
  );
  const v9 = await count(
    "V9 version mismatch",
    `SELECT a.id FROM "ActivityAttempt" a
      JOIN "Activity" act ON act.id = a."activityId"
      JOIN "Module" m     ON m.id  = act."moduleId"
      JOIN "ProgramEnrollment" pe ON pe.id = a."enrollmentId"
      JOIN "Cohort" c     ON c.id  = pe."cohortId"
     WHERE m."programVersionId" <> c."programVersionId"`,
  );
  const v10 = await count(
    "V10 progress overflow",
    `SELECT ep.id FROM "EnrollmentProgress" ep
     WHERE ep."completedActivities" > ep."totalActivities" OR ep."percentCompleteBp" > 10000`,
  );

  const failed = { v1, v2, v3, v4, v5, v6, v7, v8, v9, v10 };
  const bad = Object.entries(failed).filter(([, n]) => n > 0);
  if (bad.length > 0) {
    throw new Error(`Verification failed: ${JSON.stringify(Object.fromEntries(bad))}`);
  }
  console.log("Phase 2 verification pack: all zero.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
