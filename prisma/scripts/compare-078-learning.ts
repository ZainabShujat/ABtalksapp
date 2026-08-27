/**
 * Read-only production comparison: legacy Challenge/Enrollment/Program*
 * vs 078 LearningProgram/Cohort/Activity/ProgramEnrollment.
 * Does not write. PHASE2_ALLOW_PRODUCTION=1 + direct URL required.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { assertChildBranch } from "./migrate-078-shared";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();

async function count(sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM (${sql}) q`,
  );
  return rows[0]?.n ?? 0;
}

async function rows<T extends Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql);
}

function log(label: string, value: unknown): void {
  process.stdout.write(
    `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}\n`,
  );
}

async function main() {
  assertChildBranch();

  const catalog = (
    await rows<{
      learningPrograms: number;
      programVersions: number;
      cohorts: number;
      modules: number;
      activities: number;
      challenges: number;
      dailyTasks: number;
      quizzes: number;
      programCohorts: number;
      programDays: number;
      programModules: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM "LearningProgram") AS "learningPrograms",
        (SELECT COUNT(*)::int FROM "ProgramVersion") AS "programVersions",
        (SELECT COUNT(*)::int FROM "Cohort") AS cohorts,
        (SELECT COUNT(*)::int FROM "Module") AS modules,
        (SELECT COUNT(*)::int FROM "Activity") AS activities,
        (SELECT COUNT(*)::int FROM "Challenge") AS challenges,
        (SELECT COUNT(*)::int FROM "DailyTask") AS "dailyTasks",
        (SELECT COUNT(*)::int FROM "Quiz") AS quizzes,
        (SELECT COUNT(*)::int FROM "ProgramCohort") AS "programCohorts",
        (SELECT COUNT(*)::int FROM "ProgramDay") AS "programDays",
        (SELECT COUNT(*)::int FROM "ProgramModule") AS "programModules"
    `)
  )[0]!;

  const programs = await rows<{
    slug: string;
    title: string;
    isPublished: boolean;
    format: string;
    plannedDurationDays: number | null;
    cohortCount: number;
    activityCount: number;
  }>(`
    SELECT lp.slug, lp.title, lp."isPublished", lp.format::text AS format,
           pv."plannedDurationDays",
           (SELECT COUNT(*)::int FROM "Cohort" c WHERE c."programVersionId" = pv.id) AS "cohortCount",
           (SELECT COUNT(*)::int FROM "Activity" a
              JOIN "Module" m ON m.id = a."moduleId"
             WHERE m."programVersionId" = pv.id) AS "activityCount"
    FROM "LearningProgram" lp
    JOIN "ProgramVersion" pv ON pv."programId" = lp.id AND pv."versionNumber" = 1
    ORDER BY lp."sortOrder", lp.slug
  `);

  const challengeVsProgram = await count(`
    SELECT ch.domain::text
    FROM "Challenge" ch
    LEFT JOIN "LearningProgram" lp
      ON lp.slug = CASE ch.domain::text
        WHEN 'SE' THEN 'software-engineering-challenge'
        WHEN 'DS' THEN 'data-science-challenge'
        WHEN 'AI' THEN 'ai-engineering-challenge'
        WHEN 'CLAUDE' THEN 'claude-challenge'
      END
    WHERE lp.id IS NULL
       OR lp.title IS DISTINCT FROM ch.title
       OR lp."isPublished" IS DISTINCT FROM ch."isActive"
       OR NOT EXISTS (
         SELECT 1 FROM "ProgramVersion" pv
         WHERE pv."programId" = lp.id
           AND pv."plannedDurationDays" IS NOT DISTINCT FROM ch."totalDays"
       )
  `);

  const missingChallengeCohorts = await count(`
    SELECT ch.domain::text
    FROM "Challenge" ch
    LEFT JOIN "Cohort" c ON c.slug = 'legacy-' || lower(ch.domain::text)
    WHERE c.id IS NULL
  `);

  const challengeCohortNameDrift = await count(`
    SELECT ch.domain::text
    FROM "Challenge" ch
    JOIN "Cohort" c ON c.slug = 'legacy-' || lower(ch.domain::text)
    WHERE c.name IS DISTINCT FROM ch.title
  `);

  const missingProgramCohorts = await count(`
    SELECT pc.id
    FROM "ProgramCohort" pc
    LEFT JOIN "Cohort" c ON c.slug = 'legacy-program-' || pc.id
    WHERE c.id IS NULL
  `);

  const programCohortDrift = await count(`
    SELECT pc.id
    FROM "ProgramCohort" pc
    JOIN "Cohort" c ON c.slug = 'legacy-program-' || pc.id
    WHERE c.name IS DISTINCT FROM pc.name
       OR c.status::text IS DISTINCT FROM pc.status::text
       OR c.capacity IS DISTINCT FROM pc.capacity
       OR c."joinCode" IS DISTINCT FROM pc."joinCode"
       OR c."requiresJoinCode" IS DISTINCT FROM pc."requiresJoinCode"
       OR c."startsAt" IS DISTINCT FROM pc."startsAt"
       OR c."endsAt" IS DISTINCT FROM pc."endsAt"
  `);

  const missingDailyTaskActivities = await count(`
    SELECT dt.id
    FROM "DailyTask" dt
    LEFT JOIN "Activity" a ON a.id = 'act_dt_' || dt.id
    WHERE a.id IS NULL
  `);

  const dailyTaskDrift = await count(`
    SELECT dt.id
    FROM "DailyTask" dt
    JOIN "Activity" a ON a.id = 'act_dt_' || dt.id
    WHERE a.title IS DISTINCT FROM dt.title
       OR a."dayNumber" IS DISTINCT FROM dt."dayNumber"
       OR a.type::text <> 'EXTERNAL_SUBMISSION'
  `);

  const missingProgramDayActivities = await count(`
    SELECT pd.id
    FROM "ProgramDay" pd
    LEFT JOIN "Activity" a ON a.id = 'act_pd_' || pd.id
    WHERE a.id IS NULL
  `);

  const programDayDrift = await count(`
    SELECT pd.id
    FROM "ProgramDay" pd
    JOIN "Activity" a ON a.id = 'act_pd_' || pd.id
    WHERE a.title IS DISTINCT FROM pd.title
       OR a."dayNumber" IS DISTINCT FROM pd."dayNumber"
  `);

  const extraActDt = await count(`
    SELECT a.id FROM "Activity" a
    WHERE a.id LIKE 'act_dt_%'
      AND NOT EXISTS (
        SELECT 1 FROM "DailyTask" dt WHERE a.id = 'act_dt_' || dt.id
      )
  `);
  const extraActPd = await count(`
    SELECT a.id FROM "Activity" a
    WHERE a.id LIKE 'act_pd_%'
      AND NOT EXISTS (
        SELECT 1 FROM "ProgramDay" pd WHERE a.id = 'act_pd_' || pd.id
      )
  `);

  const activityByPrefix = await rows<{ prefix: string; n: number }>(`
    SELECT
      CASE
        WHEN id LIKE 'act_dt_%' THEN 'act_dt_'
        WHEN id LIKE 'act_pd_%' THEN 'act_pd_'
        WHEN id LIKE 'act_quiz_%' THEN 'act_quiz_'
        WHEN id LIKE 'act_cq_%' THEN 'act_cq_'
        ELSE 'other'
      END AS prefix,
      COUNT(*)::int AS n
    FROM "Activity"
    GROUP BY 1
    ORDER BY 1
  `);

  const missingChallengePe = await count(`
    SELECT e.id FROM "Enrollment" e
    LEFT JOIN "ProgramEnrollment" pe ON pe.id = 'pe_enr_' || e.id
    WHERE pe.id IS NULL
  `);
  const extraChallengePe = await count(`
    SELECT pe.id FROM "ProgramEnrollment" pe
    WHERE pe.id LIKE 'pe_enr_%'
      AND NOT EXISTS (
        SELECT 1 FROM "Enrollment" e WHERE pe.id = 'pe_enr_' || e.id
      )
  `);

  const challengeStatusDrift = await count(`
    SELECT e.id
    FROM "Enrollment" e
    JOIN "ProgramEnrollment" pe ON pe.id = 'pe_enr_' || e.id
    WHERE pe.status::text <> CASE e.status::text
      WHEN 'COMPLETED' THEN 'COMPLETED'
      WHEN 'ABANDONED' THEN 'DROPPED'
      ELSE 'ACTIVE'
    END
  `);

  const challengeCohortMismatch = await count(`
    SELECT e.id
    FROM "Enrollment" e
    JOIN "ProgramEnrollment" pe ON pe.id = 'pe_enr_' || e.id
    JOIN "Cohort" c ON c.id = pe."cohortId"
    WHERE c.slug IS DISTINCT FROM ('legacy-' || lower(e.domain::text))
  `);

  const missingMemberPe = await count(`
    SELECT m.id FROM "ProgramMember" m
    LEFT JOIN "ProgramEnrollment" pe ON pe.id = 'pe_pm_' || m.id
    WHERE pe.id IS NULL
  `);
  const extraMemberPe = await count(`
    SELECT pe.id FROM "ProgramEnrollment" pe
    WHERE pe.id LIKE 'pe_pm_%'
      AND NOT EXISTS (
        SELECT 1 FROM "ProgramMember" m WHERE pe.id = 'pe_pm_' || m.id
      )
  `);

  const memberStatusDrift = await count(`
    SELECT m.id
    FROM "ProgramMember" m
    JOIN "ProgramEnrollment" pe ON pe.id = 'pe_pm_' || m.id
    WHERE pe.status::text <> CASE m.status::text
      WHEN 'APPLIED' THEN 'APPLIED'
      WHEN 'WAITLISTED' THEN 'WAITLISTED'
      WHEN 'ENROLLED' THEN 'ACTIVE'
      WHEN 'COMPLETED' THEN 'COMPLETED'
      WHEN 'DROPPED' THEN 'DROPPED'
      ELSE 'ACTIVE'
    END
  `);

  const memberCohortMismatch = await count(`
    SELECT m.id
    FROM "ProgramMember" m
    JOIN "ProgramEnrollment" pe ON pe.id = 'pe_pm_' || m.id
    JOIN "Cohort" c ON c.id = pe."cohortId"
    WHERE c.slug IS DISTINCT FROM ('legacy-program-' || m."cohortId")
  `);

  const peStatusCounts = await rows<{ source: string; status: string; n: number }>(`
    SELECT 'enrollment' AS source, status::text AS status, COUNT(*)::int AS n
    FROM "Enrollment" GROUP BY 1, 2
    UNION ALL
    SELECT 'pe_enr', pe.status::text, COUNT(*)::int
    FROM "ProgramEnrollment" pe WHERE pe.id LIKE 'pe_enr_%' GROUP BY 1, 2
    UNION ALL
    SELECT 'programMember', status::text, COUNT(*)::int
    FROM "ProgramMember" GROUP BY 1, 2
    UNION ALL
    SELECT 'pe_pm', pe.status::text, COUNT(*)::int
    FROM "ProgramEnrollment" pe WHERE pe.id LIKE 'pe_pm_%' GROUP BY 1, 2
    ORDER BY 1, 2
  `);

  const challengeStatusDriftRows = await rows<{
    enrollmentStatus: string;
    peStatus: string;
    domain: string;
  }>(`
    SELECT e.status::text AS "enrollmentStatus",
           pe.status::text AS "peStatus",
           e.domain::text AS domain
    FROM "Enrollment" e
    JOIN "ProgramEnrollment" pe ON pe.id = 'pe_enr_' || e.id
    WHERE pe.status::text <> CASE e.status::text
      WHEN 'COMPLETED' THEN 'COMPLETED'
      WHEN 'ABANDONED' THEN 'DROPPED'
      ELSE 'ACTIVE'
    END
  `);

  const quizGaps = {
    missingQuizActivities: await count(`
      SELECT q.id FROM "Quiz" q
      LEFT JOIN "Activity" a ON a.id = 'act_quiz_' || q.id
      WHERE a.id IS NULL
    `),
    quizQuestionCountDrift: await count(`
      SELECT q.id FROM "Quiz" q
      JOIN "Activity" a ON a.id = 'act_quiz_' || q.id
      JOIN "QuizActivityConfig" c ON c."activityId" = a.id
      WHERE (SELECT COUNT(*) FROM "QuizQuestion" qq WHERE qq."quizId" = q.id)
        IS DISTINCT FROM (SELECT COUNT(*) FROM "Question" nq WHERE nq."configId" = c.id)
    `),
    quizFourOptionGap: await count(`
      SELECT nq.id FROM "Question" nq
      JOIN "QuizActivityConfig" c ON c.id = nq."configId"
      JOIN "Activity" a ON a.id = c."activityId"
      WHERE a.id LIKE 'act_quiz_%'
        AND (SELECT COUNT(*) FROM "QuestionOption" o WHERE o."questionId" = nq.id) <> 4
    `),
  };

  const programDayMissionTypeDrift = await count(`
    SELECT pd.id
    FROM "ProgramDay" pd
    JOIN "Activity" a ON a.id = 'act_pd_' || pd.id
    LEFT JOIN "ContentActivityConfig" c ON c."activityId" = a.id
    WHERE c."missionType" IS DISTINCT FROM pd."missionType"
  `);

  const unexpected = {
    challengeVsProgram,
    missingChallengeCohorts,
    challengeCohortNameDrift,
    missingProgramCohorts,
    programCohortDrift,
    missingDailyTaskActivities,
    dailyTaskDrift,
    missingProgramDayActivities,
    programDayDrift,
    extraActDt,
    extraActPd,
    missingChallengePe,
    extraChallengePe,
    challengeStatusDrift,
    challengeCohortMismatch,
    missingMemberPe,
    extraMemberPe,
    memberStatusDrift,
    memberCohortMismatch,
    programDayMissionTypeDrift,
  };
  const bad = Object.entries(unexpected).filter(([, n]) => n !== 0);

  log("catalog", catalog);
  log("programs", programs);
  log("activityByPrefix", activityByPrefix);
  log("statusCounts", peStatusCounts);
  log("challengeStatusDriftRows", challengeStatusDriftRows);
  log("catalogGaps", quizGaps);
  log("unexpected", unexpected);

  if (bad.length > 0) {
    throw new Error(`Learning compare diffs: ${JSON.stringify(Object.fromEntries(bad))}`);
  }
  log("result", "all mapped diffs zero");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
