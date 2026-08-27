/**
 * Child-only ENABLE_NEW_PROGRESS=true rehearsal. Read-only.
 * Refuses production. Does not write QuizAttempt answers or EnrollmentProgress.
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { assertChildBranch, PRODUCTION_NEON_HOST_ID } from "./migrate-078-shared";
import {
  collectPassSkipSets,
  isSkippedPayload,
  isWaivedPayload,
} from "../../src/features/program/progression";
import { mapQuizAttemptAnswers } from "../../src/features/quiz/get-quiz-with-questions";
import {
  getChallengeProgressStats,
  getQuizAttemptForUser,
  listHubSubmissionTimes,
  listProgramMissionProgress,
} from "../../src/repositories/progress";

config({ path: ".env.local" });
config();

const prisma = new PrismaClient();

function log(label: string, value: unknown): void {
  process.stdout.write(
    `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}\n`,
  );
}

function setEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const n of a) if (!b.has(n)) return false;
  return true;
}

async function main() {
  if ((process.env.DATABASE_URL ?? "").includes(PRODUCTION_NEON_HOST_ID)) {
    throw new Error(
      "rehearse-078-progress refuses production. Point DATABASE_URL at a Neon child.",
    );
  }
  process.env.PHASE2_ALLOW_PRODUCTION = "";
  assertChildBranch();
  process.env.ENABLE_NEW_PROGRESS = "true";
  process.env.ENABLE_NEW_LEARNING = "true";
  await prisma.$queryRaw`SELECT 1`;
  console.error("rehearse: challenge overlay");

  const enrollments = await prisma.enrollment.findMany({
    where: { daysCompleted: { gt: 0 } },
    select: {
      id: true,
      userId: true,
      daysCompleted: true,
      currentStreak: true,
      longestStreak: true,
      lastSubmittedDay: true,
    },
    take: 250,
    orderBy: { daysCompleted: "desc" },
  });

  let streakMismatch = 0;
  let daysMismatch = 0;
  for (const row of enrollments) {
    const stats = await getChallengeProgressStats(row.id);
    if (
      stats.currentStreak !== row.currentStreak ||
      stats.longestStreak !== row.longestStreak
    ) {
      streakMismatch += 1;
    }
    if (stats.daysCompleted !== row.daysCompleted) {
      daysMismatch += 1;
    }
  }
  log("challenge_overlay_sample", {
    sampled: enrollments.length,
    streak_mismatch: streakMismatch,
    daysCompleted_mismatch: daysMismatch,
  });

  console.error("rehearse: program members");

  const members = await prisma.programMember.findMany({
    select: { id: true },
  });
  let passSkipMismatch = 0;
  let skippedInPassed = 0;
  let earnedInflatedBySkip = 0;
  let waivedVsPassedConfusion = 0;
  const waivedSkippedSummary = {
    members: members.length,
    waived_rows: 0,
    skipped_rows: 0,
    earned_passed_days: 0,
  };
  for (const member of members) {
    const [legacy, next] = await Promise.all([
      prisma.programMissionSubmission.findMany({
        where: { memberId: member.id },
        select: { dayNumber: true, passed: true, payload: true },
      }),
      listProgramMissionProgress(member.id),
    ]);
    const fromLegacy = collectPassSkipSets(legacy);
    const fromNew = collectPassSkipSets(next);
    if (
      !setEqual(fromLegacy.passedDays, fromNew.passedDays) ||
      !setEqual(fromLegacy.skippedDays, fromNew.skippedDays)
    ) {
      passSkipMismatch += 1;
    }
    for (const day of fromNew.skippedDays) {
      if (fromNew.passedDays.has(day)) skippedInPassed += 1;
    }
    const waivedDays = new Set(
      next.filter((r) => isWaivedPayload(r.payload)).map((r) => r.dayNumber),
    );
    const skippedRows = next.filter((r) => isSkippedPayload(r.payload));
    waivedSkippedSummary.waived_rows += next.filter((r) =>
      isWaivedPayload(r.payload),
    ).length;
    waivedSkippedSummary.skipped_rows += skippedRows.length;
    const earned = [...fromNew.passedDays].filter((d) => !waivedDays.has(d))
      .length;
    waivedSkippedSummary.earned_passed_days += earned;
    const skippedCountedAsEarned = skippedRows.filter(
      (r) => r.passed && !isWaivedPayload(r.payload),
    ).length;
    if (skippedCountedAsEarned > 0) earnedInflatedBySkip += 1;
    for (const row of next) {
      if (isWaivedPayload(row.payload) && isSkippedPayload(row.payload)) {
        waivedVsPassedConfusion += 1;
      }
    }
  }
  log("program_pass_skip", {
    pass_skip_set_mismatch: passSkipMismatch,
    skipped_also_in_passed: skippedInPassed,
    members_with_skip_inflating_earned: earnedInflatedBySkip,
    waived_and_skipped_same_row: waivedVsPassedConfusion,
    ...waivedSkippedSummary,
  });

  console.error("rehearse: hub heatmap");
  const hubUsers = await prisma.submission.findMany({
    distinct: ["userId"],
    select: { userId: true },
    take: 50,
  });
  let hubMismatch = 0;
  for (const { userId } of hubUsers) {
    const [legacy, next] = await Promise.all([
      prisma.submission.findMany({
        where: { enrollment: { userId } },
        select: { submittedAt: true },
      }),
      listHubSubmissionTimes(userId),
    ]);
    const a = legacy.map((r) => r.submittedAt.toISOString()).sort();
    const b = next.map((d) => d.toISOString()).sort();
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) hubMismatch += 1;
  }
  log("hub_heatmap_sample", {
    sampled: hubUsers.length,
    mismatch: hubMismatch,
  });

  console.error("rehearse: quiz");
  const quizCatalog = await prisma.$queryRaw<
    Array<{
      quizId: string;
      legacyId: string;
      questionOrder: number;
      newId: string | null;
    }>
  >`
    SELECT qq."quizId" AS "quizId", qq.id AS "legacyId", qq."questionOrder" AS "questionOrder",
           q.id AS "newId"
    FROM "QuizQuestion" qq
    LEFT JOIN "Activity" a ON a.id = 'act_quiz_' || qq."quizId"
    LEFT JOIN "QuizActivityConfig" qc ON qc."activityId" = a.id
    LEFT JOIN "Question" q ON q."configId" = qc.id AND q.position = qq."questionOrder"
  `;
  const currentByQuiz = new Map<string, Set<string>>();
  const orderByQuiz = new Map<string, Map<number, string>>();
  const legacyByQuiz = new Map<
    string,
    Array<{ id: string; questionOrder: number }>
  >();
  for (const q of quizCatalog) {
    if (!legacyByQuiz.has(q.quizId)) legacyByQuiz.set(q.quizId, []);
    legacyByQuiz.get(q.quizId)!.push({
      id: q.legacyId,
      questionOrder: q.questionOrder,
    });
    if (q.newId) {
      if (!currentByQuiz.has(q.quizId)) currentByQuiz.set(q.quizId, new Set());
      currentByQuiz.get(q.quizId)!.add(q.newId);
      if (!orderByQuiz.has(q.quizId)) orderByQuiz.set(q.quizId, new Map());
      orderByQuiz.get(q.quizId)!.set(q.questionOrder, q.newId);
    }
  }

  const quizAttempts = await prisma.quizAttempt.findMany({
    select: {
      id: true,
      userId: true,
      quizId: true,
      score: true,
      answers: true,
    },
  });
  const quizScore = await prisma.$queryRaw<
    Array<{ missing: number; score_mismatch: number }>
  >`
    SELECT
      count(*) FILTER (
        WHERE a.id IS NULL
      )::int AS missing,
      count(*) FILTER (
        WHERE a.id IS NOT NULL AND a.score IS DISTINCT FROM qa.score
      )::int AS score_mismatch
    FROM "QuizAttempt" qa
    LEFT JOIN "ActivityAttempt" a ON a.id = 'aa_qa_' || qa.id
  `;
  const missingNew = quizScore[0]?.missing ?? 0;
  const scoreMismatch = quizScore[0]?.score_mismatch ?? 0;

  let deadKeyScoreMissing = 0;
  let remappedOk = 0;
  let deadKeys = 0;
  const deadKeySamples: typeof quizAttempts = [];
  for (const row of quizAttempts) {
    const answers = (row.answers as Record<string, string> | null) ?? {};
    const mapped = mapQuizAttemptAnswers({
      currentQuestionIds: currentByQuiz.get(row.quizId) ?? new Set(),
      answers,
      legacyByOrder: legacyByQuiz.get(row.quizId) ?? [],
      currentIdByOrder: orderByQuiz.get(row.quizId) ?? new Map(),
    });
    const keys = Object.keys(answers);
    if (!mapped.answersDetailAvailable && keys.length > 0) {
      deadKeys += 1;
      if (deadKeySamples.length < 25) deadKeySamples.push(row);
    } else if (mapped.answersDetailAvailable) {
      remappedOk += 1;
    }
  }
  for (const row of deadKeySamples) {
    const next = await getQuizAttemptForUser(row.userId, row.quizId);
    if (!next || next.score !== row.score) deadKeyScoreMissing += 1;
  }
  log("quiz_flag_on", {
    attempts: quizAttempts.length,
    missing_new_read: missingNew,
    score_mismatch: scoreMismatch,
    historical_dead_or_unmapped_keys: deadKeys,
    dead_keys_score_mismatch: deadKeyScoreMissing,
    detail_available: remappedOk,
  });

  const failed =
    streakMismatch +
      daysMismatch +
      passSkipMismatch +
      skippedInPassed +
      earnedInflatedBySkip +
      waivedVsPassedConfusion +
      hubMismatch +
      missingNew +
      scoreMismatch +
      deadKeyScoreMissing >
    0;
  log("rehearsal_ok", !failed);
  if (failed) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
