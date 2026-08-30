/**
 * Read-only production comparison: legacy progress (Submission,
 * Enrollment.daysCompleted, ProgramMissionSubmission, QuizAttempt) vs 078
 * ActivityAttempt / ActivityEvaluation / EnrollmentProgress.
 * Does not write. PHASE2_ALLOW_PRODUCTION=1 + direct URL required.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { assertChildBranch } from "./migrate-078-shared";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();

async function one<T extends Record<string, unknown>>(sql: string): Promise<T> {
  const rows = await prisma.$queryRawUnsafe<T[]>(sql);
  if (!rows[0]) throw new Error(`Expected a row: ${sql.slice(0, 120)}`);
  return rows[0];
}

async function many<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql);
}

function log(label: string, value: unknown): void {
  process.stdout.write(
    `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}\n`,
  );
}

async function main() {
  assertChildBranch();

  const coverage = await one<{
    submissions: number;
    submission_attempts: number;
    sub_missing_attempt: number;
    sub_orphan_attempt: number;
    sub_missing_eval: number;
    missions: number;
    mission_attempts: number;
    ms_missing_attempt: number;
    ms_orphan_attempt: number;
    ms_missing_eval: number;
    quiz_attempts: number;
    quiz_mapped_attempts: number;
    qa_missing_attempt: number;
    qa_orphan_attempt: number;
    qa_missing_eval: number;
    enrollments: number;
    challenge_pe: number;
    challenge_ep: number;
    members: number;
    program_pe: number;
    program_ep: number;
  }>(`
    SELECT
      (SELECT count(*)::int FROM "Submission") AS submissions,
      (SELECT count(*)::int FROM "ActivityAttempt" WHERE id LIKE 'aa_sub_%') AS submission_attempts,
      (SELECT count(*)::int FROM "Submission" s
        WHERE NOT EXISTS (
          SELECT 1 FROM "ActivityAttempt" a WHERE a.id = 'aa_sub_' || s.id
        )) AS sub_missing_attempt,
      (SELECT count(*)::int FROM "ActivityAttempt" a
        WHERE a.id LIKE 'aa_sub_%'
          AND NOT EXISTS (
            SELECT 1 FROM "Submission" s WHERE a.id = 'aa_sub_' || s.id
          )) AS sub_orphan_attempt,
      (SELECT count(*)::int FROM "ActivityAttempt" a
        WHERE a.id LIKE 'aa_sub_%'
          AND NOT EXISTS (
            SELECT 1 FROM "ActivityEvaluation" e WHERE e.id = 'ev_sub_' || substr(a.id, 8)
          )) AS sub_missing_eval,
      (SELECT count(*)::int FROM "ProgramMissionSubmission") AS missions,
      (SELECT count(*)::int FROM "ActivityAttempt" WHERE id LIKE 'aa_ms_%') AS mission_attempts,
      (SELECT count(*)::int FROM "ProgramMissionSubmission" pms
        WHERE NOT EXISTS (
          SELECT 1 FROM "ActivityAttempt" a WHERE a.id = 'aa_ms_' || pms.id
        )) AS ms_missing_attempt,
      (SELECT count(*)::int FROM "ActivityAttempt" a
        WHERE a.id LIKE 'aa_ms_%'
          AND NOT EXISTS (
            SELECT 1 FROM "ProgramMissionSubmission" pms WHERE a.id = 'aa_ms_' || pms.id
          )) AS ms_orphan_attempt,
      (SELECT count(*)::int FROM "ActivityAttempt" a
        WHERE a.id LIKE 'aa_ms_%'
          AND NOT EXISTS (
            SELECT 1 FROM "ActivityEvaluation" e WHERE e.id = 'ev_ms_' || substr(a.id, 7)
          )) AS ms_missing_eval,
      (SELECT count(*)::int FROM "QuizAttempt") AS quiz_attempts,
      (SELECT count(*)::int FROM "ActivityAttempt" WHERE id LIKE 'aa_qa_%') AS quiz_mapped_attempts,
      (SELECT count(*)::int FROM "QuizAttempt" qa
        WHERE NOT EXISTS (
          SELECT 1 FROM "ActivityAttempt" a WHERE a.id = 'aa_qa_' || qa.id
        )) AS qa_missing_attempt,
      (SELECT count(*)::int FROM "ActivityAttempt" a
        WHERE a.id LIKE 'aa_qa_%'
          AND NOT EXISTS (
            SELECT 1 FROM "QuizAttempt" qa WHERE a.id = 'aa_qa_' || qa.id
          )) AS qa_orphan_attempt,
      (SELECT count(*)::int FROM "ActivityAttempt" a
        WHERE a.id LIKE 'aa_qa_%'
          AND NOT EXISTS (
            SELECT 1 FROM "ActivityEvaluation" e WHERE e.id = 'ev_qa_' || substr(a.id, 7)
          )) AS qa_missing_eval,
      (SELECT count(*)::int FROM "Enrollment") AS enrollments,
      (SELECT count(*)::int FROM "ProgramEnrollment" WHERE id LIKE 'pe_enr_%') AS challenge_pe,
      (SELECT count(*)::int FROM "EnrollmentProgress" ep
        JOIN "ProgramEnrollment" pe ON pe.id = ep."enrollmentId"
        WHERE pe.id LIKE 'pe_enr_%') AS challenge_ep,
      (SELECT count(*)::int FROM "ProgramMember") AS members,
      (SELECT count(*)::int FROM "ProgramEnrollment" WHERE id LIKE 'pe_pm_%') AS program_pe,
      (SELECT count(*)::int FROM "EnrollmentProgress" ep
        JOIN "ProgramEnrollment" pe ON pe.id = ep."enrollmentId"
        WHERE pe.id LIKE 'pe_pm_%') AS program_ep
  `);
  log("coverage", coverage);

  const submissionSemantics = await one<{
    pe_mismatch: number;
    activity_mismatch: number;
    submitted_at_mismatch: number;
    not_passed: number;
    late_lateness_mismatch: number;
    ontime_lateness_mismatch: number;
    eval_not_passed: number;
  }>(`
    SELECT
      count(*) FILTER (
        WHERE a."enrollmentId" IS DISTINCT FROM ('pe_enr_' || s."enrollmentId")
      )::int AS pe_mismatch,
      count(*) FILTER (
        WHERE a."activityId" IS DISTINCT FROM ('act_dt_' || s."dailyTaskId")
      )::int AS activity_mismatch,
      count(*) FILTER (
        WHERE a."submittedAt" IS DISTINCT FROM s."submittedAt"
      )::int AS submitted_at_mismatch,
      count(*) FILTER (WHERE a.passed IS NOT TRUE)::int AS not_passed,
      count(*) FILTER (
        WHERE s.status = 'LATE' AND a.lateness IS DISTINCT FROM 'LATE'
      )::int AS late_lateness_mismatch,
      count(*) FILTER (
        WHERE s.status = 'ON_TIME' AND a.lateness IS DISTINCT FROM 'ON_TIME'
      )::int AS ontime_lateness_mismatch,
      count(*) FILTER (
        WHERE e.id IS NOT NULL AND e.passed IS NOT TRUE
      )::int AS eval_not_passed
    FROM "Submission" s
    LEFT JOIN "ActivityAttempt" a ON a.id = 'aa_sub_' || s.id
    LEFT JOIN "ActivityEvaluation" e ON e.id = 'ev_sub_' || s.id
  `);
  log("submission_semantics", submissionSemantics);

  const daysCompleted = await one<{
    enrollments_compared: number;
    days_eq_submission_count: number;
    days_ne_submission_count: number;
    days_eq_passed_dt_attempts: number;
    days_ne_passed_dt_attempts: number;
    pe_missing: number;
  }>(`
    WITH sub_counts AS (
      SELECT "enrollmentId", count(*)::int AS n FROM "Submission" GROUP BY 1
    ),
    passed_dt AS (
      SELECT
        substr(a."enrollmentId", 8) AS enrollment_id,
        count(DISTINCT a."activityId")::int AS n
      FROM "ActivityAttempt" a
      WHERE a.passed = true
        AND a."enrollmentId" LIKE 'pe_enr_%'
        AND a."activityId" LIKE 'act_dt_%'
      GROUP BY 1
    )
    SELECT
      count(*)::int AS enrollments_compared,
      count(*) FILTER (
        WHERE e."daysCompleted" = coalesce(sc.n, 0)
      )::int AS days_eq_submission_count,
      count(*) FILTER (
        WHERE e."daysCompleted" IS DISTINCT FROM coalesce(sc.n, 0)
      )::int AS days_ne_submission_count,
      count(*) FILTER (
        WHERE e."daysCompleted" = coalesce(pd.n, 0)
      )::int AS days_eq_passed_dt_attempts,
      count(*) FILTER (
        WHERE e."daysCompleted" IS DISTINCT FROM coalesce(pd.n, 0)
      )::int AS days_ne_passed_dt_attempts,
      count(*) FILTER (
        WHERE pe.id IS NULL
      )::int AS pe_missing
    FROM "Enrollment" e
    LEFT JOIN sub_counts sc ON sc."enrollmentId" = e.id
    LEFT JOIN passed_dt pd ON pd.enrollment_id = e.id
    LEFT JOIN "ProgramEnrollment" pe ON pe.id = 'pe_enr_' || e.id
  `);
  log("daysCompleted_vs_derived", daysCompleted);

  const daysMismatchExamples = await many<{
    enrollmentId: string;
    status: string;
    daysCompleted: number;
    submission_count: number;
    passed_dt_attempts: number;
  }>(`
    WITH sub_counts AS (
      SELECT "enrollmentId", count(*)::int AS n FROM "Submission" GROUP BY 1
    ),
    passed_dt AS (
      SELECT
        substr(a."enrollmentId", 8) AS enrollment_id,
        count(DISTINCT a."activityId")::int AS n
      FROM "ActivityAttempt" a
      WHERE a.passed = true
        AND a."enrollmentId" LIKE 'pe_enr_%'
        AND a."activityId" LIKE 'act_dt_%'
      GROUP BY 1
    )
    SELECT
      e.id AS "enrollmentId",
      e.status::text AS status,
      e."daysCompleted",
      coalesce(sc.n, 0) AS submission_count,
      coalesce(pd.n, 0) AS passed_dt_attempts
    FROM "Enrollment" e
    LEFT JOIN sub_counts sc ON sc."enrollmentId" = e.id
    LEFT JOIN passed_dt pd ON pd.enrollment_id = e.id
    WHERE e."daysCompleted" IS DISTINCT FROM coalesce(sc.n, 0)
       OR e."daysCompleted" IS DISTINCT FROM coalesce(pd.n, 0)
    ORDER BY abs(e."daysCompleted" - coalesce(pd.n, 0)) DESC
    LIMIT 15
  `);
  log("daysCompleted_mismatch_examples", daysMismatchExamples);

  const missionSemantics = await one<{
    pe_mismatch: number;
    activity_mismatch: number;
    passed_mismatch: number;
    eval_passed_mismatch: number;
    submitted_at_mismatch: number;
    waived_missing_attempt: number;
    failed_missing_attempt: number;
    passed_missing_attempt: number;
    waived_flag_mismatch: number;
    skipped_flag_mismatch: number;
  }>(`
    SELECT
      count(*) FILTER (
        WHERE a."enrollmentId" IS DISTINCT FROM ('pe_pm_' || pms."memberId")
      )::int AS pe_mismatch,
      count(*) FILTER (
        WHERE a.id IS NOT NULL AND (
          a."activityId" IS DISTINCT FROM ('act_pd_' || pd.id)
        )
      )::int AS activity_mismatch,
      count(*) FILTER (
        WHERE a.id IS NOT NULL AND a.passed IS DISTINCT FROM pms.passed
      )::int AS passed_mismatch,
      count(*) FILTER (
        WHERE e.id IS NOT NULL AND e.passed IS DISTINCT FROM pms.passed
      )::int AS eval_passed_mismatch,
      count(*) FILTER (
        WHERE a.id IS NOT NULL AND a."submittedAt" IS DISTINCT FROM pms."createdAt"
      )::int AS submitted_at_mismatch,
      count(*) FILTER (
        WHERE a.id IS NULL AND coalesce(pms.payload->>'waived', '') = 'true'
      )::int AS waived_missing_attempt,
      count(*) FILTER (
        WHERE a.id IS NULL AND pms.passed = false
      )::int AS failed_missing_attempt,
      count(*) FILTER (
        WHERE a.id IS NULL AND pms.passed = true
      )::int AS passed_missing_attempt,
      count(*) FILTER (
        WHERE a.id IS NOT NULL
          AND coalesce(pms.payload->>'waived', '')
            IS DISTINCT FROM coalesce(a.payload->>'waived', '')
      )::int AS waived_flag_mismatch,
      count(*) FILTER (
        WHERE a.id IS NOT NULL
          AND coalesce(pms.payload->>'skipped', '')
            IS DISTINCT FROM coalesce(a.payload->>'skipped', '')
      )::int AS skipped_flag_mismatch
    FROM "ProgramMissionSubmission" pms
    LEFT JOIN "ProgramDay" pd ON pd."dayNumber" = pms."dayNumber"
    LEFT JOIN "ActivityAttempt" a ON a.id = 'aa_ms_' || pms.id
    LEFT JOIN "ActivityEvaluation" e ON e.id = 'ev_ms_' || pms.id
  `);
  log("mission_semantics", missionSemantics);

  const programDaySets = await one<{
    members_compared: number;
    passed_day_set_mismatch: number;
    unlock_floor_mismatch: number;
    pe_missing: number;
  }>(`
    WITH legacy_passed AS (
      SELECT "memberId", array_agg(DISTINCT "dayNumber" ORDER BY "dayNumber") AS days
      FROM "ProgramMissionSubmission"
      WHERE passed = true
      GROUP BY 1
    ),
    new_passed AS (
      SELECT
        substr(a."enrollmentId", 7) AS member_id,
        array_agg(DISTINCT act."dayNumber" ORDER BY act."dayNumber") AS days
      FROM "ActivityAttempt" a
      JOIN "Activity" act ON act.id = a."activityId"
      WHERE a.passed = true
        AND a."enrollmentId" LIKE 'pe_pm_%'
        AND a."activityId" LIKE 'act_pd_%'
      GROUP BY 1
    )
    SELECT
      count(*)::int AS members_compared,
      count(*) FILTER (
        WHERE coalesce(lp.days, ARRAY[]::int[])
          IS DISTINCT FROM coalesce(np.days, ARRAY[]::int[])
      )::int AS passed_day_set_mismatch,
      count(*) FILTER (
        WHERE pe.id IS NOT NULL
          AND pe."unlockFloorDay" IS DISTINCT FROM m."highestUnlockedDay"
      )::int AS unlock_floor_mismatch,
      count(*) FILTER (WHERE pe.id IS NULL)::int AS pe_missing
    FROM "ProgramMember" m
    LEFT JOIN legacy_passed lp ON lp."memberId" = m.id
    LEFT JOIN new_passed np ON np.member_id = m.id
    LEFT JOIN "ProgramEnrollment" pe ON pe.id = 'pe_pm_' || m.id
  `);
  log("program_day_sets", programDaySets);

  const programMismatchExamples = await many<{
    memberId: string;
    highestUnlockedDay: number;
    unlockFloorDay: number | null;
    legacy_passed_days: number[] | null;
    new_passed_days: number[] | null;
  }>(`
    WITH legacy_passed AS (
      SELECT "memberId", array_agg(DISTINCT "dayNumber" ORDER BY "dayNumber") AS days
      FROM "ProgramMissionSubmission"
      WHERE passed = true
      GROUP BY 1
    ),
    new_passed AS (
      SELECT
        substr(a."enrollmentId", 7) AS member_id,
        array_agg(DISTINCT act."dayNumber" ORDER BY act."dayNumber") AS days
      FROM "ActivityAttempt" a
      JOIN "Activity" act ON act.id = a."activityId"
      WHERE a.passed = true
        AND a."enrollmentId" LIKE 'pe_pm_%'
        AND a."activityId" LIKE 'act_pd_%'
      GROUP BY 1
    )
    SELECT
      m.id AS "memberId",
      m."highestUnlockedDay",
      pe."unlockFloorDay",
      lp.days AS legacy_passed_days,
      np.days AS new_passed_days
    FROM "ProgramMember" m
    LEFT JOIN legacy_passed lp ON lp."memberId" = m.id
    LEFT JOIN new_passed np ON np.member_id = m.id
    LEFT JOIN "ProgramEnrollment" pe ON pe.id = 'pe_pm_' || m.id
    WHERE coalesce(lp.days, ARRAY[]::int[])
        IS DISTINCT FROM coalesce(np.days, ARRAY[]::int[])
       OR (pe.id IS NOT NULL AND pe."unlockFloorDay" IS DISTINCT FROM m."highestUnlockedDay")
    LIMIT 20
  `);
  log("program_mismatch_examples", programMismatchExamples);

  const quizCatalog = await one<{
    legacy_questions: number;
    mapped_by_order: number;
    unmapped: number;
    body_mismatch: number;
    option_mismatch: number;
    id_collision: number;
  }>(`
    WITH mapped AS (
      SELECT
        qq.id AS legacy_id,
        q.id AS new_id,
        qq."questionText" AS legacy_body,
        q.body AS new_body,
        qq."optionA" AS la, qq."optionB" AS lb, qq."optionC" AS lc, qq."optionD" AS ld,
        max(opt.body) FILTER (WHERE opt.position = 1) AS na,
        max(opt.body) FILTER (WHERE opt.position = 2) AS nb,
        max(opt.body) FILTER (WHERE opt.position = 3) AS nc,
        max(opt.body) FILTER (WHERE opt.position = 4) AS nd
      FROM "QuizQuestion" qq
      LEFT JOIN "Activity" a ON a.id = 'act_quiz_' || qq."quizId"
      LEFT JOIN "QuizActivityConfig" qc ON qc."activityId" = a.id
      LEFT JOIN "Question" q ON q."configId" = qc.id AND q.position = qq."questionOrder"
      LEFT JOIN "QuestionOption" opt ON opt."questionId" = q.id
      GROUP BY qq.id, q.id, qq."questionText", q.body,
               qq."optionA", qq."optionB", qq."optionC", qq."optionD"
    )
    SELECT
      count(*)::int AS legacy_questions,
      count(*) FILTER (WHERE new_id IS NOT NULL)::int AS mapped_by_order,
      count(*) FILTER (WHERE new_id IS NULL)::int AS unmapped,
      count(*) FILTER (
        WHERE new_id IS NOT NULL AND legacy_body IS DISTINCT FROM new_body
      )::int AS body_mismatch,
      count(*) FILTER (
        WHERE new_id IS NOT NULL AND (
          la IS DISTINCT FROM na OR lb IS DISTINCT FROM nb
          OR lc IS DISTINCT FROM nc OR ld IS DISTINCT FROM nd
        )
      )::int AS option_mismatch,
      count(*) FILTER (WHERE new_id IS NOT NULL AND legacy_id = new_id)::int AS id_collision
    FROM mapped
  `);
  log("quiz_question_catalog_mapping", quizCatalog);

  const quizAnswers = await one<{
    attempts: number;
    all_keys_legacy_qq: number;
    all_keys_078_q: number;
    mixed_or_unknown: number;
    remap_complete: number;
    remap_incomplete: number;
    score_mismatch: number;
    passed_threshold_mismatch: number;
  }>(`
    WITH keys AS (
      SELECT
        qa.id AS attempt_id,
        qa."quizId",
        qa.score,
        k AS question_id
      FROM "QuizAttempt" qa
      CROSS JOIN LATERAL jsonb_object_keys(qa.answers::jsonb) AS k
    ),
    classified AS (
      SELECT
        k.attempt_id,
        k."quizId",
        max(qa.score) AS score,
        count(*)::int AS n_keys,
        count(qq.id)::int AS n_legacy_qq,
        count(q_direct.id)::int AS n_078_direct,
        count(q_remap.id)::int AS n_078_remap
      FROM keys k
      JOIN "QuizAttempt" qa ON qa.id = k.attempt_id
      LEFT JOIN "QuizQuestion" qq
        ON qq.id = k.question_id AND qq."quizId" = k."quizId"
      LEFT JOIN "Question" q_direct ON q_direct.id = k.question_id
      LEFT JOIN "QuizQuestion" qq2
        ON qq2.id = k.question_id AND qq2."quizId" = k."quizId"
      LEFT JOIN "Activity" a ON a.id = 'act_quiz_' || k."quizId"
      LEFT JOIN "QuizActivityConfig" qc ON qc."activityId" = a.id
      LEFT JOIN "Question" q_remap
        ON q_remap."configId" = qc.id AND q_remap.position = qq2."questionOrder"
      GROUP BY k.attempt_id, k."quizId"
    )
    SELECT
      count(*)::int AS attempts,
      count(*) FILTER (WHERE n_legacy_qq = n_keys)::int AS all_keys_legacy_qq,
      count(*) FILTER (WHERE n_078_direct = n_keys)::int AS all_keys_078_q,
      count(*) FILTER (
        WHERE n_legacy_qq <> n_keys AND n_078_direct <> n_keys
      )::int AS mixed_or_unknown,
      count(*) FILTER (WHERE n_078_remap = n_keys)::int AS remap_complete,
      count(*) FILTER (WHERE n_078_remap < n_keys)::int AS remap_incomplete,
      (
        SELECT count(*)::int
        FROM "QuizAttempt" qa
        JOIN "ActivityAttempt" a ON a.id = 'aa_qa_' || qa.id
        WHERE a.score IS DISTINCT FROM qa.score
      ) AS score_mismatch,
      (
        SELECT count(*)::int
        FROM "QuizAttempt" qa
        JOIN "ActivityAttempt" a ON a.id = 'aa_qa_' || qa.id
        WHERE a.passed IS DISTINCT FROM (qa.score >= 60)
      ) AS passed_threshold_mismatch
    FROM classified
  `);
  log("quiz_answer_mapping", quizAnswers);

  const quizUnmappedExamples = await many<{
    attempt_id: string;
    quizId: string;
    n_keys: number;
    n_legacy_qq: number;
    n_078_remap: number;
  }>(`
    WITH keys AS (
      SELECT qa.id AS attempt_id, qa."quizId", k AS question_id
      FROM "QuizAttempt" qa
      CROSS JOIN LATERAL jsonb_object_keys(qa.answers::jsonb) AS k
    ),
    classified AS (
      SELECT
        k.attempt_id,
        k."quizId",
        count(*)::int AS n_keys,
        count(qq.id)::int AS n_legacy_qq,
        count(q_remap.id)::int AS n_078_remap
      FROM keys k
      LEFT JOIN "QuizQuestion" qq
        ON qq.id = k.question_id AND qq."quizId" = k."quizId"
      LEFT JOIN "QuizQuestion" qq2
        ON qq2.id = k.question_id AND qq2."quizId" = k."quizId"
      LEFT JOIN "Activity" a ON a.id = 'act_quiz_' || k."quizId"
      LEFT JOIN "QuizActivityConfig" qc ON qc."activityId" = a.id
      LEFT JOIN "Question" q_remap
        ON q_remap."configId" = qc.id AND q_remap.position = qq2."questionOrder"
      GROUP BY k.attempt_id, k."quizId"
    )
    SELECT attempt_id, "quizId", n_keys, n_legacy_qq, n_078_remap
    FROM classified
    WHERE n_078_remap < n_keys
    LIMIT 15
  `);
  log("quiz_remap_incomplete_examples", quizUnmappedExamples);

  const enrollmentProgress = await one<{
    challenge_ep_missing: number;
    program_ep_missing: number;
    challenge_streak_mismatch: number;
    challenge_longest_mismatch: number;
    challenge_completed_ne_days: number;
    program_points_ne_totalScore: number;
  }>(`
    SELECT
      (
        SELECT count(*)::int FROM "Enrollment" e
        LEFT JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_enr_' || e.id
        WHERE ep.id IS NULL
      ) AS challenge_ep_missing,
      (
        SELECT count(*)::int FROM "ProgramMember" m
        LEFT JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_pm_' || m.id
        WHERE ep.id IS NULL
      ) AS program_ep_missing,
      (
        SELECT count(*)::int FROM "Enrollment" e
        JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_enr_' || e.id
        WHERE ep."currentStreak" IS DISTINCT FROM e."currentStreak"
      ) AS challenge_streak_mismatch,
      (
        SELECT count(*)::int FROM "Enrollment" e
        JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_enr_' || e.id
        WHERE ep."longestStreak" IS DISTINCT FROM e."longestStreak"
      ) AS challenge_longest_mismatch,
      (
        SELECT count(*)::int FROM "Enrollment" e
        JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_enr_' || e.id
        WHERE ep."completedActivities" IS DISTINCT FROM e."daysCompleted"
      ) AS challenge_completed_ne_days,
      (
        SELECT count(*)::int FROM "ProgramMember" m
        JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_pm_' || m.id
        WHERE ep."pointsEarned" IS DISTINCT FROM m."totalScore"
      ) AS program_points_ne_totalScore
  `);
  log("enrollment_progress_cache", enrollmentProgress);

  const streakHeatmap = await one<{
    multi_submit_same_ist_day_users: number;
    late_submissions: number;
    enrollments_with_late_only: number;
    completed_enrollments: number;
    zero_day_enrollments: number;
    day1_only_enrollments: number;
    users_with_hub_activity: number;
    users_with_zero_submissions: number;
  }>(`
    WITH ist_days AS (
      SELECT
        s."userId",
        (s."submittedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS d,
        count(*)::int AS n
      FROM "Submission" s
      GROUP BY 1, 2
    )
    SELECT
      (SELECT count(DISTINCT "userId")::int FROM ist_days WHERE n > 1)
        AS multi_submit_same_ist_day_users,
      (SELECT count(*)::int FROM "Submission" WHERE status = 'LATE') AS late_submissions,
      (
        SELECT count(*)::int FROM "Enrollment" e
        WHERE EXISTS (
          SELECT 1 FROM "Submission" s WHERE s."enrollmentId" = e.id AND s.status = 'LATE'
        )
        AND NOT EXISTS (
          SELECT 1 FROM "Submission" s WHERE s."enrollmentId" = e.id AND s.status = 'ON_TIME'
        )
      ) AS enrollments_with_late_only,
      (SELECT count(*)::int FROM "Enrollment" WHERE status = 'COMPLETED') AS completed_enrollments,
      (SELECT count(*)::int FROM "Enrollment" WHERE "daysCompleted" = 0) AS zero_day_enrollments,
      (SELECT count(*)::int FROM "Enrollment" WHERE "daysCompleted" = 1) AS day1_only_enrollments,
      (SELECT count(DISTINCT "userId")::int FROM "Submission") AS users_with_hub_activity,
      (
        SELECT count(*)::int FROM "User" u
        WHERE EXISTS (SELECT 1 FROM "Enrollment" e WHERE e."userId" = u.id)
          AND NOT EXISTS (SELECT 1 FROM "Submission" s WHERE s."userId" = u.id)
      ) AS users_with_zero_submissions
  `);
  log("streak_heatmap_population", streakHeatmap);

  const unlockEdges = await one<{
    challenge_day0: number;
    challenge_complete_60: number;
    challenge_partial: number;
    challenge_abandoned: number;
    program_no_pass: number;
    program_has_fail_then_pass: number;
    program_failed_open: number;
    program_completed_members: number;
  }>(`
    SELECT
      (SELECT count(*)::int FROM "Enrollment" WHERE "daysCompleted" = 0 AND status = 'ACTIVE')
        AS challenge_day0,
      (SELECT count(*)::int FROM "Enrollment" WHERE "daysCompleted" >= 60)
        AS challenge_complete_60,
      (SELECT count(*)::int FROM "Enrollment"
        WHERE "daysCompleted" BETWEEN 1 AND 59 AND status = 'ACTIVE')
        AS challenge_partial,
      (SELECT count(*)::int FROM "Enrollment" WHERE status = 'ABANDONED')
        AS challenge_abandoned,
      (
        SELECT count(*)::int FROM "ProgramMember" m
        WHERE NOT EXISTS (
          SELECT 1 FROM "ProgramMissionSubmission" pms
          WHERE pms."memberId" = m.id AND pms.passed = true
        )
      ) AS program_no_pass,
      (
        SELECT count(*)::int FROM (
          SELECT "memberId", "dayNumber"
          FROM "ProgramMissionSubmission"
          GROUP BY 1, 2
          HAVING bool_or(passed = false) AND bool_or(passed = true)
        ) q
      ) AS program_has_fail_then_pass,
      (
        SELECT count(*)::int FROM (
          SELECT DISTINCT "memberId"
          FROM "ProgramMissionSubmission" pms
          WHERE passed = false
            AND NOT EXISTS (
              SELECT 1 FROM "ProgramMissionSubmission" p2
              WHERE p2."memberId" = pms."memberId"
                AND p2."dayNumber" = pms."dayNumber"
                AND p2.passed = true
            )
        ) q
      ) AS program_failed_open,
      (SELECT count(*)::int FROM "ProgramMember" WHERE status = 'COMPLETED')
        AS program_completed_members
  `);
  log("unlock_edge_population", unlockEdges);

  const missingQuizAttempts = await many<{
    id: string;
    quizId: string;
    score: number;
    attemptedAt: Date;
  }>(`
    SELECT qa.id, qa."quizId", qa.score, qa."attemptedAt"
    FROM "QuizAttempt" qa
    WHERE NOT EXISTS (
      SELECT 1 FROM "ActivityAttempt" a WHERE a.id = 'aa_qa_' || qa.id
    )
    ORDER BY qa."attemptedAt" DESC
  `);
  log("quiz_attempts_missing_078", missingQuizAttempts);

  const quizKeyShape = await one<{
    distinct_answer_keys: number;
    keys_in_quizquestion_any_quiz: number;
    keys_in_quizquestion_same_quiz: number;
    keys_in_078_question: number;
    attempts_numeric_keys: number;
    attempts_cuid_keys: number;
  }>(`
    WITH keys AS (
      SELECT qa.id AS attempt_id, qa."quizId", k AS question_id
      FROM "QuizAttempt" qa
      CROSS JOIN LATERAL jsonb_object_keys(qa.answers::jsonb) AS k
    )
    SELECT
      (SELECT count(DISTINCT question_id)::int FROM keys) AS distinct_answer_keys,
      (
        SELECT count(DISTINCT k.question_id)::int
        FROM keys k JOIN "QuizQuestion" qq ON qq.id = k.question_id
      ) AS keys_in_quizquestion_any_quiz,
      (
        SELECT count(DISTINCT k.question_id)::int
        FROM keys k
        JOIN "QuizQuestion" qq ON qq.id = k.question_id AND qq."quizId" = k."quizId"
      ) AS keys_in_quizquestion_same_quiz,
      (
        SELECT count(DISTINCT k.question_id)::int
        FROM keys k JOIN "Question" q ON q.id = k.question_id
      ) AS keys_in_078_question,
      (
        SELECT count(DISTINCT attempt_id)::int FROM keys
        WHERE question_id ~ '^[0-9]+$'
      ) AS attempts_numeric_keys,
      (
        SELECT count(DISTINCT attempt_id)::int FROM keys
        WHERE question_id LIKE 'c%'
      ) AS attempts_cuid_keys
  `);
  log("quiz_answer_key_shape", quizKeyShape);

  const quizOrderFallback = await one<{
    attempts: number;
    remap_by_same_quiz_order: number;
    remap_by_any_qq_order: number;
  }>(`
    WITH keys AS (
      SELECT qa.id AS attempt_id, qa."quizId", k AS question_id
      FROM "QuizAttempt" qa
      CROSS JOIN LATERAL jsonb_object_keys(qa.answers::jsonb) AS k
    ),
    classified AS (
      SELECT
        k.attempt_id,
        count(*)::int AS n_keys,
        count(q_same.id)::int AS n_same_quiz,
        count(q_any.id)::int AS n_any_quiz
      FROM keys k
      LEFT JOIN "QuizQuestion" qq_same
        ON qq_same.id = k.question_id AND qq_same."quizId" = k."quizId"
      LEFT JOIN "Activity" a_same ON a_same.id = 'act_quiz_' || k."quizId"
      LEFT JOIN "QuizActivityConfig" qc_same ON qc_same."activityId" = a_same.id
      LEFT JOIN "Question" q_same
        ON q_same."configId" = qc_same.id
       AND q_same.position = qq_same."questionOrder"
      LEFT JOIN "QuizQuestion" qq_any ON qq_any.id = k.question_id
      LEFT JOIN "Activity" a_any ON a_any.id = 'act_quiz_' || qq_any."quizId"
      LEFT JOIN "QuizActivityConfig" qc_any ON qc_any."activityId" = a_any.id
      LEFT JOIN "Question" q_any
        ON q_any."configId" = qc_any.id
       AND q_any.position = qq_any."questionOrder"
      GROUP BY k.attempt_id
    )
    SELECT
      count(*)::int AS attempts,
      count(*) FILTER (WHERE n_same_quiz = n_keys)::int AS remap_by_same_quiz_order,
      count(*) FILTER (WHERE n_any_quiz = n_keys)::int AS remap_by_any_qq_order
    FROM classified
  `);
  log("quiz_order_fallback", quizOrderFallback);

  const epMissing = await one<{
    challenge_zero_days: number;
    challenge_with_days: number;
    challenge_oldest: Date | null;
    challenge_newest: Date | null;
    program_missing: number;
    ep_gt_days: number;
    ep_lt_days: number;
    avg_delta: string | null;
  }>(`
    SELECT
      (
        SELECT count(*)::int FROM "Enrollment" e
        LEFT JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_enr_' || e.id
        WHERE ep.id IS NULL AND e."daysCompleted" = 0
      ) AS challenge_zero_days,
      (
        SELECT count(*)::int FROM "Enrollment" e
        LEFT JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_enr_' || e.id
        WHERE ep.id IS NULL AND e."daysCompleted" > 0
      ) AS challenge_with_days,
      (
        SELECT min(e."createdAt") FROM "Enrollment" e
        LEFT JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_enr_' || e.id
        WHERE ep.id IS NULL
      ) AS challenge_oldest,
      (
        SELECT max(e."createdAt") FROM "Enrollment" e
        LEFT JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_enr_' || e.id
        WHERE ep.id IS NULL
      ) AS challenge_newest,
      (
        SELECT count(*)::int FROM "ProgramMember" m
        LEFT JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_pm_' || m.id
        WHERE ep.id IS NULL
      ) AS program_missing,
      (
        SELECT count(*)::int FROM "Enrollment" e
        JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_enr_' || e.id
        WHERE ep."completedActivities" > e."daysCompleted"
      ) AS ep_gt_days,
      (
        SELECT count(*)::int FROM "Enrollment" e
        JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_enr_' || e.id
        WHERE ep."completedActivities" < e."daysCompleted"
      ) AS ep_lt_days,
      (
        SELECT round(avg(ep."completedActivities" - e."daysCompleted"), 2)::text
        FROM "Enrollment" e
        JOIN "EnrollmentProgress" ep ON ep."enrollmentId" = 'pe_enr_' || e.id
        WHERE ep."completedActivities" IS DISTINCT FROM e."daysCompleted"
      ) AS avg_delta
  `);
  log("enrollment_progress_gaps", epMissing);

  const hubHeatmap = await one<{
    date_count_mismatch: number;
    users_legacy: number;
    users_new: number;
  }>(`
    WITH legacy AS (
      SELECT s."userId",
             ((s."submittedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date AS d,
             count(*)::int AS n
      FROM "Submission" s
      GROUP BY 1, 2
    ),
    new_rows AS (
      SELECT pe."userId",
             ((a."submittedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date AS d,
             count(*)::int AS n
      FROM "ActivityAttempt" a
      JOIN "ProgramEnrollment" pe ON pe.id = a."enrollmentId"
      WHERE a.id LIKE 'aa_sub_%'
        AND a."submittedAt" IS NOT NULL
      GROUP BY 1, 2
    )
    SELECT
      count(*) FILTER (
        WHERE coalesce(l.n, 0) IS DISTINCT FROM coalesce(n.n, 0)
      )::int AS date_count_mismatch,
      (SELECT count(DISTINCT "userId")::int FROM legacy) AS users_legacy,
      (SELECT count(DISTINCT "userId")::int FROM new_rows) AS users_new
    FROM legacy l
    FULL OUTER JOIN new_rows n
      ON n."userId" = l."userId" AND n.d = l.d
  `);
  log("hub_heatmap_drift", hubHeatmap);

  const trackStreak = await one<{
    ontime_day_set_mismatch: number;
    current_streak_mismatch: number;
  }>(`
    WITH legacy_days AS (
      SELECT s."enrollmentId",
             array_agg(s."dayNumber" ORDER BY s."dayNumber") AS days
      FROM "Submission" s
      WHERE s.status = 'ON_TIME'
      GROUP BY 1
    ),
    new_days AS (
      SELECT substr(a."enrollmentId", 8) AS enrollment_id,
             array_agg(act."dayNumber" ORDER BY act."dayNumber") AS days
      FROM "ActivityAttempt" a
      JOIN "Activity" act ON act.id = a."activityId"
      WHERE a.id LIKE 'aa_sub_%'
        AND a.lateness = 'ON_TIME'
        AND a."activityId" LIKE 'act_dt_%'
        AND coalesce(
          (SELECT e.passed FROM "ActivityEvaluation" e
            WHERE e."attemptId" = a.id AND e."isAuthoritative" = true
            LIMIT 1),
          a.passed
        ) = true
      GROUP BY 1
    )
    SELECT
      count(*) FILTER (
        WHERE coalesce(ld.days, ARRAY[]::int[])
          IS DISTINCT FROM coalesce(nd.days, ARRAY[]::int[])
      )::int AS ontime_day_set_mismatch,
      count(*) FILTER (
        WHERE e."currentStreak" IS DISTINCT FROM (
          WITH days AS (
            SELECT unnest(coalesce(ld.days, ARRAY[]::int[])) AS d
          )
          SELECT 0
        )
      )::int AS current_streak_mismatch
    FROM "Enrollment" e
    LEFT JOIN legacy_days ld ON ld."enrollmentId" = e.id
    LEFT JOIN new_days nd ON nd.enrollment_id = e.id
  `);
  log("track_ontime_day_sets", {
    ontime_day_set_mismatch: trackStreak.ontime_day_set_mismatch,
  });

  const enrollmentsForStreak = await many<{
    id: string;
    currentStreak: number;
    longestStreak: number;
    startedAt: Date;
    startsAt: Date | null;
    legacyDays: number[] | null;
    newDays: number[] | null;
  }>(`
    WITH legacy_days AS (
      SELECT s."enrollmentId",
             array_agg(s."dayNumber" ORDER BY s."dayNumber") AS days
      FROM "Submission" s
      WHERE s.status = 'ON_TIME'
      GROUP BY 1
    ),
    new_days AS (
      SELECT substr(a."enrollmentId", 8) AS enrollment_id,
             array_agg(act."dayNumber" ORDER BY act."dayNumber") AS days
      FROM "ActivityAttempt" a
      JOIN "Activity" act ON act.id = a."activityId"
      WHERE a.id LIKE 'aa_sub_%'
        AND a.lateness = 'ON_TIME'
        AND a."activityId" LIKE 'act_dt_%'
      GROUP BY 1
    )
    SELECT e.id, e."currentStreak", e."longestStreak", e."startedAt",
           c."startsAt", ld.days AS "legacyDays", nd.days AS "newDays"
    FROM "Enrollment" e
    JOIN "Challenge" c ON c.id = e."challengeId"
    LEFT JOIN legacy_days ld ON ld."enrollmentId" = e.id
    LEFT JOIN new_days nd ON nd.enrollment_id = e.id
    WHERE e."daysCompleted" > 0
  `);

  const { getCurrentDayNumber } = await import("../../src/lib/date-utils");
  const { computeTrackStreakFromOnTimeDays } = await import(
    "../../src/features/submission/streak-utils"
  );
  let liveLegacyVsNew = 0;
  let liveVsStored = 0;
  for (const row of enrollmentsForStreak) {
    const endDay = getCurrentDayNumber(
      { startedAt: row.startedAt },
      { startsAt: row.startsAt },
    );
    const fromLegacy = computeTrackStreakFromOnTimeDays(
      new Set(row.legacyDays ?? []),
      endDay,
    );
    const fromNew = computeTrackStreakFromOnTimeDays(
      new Set(row.newDays ?? []),
      endDay,
    );
    if (
      fromLegacy.currentStreak !== fromNew.currentStreak ||
      fromLegacy.longestStreak !== fromNew.longestStreak
    ) {
      liveLegacyVsNew += 1;
    }
    if (
      fromLegacy.currentStreak !== row.currentStreak ||
      fromLegacy.longestStreak !== row.longestStreak
    ) {
      liveVsStored += 1;
    }
  }
  log("track_streak_drift", {
    enrollments_compared: enrollmentsForStreak.length,
    live_legacy_vs_new: liveLegacyVsNew,
    live_vs_stored_enrollment: liveVsStored,
    note: "Phase 6 student overlay keeps Enrollment.currentStreak snapshot; live_vs_stored is informational, not a flip blocker",
  });

  const evalOrphans = await one<{
    sub_eval_orphan: number;
    ms_eval_orphan: number;
    qa_eval_orphan: number;
  }>(`
    SELECT
      (SELECT count(*)::int FROM "ActivityEvaluation" e
        WHERE e.id LIKE 'ev_sub_%'
          AND NOT EXISTS (
            SELECT 1 FROM "ActivityAttempt" a WHERE a.id = e."attemptId"
          )) AS sub_eval_orphan,
      (SELECT count(*)::int FROM "ActivityEvaluation" e
        WHERE e.id LIKE 'ev_ms_%'
          AND NOT EXISTS (
            SELECT 1 FROM "ActivityAttempt" a WHERE a.id = e."attemptId"
          )) AS ms_eval_orphan,
      (SELECT count(*)::int FROM "ActivityEvaluation" e
        WHERE e.id LIKE 'ev_qa_%'
          AND NOT EXISTS (
            SELECT 1 FROM "ActivityAttempt" a WHERE a.id = e."attemptId"
          )) AS qa_eval_orphan
  `);
  log("eval_orphans", evalOrphans);

  const orphanAttempts = await many<{
    kind: string;
    n: number;
  }>(`
    SELECT 'aa_sub_orphan' AS kind, count(*)::int AS n
    FROM "ActivityAttempt" a
    WHERE a.id LIKE 'aa_sub_%'
      AND NOT EXISTS (SELECT 1 FROM "Submission" s WHERE a.id = 'aa_sub_' || s.id)
    UNION ALL
    SELECT 'aa_ms_orphan', count(*)::int
    FROM "ActivityAttempt" a
    WHERE a.id LIKE 'aa_ms_%'
      AND NOT EXISTS (
        SELECT 1 FROM "ProgramMissionSubmission" pms WHERE a.id = 'aa_ms_' || pms.id
      )
    UNION ALL
    SELECT 'aa_qa_orphan', count(*)::int
    FROM "ActivityAttempt" a
    WHERE a.id LIKE 'aa_qa_%'
      AND NOT EXISTS (SELECT 1 FROM "QuizAttempt" qa WHERE a.id = 'aa_qa_' || qa.id)
  `);
  log("orphan_attempts", orphanAttempts);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
