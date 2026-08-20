import "server-only";
import type { Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db";
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
  const member = await tx.programMember.findUnique({
    where: { id: memberId },
    select: {
      missionPoints: true,
      conceptPoints: true,
      commitPoints: true,
      projectPoints: true,
    },
  });
  if (!member) return;
  await tx.programMember.update({
    where: { id: memberId },
    data: {
      totalScore:
        member.missionPoints +
        member.conceptPoints +
        member.commitPoints +
        member.projectPoints,
    },
  });
}

async function getDayAvailability(
  memberId: string,
  dayNumber: number,
): Promise<
  | { ok: true; state: "AVAILABLE"; member: { id: string; cohortId: string; highestUnlockedDay: number; skipTokensUsed: number; githubRepoUrl: string; missionPoints: number; cleanPassCount: number } }
  | { ok: false; message: string }
> {
  const member = await prisma.programMember.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      cohortId: true,
      highestUnlockedDay: true,
      skipTokensUsed: true,
      githubRepoUrl: true,
      missionPoints: true,
      cleanPassCount: true,
      cohort: {
        select: { id: true, name: true, status: true, endsAt: true, startsAt: true },
      },
    },
  });
  if (!member) return { ok: false, message: "Member not found." };

  if (await isCohortFrozen(member.cohort)) {
    return { ok: false, message: "This cohort has ended — submissions are closed." };
  }

  const submissions = await prisma.programMissionSubmission.findMany({
    where: { memberId },
    select: { dayNumber: true, passed: true, payload: true },
  });

  const { passedDays, skippedDays } = collectPassSkipSets(submissions);
  const maxContentDay = getMaxContentDay(
    member.cohort,
    member.highestUnlockedDay,
  );

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
  const runs = await prisma.programMissionSubmission.findMany({
    where: { memberId, dayNumber },
    select: { createdAt: true, payload: true },
    orderBy: { createdAt: "desc" },
  });

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
  const member = await prisma.programMember.findUnique({
    where: { id: memberId },
    select: {
      highestUnlockedDay: true,
      skipTokensUsed: true,
      cohort: { select: { startsAt: true } },
    },
  });
  if (!member) return null;

  const [daySubmissions, allSubmissions, day] = await Promise.all([
    prisma.programMissionSubmission.findMany({
      where: { memberId, dayNumber },
      select: {
        attemptNumber: true,
        passed: true,
        verdict: true,
        payload: true,
        createdAt: true,
      },
      orderBy: { attemptNumber: "asc" },
    }),
    prisma.programMissionSubmission.findMany({
      where: { memberId },
      select: { dayNumber: true, passed: true, payload: true },
    }),
    prisma.programDay.findUnique({
      where: { dayNumber },
      select: { missionType: true, missionSpec: true },
    }),
  ]);
  if (!day) return null;

  const { passedDays, skippedDays } = collectPassSkipSets(allSubmissions);
  const maxContentDay = getMaxContentDay(
    member.cohort,
    member.highestUnlockedDay,
  );

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

  const attemptCount = await prisma.programMissionSubmission.count({
    where: { memberId, dayNumber },
  });
  const attemptNumber = attemptCount + 1;
  const isFirstPass =
    verifyResult.passed &&
    !(await prisma.programMissionSubmission.findFirst({
      where: { memberId, dayNumber, passed: true },
      select: { id: true },
    }));

  let pointsAwarded = 0;
  let unlockedDay: number | undefined;
  const cleanPass = verifyResult.passed && attemptNumber === 1;

  await prisma.$transaction(async (tx) => {
    if (verifyResult.passed && isFirstPass) {
      pointsAwarded = day.missionPoints;
    }

    await tx.programMissionSubmission.create({
      data: {
        memberId,
        dayNumber,
        attemptNumber,
        payload: payload as Prisma.InputJsonValue,
        verdict: verifyResult.verdict as Prisma.InputJsonValue,
        passed: verifyResult.passed,
        pointsAwarded,
      },
    });

    if (verifyResult.passed && isFirstPass) {
      await tx.programMember.update({
        where: { id: memberId },
        data: {
          missionPoints: { increment: pointsAwarded },
          ...(cleanPass ? { cleanPassCount: { increment: 1 } } : {}),
        },
      });
      await recomputeMemberScore(tx, memberId);

      // Only surface "continue" when the next day is already within calendar unlock.
      const memberAfter = await tx.programMember.findUnique({
        where: { id: memberId },
        select: {
          highestUnlockedDay: true,
          cohort: { select: { startsAt: true } },
        },
      });
      if (memberAfter) {
        const nextDay = Math.min(PROGRAM_TOTAL_DAYS, dayNumber + 1);
        const maxContentDay = getMaxContentDay(
          memberAfter.cohort,
          memberAfter.highestUnlockedDay,
        );
        const allSubs = await tx.programMissionSubmission.findMany({
          where: { memberId },
          select: { dayNumber: true, passed: true, payload: true },
        });
        const { passedDays, skippedDays } = collectPassSkipSets(allSubs);
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
