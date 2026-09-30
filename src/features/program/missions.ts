import "server-only";
import type { Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { prisma, writeClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  PROGRAM_TOTAL_DAYS,
  PROGRAM_TZ,
} from "@/features/program/constants";
import {
  collectPassSkipSets,
  deriveDayState,
  getMaxContentDay,
  isCohortFrozen,
  isSkippedPayload,
} from "@/features/program/progression";
import { isDayLockBypassEnabled } from "@/lib/feature-flags";
import { applyProgramMissionAttemptChange } from "@/repositories/progress-writes";
import {
  applyProgramScoreChange,
  findAiCohortMembershipByMemberId,
} from "@/repositories/program-state";
import { peIdForMember } from "@/repositories/ids";
import {
  getProgramUnlockFloor,
  listProgramMissionAttemptsForDay,
  listProgramMissionProgress,
} from "@/repositories/progress";
import {
  getHiddenTestInputs,
  getShipItHints,
  verifyMission,
  type VerdictLine,
} from "@/features/program/verify-mission";

const MAX_RUNS_PER_DAY = 30;

function checkpointModuleNumber(
  missionSpec: unknown,
  fallbackModuleNumber: number,
): number {
  if (missionSpec && typeof missionSpec === "object") {
    const n = (missionSpec as { checkpointNumber?: unknown }).checkpointNumber;
    if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 4) {
      return n;
    }
  }
  return fallbackModuleNumber;
}
const MIN_RUN_INTERVAL_MS = 15_000;

export type MissionState = {
  dayState: "LOCKED" | "AVAILABLE" | "PASSED" | "SKIPPED";
  failedRunCount: number;
  passed: boolean;
  runs: {
    attemptNumber: number;
    passed: boolean;
    verdict: VerdictLine[];
    createdAt: string;
  }[];
  shipItHints?: { check: string; path: string }[];
  dataRoomQuestionCount?: number;
};

export type SubmitMissionOk = {
  passed: boolean;
  verdict: VerdictLine[];
  pointsAwarded: number;
  attemptNumber: number;
  unlockedDay?: number;
  cleanPass: boolean;
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

export async function recomputeMemberScore(
  tx: Prisma.TransactionClient,
  memberId: string,
): Promise<void> {
  await applyProgramScoreChange(tx, { memberId });
}

async function getDayAvailability(
  memberId: string,
  dayNumber: number,
): Promise<
  | { ok: true; state: "AVAILABLE"; member: { id: string; cohortId: string; highestUnlockedDay: number; skipTokensUsed: number; githubRepoUrl: string; missionPoints: number; cleanPassCount: number } }
  | { ok: false; message: string }
> {
  const member = await findAiCohortMembershipByMemberId(memberId);
  if (!member) return { ok: false, message: "Member not found." };

  if (isCohortFrozen(member.cohort)) {
    return {
      ok: false,
      message: "This cohort is closed — submissions are no longer accepted.",
    };
  }

  const submissions = await listProgramMissionProgress(memberId);

  const { passedDays, skippedDays } = collectPassSkipSets(submissions);
  const unlockFloor = await getProgramUnlockFloor(
    memberId,
    member.highestUnlockedDay,
  );
  const maxContentDay = getMaxContentDay(member, unlockFloor);

  const state = deriveDayState(
    dayNumber,
    maxContentDay,
    passedDays,
    skippedDays,
    isDayLockBypassEnabled(),
  );

  if (state === "LOCKED") {
    return { ok: false, message: "This day is locked." };
  }
  if (state === "PASSED") {
    return { ok: false, message: "You already passed this mission." };
  }
  if (state === "SKIPPED") {
    return { ok: false, message: "This day was skipped." };
  }

  return { ok: true, state: "AVAILABLE", member };
}

async function checkRateLimit(
  memberId: string,
  dayNumber: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const runs = await listProgramMissionAttemptsForDay(memberId, dayNumber);
  const realRuns = runs.filter((r) => !isSkippedPayload(r.payload));
  if (realRuns.length >= MAX_RUNS_PER_DAY) {
    return { ok: false, message: "Daily run limit reached for this mission." };
  }

  const last = realRuns[0];
  if (last && Date.now() - last.createdAt.getTime() < MIN_RUN_INTERVAL_MS) {
    return { ok: false, message: "Please wait 15 seconds between runs." };
  }

  return { ok: true };
}

export async function getMissionState(
  memberId: string,
  dayNumber: number,
): Promise<MissionState | null> {
  const member = await findAiCohortMembershipByMemberId(memberId);
  if (!member) return null;

  const [daySubmissions, allSubmissions, day, unlockFloor] = await Promise.all([
    listProgramMissionAttemptsForDay(memberId, dayNumber),
    listProgramMissionProgress(memberId),
    prisma.programDay.findUnique({
      where: { dayNumber },
      select: { missionType: true, missionSpec: true },
    }),
    getProgramUnlockFloor(memberId, member.highestUnlockedDay),
  ]);
  if (!day) return null;

  const { passedDays, skippedDays } = collectPassSkipSets(allSubmissions);
  const maxContentDay = getMaxContentDay(member, unlockFloor);

  const dayState = deriveDayState(
    dayNumber,
    maxContentDay,
    passedDays,
    skippedDays,
    isDayLockBypassEnabled(),
  );

  const failedRunCount = daySubmissions.filter(
    (s) => !s.passed && !isSkippedPayload(s.payload),
  ).length;

  const spec = day.missionSpec as Record<string, unknown>;
  const dataRoomQuestionCount = Array.isArray(spec?.answers)
    ? spec.answers.length
    : undefined;

  return {
    dayState,
    failedRunCount,
    passed: passedDays.has(dayNumber),
    runs: daySubmissions
      .filter((s) => !isSkippedPayload(s.payload))
      .map((s) => ({
        attemptNumber: s.attemptNumber,
        passed: s.passed,
        verdict: parseVerdict(s.verdict),
        createdAt: s.createdAt.toISOString(),
      })),
    shipItHints:
      day.missionType === "SHIP_IT" ? getShipItHints(day).checks : undefined,
    dataRoomQuestionCount,
  };
}

export async function getHiddenTestInputsForDay(
  memberId: string,
  dayNumber: number,
): Promise<
  | { ok: true; inputs: { check: string; input: string }[] }
  | { ok: false; message: string }
> {
  const avail = await getDayAvailability(memberId, dayNumber);
  if (!avail.ok) return avail;

  const day = await prisma.programDay.findUnique({
    where: { dayNumber },
    select: { missionType: true, missionSpec: true },
  });
  if (!day || day.missionType !== "CODE_SPRINT") {
    return { ok: false, message: "Hidden tests are only for Code Sprint missions." };
  }

  return { ok: true, ...getHiddenTestInputs(day) };
}

export async function submitMissionRun(
  memberId: string,
  dayNumber: number,
  payload: unknown,
): Promise<SubmitMissionOk | { ok: false; message: string }> {
  const avail = await getDayAvailability(memberId, dayNumber);
  if (!avail.ok) return avail;

  const rate = await checkRateLimit(memberId, dayNumber);
  if (!rate.ok) return rate;

  const day = await prisma.programDay.findUnique({
    where: { dayNumber },
    select: {
      id: true,
      dayNumber: true,
      missionType: true,
      missionSpec: true,
      missionPoints: true,
      module: { select: { number: true } },
    },
  });
  if (!day) return { ok: false, message: "Day not found." };

  const verifyResult = await verifyMission(day, payload, {
    githubRepoUrl: avail.member.githubRepoUrl,
  });

  const dayAttempts = await listProgramMissionAttemptsForDay(memberId, dayNumber);
  const attemptNumber = dayAttempts.length + 1;
  const allProgress = await listProgramMissionProgress(memberId);
  let isFirstPass =
    verifyResult.passed &&
    !allProgress.some((row) => row.dayNumber === dayNumber && row.passed);

  let pointsAwarded = 0;
  let unlockedDay: number | undefined;
  const cleanPass = verifyResult.passed && attemptNumber === 1;

  await writeClient().$transaction(async (tx) => {
    if (verifyResult.passed && isFirstPass) {
      pointsAwarded = day.missionPoints;
    }

    await applyProgramMissionAttemptChange(tx, {
      memberId,
      programDayId: day.id,
      dayNumber,
      attemptNumber,
      payload: payload as Prisma.InputJsonValue,
      verdict: verifyResult.verdict as Prisma.InputJsonValue,
      passed: verifyResult.passed,
      pointsAwarded,
      createdAt: new Date(),
    });

    if (verifyResult.passed && isFirstPass) {
      await applyProgramScoreChange(tx, {
        memberId,
        missionPointsDelta: pointsAwarded,
        cleanPassCountDelta: cleanPass ? 1 : 0,
      });

      // Only surface "continue" when the next day is already within calendar unlock.
      const memberAfter = await findAiCohortMembershipByMemberId(memberId);
      if (memberAfter) {
        const nextDay = Math.min(PROGRAM_TOTAL_DAYS, dayNumber + 1);
        const maxContentDay = getMaxContentDay(
          memberAfter,
          memberAfter.highestUnlockedDay,
        );
        const allSubs = await tx.activityAttempt.findMany({
          where: {
            enrollmentId: peIdForMember(memberId),
            id: { startsWith: "aa_ms_" },
          },
          select: {
            passed: true,
            payload: true,
            activity: { select: { dayNumber: true } },
          },
        });
        const { passedDays, skippedDays } = collectPassSkipSets(
          allSubs.flatMap((row) => {
            const dn = row.activity.dayNumber;
            if (dn == null) return [];
            return [{ dayNumber: dn, passed: row.passed, payload: row.payload }];
          }),
        );
        const nextState = deriveDayState(
          nextDay,
          maxContentDay,
          passedDays,
          skippedDays,
          isDayLockBypassEnabled(),
        );
        if (nextState === "AVAILABLE") {
          unlockedDay = nextDay;
        }
      }
    }

    if (verifyResult.passed && day.missionType === "BOSS_BUILD") {
      const bossPayload = payload as { repoUrl: string; writeup: string };
      const moduleNumber = checkpointModuleNumber(
        day.missionSpec,
        day.module.number,
      );
      await tx.programProject.upsert({
        where: {
          memberId_moduleNumber: {
            memberId,
            moduleNumber,
          },
        },
        create: {
          memberId,
          programEnrollmentId: peIdForMember(memberId),
          moduleNumber,
          repoUrl: bossPayload.repoUrl,
          writeup: bossPayload.writeup,
          status: "SUBMITTED",
        },
        update: {
          repoUrl: bossPayload.repoUrl,
          writeup: bossPayload.writeup,
          status: "SUBMITTED",
          submittedAt: new Date(),
        },
      });
    }
  });

  if (verifyResult.passed && isFirstPass) {
    try {
      // Dynamic import avoids commits.ts ↔ missions.ts cycle (recomputeMemberScore).
      const { creditCommitDayForMember } = await import(
        "@/features/program/commits"
      );
      const todayKey = formatInTimeZone(new Date(), PROGRAM_TZ, "yyyy-MM-dd");
      const credit = await creditCommitDayForMember(memberId, todayKey);
      if (!credit.ok) {
        logger.error("[missions] commit credit after pass failed", {
          memberId,
          dayNumber,
          message: credit.message,
        });
      }
    } catch (e) {
      logger.error("[missions] commit credit after pass errored", {
        memberId,
        dayNumber,
        error: String(e),
      });
    }
  }

  return {
    passed: verifyResult.passed,
    verdict: verifyResult.verdict,
    pointsAwarded,
    attemptNumber,
    unlockedDay,
    cleanPass,
  };
}

export async function useSkipToken(
  _memberId: string,
  _dayNumber: number,
): Promise<{ ok: true; unlockedDay: number } | { ok: false; message: string }> {
  return { ok: false, message: "Skip tokens are disabled." };
}
