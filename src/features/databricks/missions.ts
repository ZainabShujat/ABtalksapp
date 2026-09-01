import "server-only";
import type { Prisma } from "@prisma/client";
import { writeClient } from "@/lib/db";
import {
  DATABRICKS_MAX_RUNS_PER_DAY,
  DATABRICKS_MIN_RUN_INTERVAL_MS,
  DATABRICKS_PROGRAM_SLUG,
  DATABRICKS_TOTAL_DAYS,
} from "@/features/databricks/constants";
import {
  deriveDayState,
  latenessForPass,
  maxUnlockedDay,
  todayKey,
  type DatabricksDayState,
} from "@/features/databricks/progression";
import { parseCalendarKeyToUtcDate } from "@/lib/date-utils";
import { isDayLockBypassEnabled } from "@/lib/feature-flags";
import {
  getShipItHints,
  verifyMission,
  type VerdictLine,
} from "@/features/program/verify-mission";
import {
  countDatabricksAttemptsForDay,
  getLatestDatabricksAttemptAt,
  hasPassedDatabricksActivity,
  listDatabricksAttemptsForDay,
  listDatabricksProgress,
  markDatabricksEnrollmentCompleted,
  recordDatabricksAttempt,
  recomputeDatabricksProgress,
  type DatabricksEnrollment,
} from "@/repositories/databricks";
import { getActivityVerificationForDay } from "@/repositories/learning";

export type DatabricksMissionState = {
  dayState: DatabricksDayState;
  passed: boolean;
  failedRunCount: number;
  runs: {
    attemptNumber: number;
    passed: boolean;
    verdict: VerdictLine[];
    createdAt: string;
  }[];
  shipItHints?: { check: string; path: string }[];
  dataRoomQuestionCount?: number;
};

export type DatabricksSubmitOk = {
  passed: boolean;
  verdict: VerdictLine[];
  pointsAwarded: number;
  attemptNumber: number;
  unlockedDay?: number;
  lateness: string;
};

function parseVerdict(json: unknown): VerdictLine[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (v): v is VerdictLine =>
      !!v &&
      typeof v === "object" &&
      typeof (v as VerdictLine).check === "string" &&
      typeof (v as VerdictLine).passed === "boolean",
  );
}

function jsonPayload(payload: unknown): Prisma.InputJsonValue {
  if (payload !== null && typeof payload === "object") {
    return payload as Prisma.InputJsonValue;
  }
  return {};
}

export async function getDatabricksMissionState(
  enrollment: DatabricksEnrollment,
  dayNumber: number,
): Promise<DatabricksMissionState | null> {
  const verification = await getActivityVerificationForDay(
    DATABRICKS_PROGRAM_SLUG,
    dayNumber,
  );
  if (!verification) return null;

  const [progress, attempts] = await Promise.all([
    listDatabricksProgress(enrollment.id),
    listDatabricksAttemptsForDay(enrollment.id, dayNumber),
  ]);
  const passedDays = new Set(
    progress.filter((p) => p.passed).map((p) => p.dayNumber),
  );
  const dayState = deriveDayState(
    dayNumber,
    maxUnlockedDay(enrollment.startedAt),
    passedDays,
    isDayLockBypassEnabled(),
  );
  const passed = passedDays.has(dayNumber);
  const failedRunCount = attempts.filter((a) => !a.passed).length;

  const hints = getShipItHints({
    missionSpec: verification.missionSpec ?? {},
  });
  const spec = verification.missionSpec;
  let dataRoomQuestionCount: number | undefined;
  if (spec && typeof spec === "object" && "answers" in spec) {
    const answers = (spec as { answers?: unknown }).answers;
    if (Array.isArray(answers) && answers.length > 0) {
      dataRoomQuestionCount = answers.length;
    }
  }

  return {
    dayState,
    passed,
    failedRunCount,
    runs: attempts.map((a) => ({
      attemptNumber: a.attemptNumber,
      passed: a.passed,
      verdict: parseVerdict(a.verdict),
      createdAt: a.createdAt.toISOString(),
    })),
    shipItHints: hints.checks.length > 0 ? hints.checks : undefined,
    dataRoomQuestionCount,
  };
}

export async function submitDatabricksMissionRun(
  enrollment: DatabricksEnrollment,
  dayNumber: number,
  payload: unknown,
): Promise<DatabricksSubmitOk | { ok: false; message: string }> {
  const progress = await listDatabricksProgress(enrollment.id);
  const passedDays = new Set(
    progress.filter((p) => p.passed).map((p) => p.dayNumber),
  );
  const bypass = isDayLockBypassEnabled();
  const dayState = deriveDayState(
    dayNumber,
    maxUnlockedDay(enrollment.startedAt),
    passedDays,
    bypass,
  );

  if (dayState === "LOCKED") {
    return { ok: false, message: "This day is locked." };
  }
  if (dayState === "PASSED") {
    return { ok: false, message: "You already passed this mission." };
  }

  const runCount = await countDatabricksAttemptsForDay(
    enrollment.id,
    dayNumber,
  );
  if (runCount >= DATABRICKS_MAX_RUNS_PER_DAY) {
    return { ok: false, message: "Daily run limit reached for this mission." };
  }
  const latestAt = await getLatestDatabricksAttemptAt(
    enrollment.id,
    dayNumber,
  );
  if (
    latestAt &&
    Date.now() - latestAt.getTime() < DATABRICKS_MIN_RUN_INTERVAL_MS
  ) {
    return { ok: false, message: "Please wait 15 seconds between runs." };
  }

  const verification = await getActivityVerificationForDay(
    DATABRICKS_PROGRAM_SLUG,
    dayNumber,
  );
  if (!verification) {
    return { ok: false, message: "Mission not found." };
  }

  const result = await verifyMission(
    {
      missionType: verification.missionType,
      missionSpec: verification.missionSpec ?? {},
      dayNumber: verification.dayNumber,
    },
    payload,
    { githubRepoUrl: enrollment.githubRepoUrl ?? "" },
  );

  const now = new Date();
  const lateness = latenessForPass(enrollment.startedAt, dayNumber, now);
  const alreadyPassed = await hasPassedDatabricksActivity(
    enrollment.id,
    verification.activityId,
  );
  const firstPass = result.passed && !alreadyPassed;
  const pointsAwarded = firstPass ? verification.missionPoints : 0;
  const attemptNumber = runCount + 1;
  const activityDate = parseCalendarKeyToUtcDate(todayKey(now));

  await writeClient().$transaction(async (tx) => {
    await recordDatabricksAttempt(tx, {
      enrollmentId: enrollment.id,
      activityId: verification.activityId,
      attemptNumber,
      lateness,
      payload: jsonPayload(payload),
      passed: result.passed,
      pointsAwarded,
      verdict: result.verdict as unknown as Prisma.InputJsonValue,
      firstPass,
      activityDate,
    });
    await recomputeDatabricksProgress(tx, enrollment.id);
    if (dayNumber === DATABRICKS_TOTAL_DAYS && result.passed) {
      await markDatabricksEnrollmentCompleted(tx, enrollment.id);
    }
  });

  let unlockedDay: number | undefined;
  if (result.passed && dayNumber < DATABRICKS_TOTAL_DAYS) {
    const afterPassed = new Set(passedDays);
    afterPassed.add(dayNumber);
    const nextState = deriveDayState(
      dayNumber + 1,
      maxUnlockedDay(enrollment.startedAt, now),
      afterPassed,
      bypass,
    );
    if (nextState === "AVAILABLE") unlockedDay = dayNumber + 1;
  }

  return {
    passed: result.passed,
    verdict: result.verdict,
    pointsAwarded,
    attemptNumber,
    unlockedDay,
    lateness,
  };
}
