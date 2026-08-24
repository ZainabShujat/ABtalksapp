import "server-only";
import type { Prisma, ProgramEntrySection } from "@prisma/client";
import { prisma, writeClient } from "@/lib/db";
import { isProgramEntryBypassEnabled } from "@/lib/feature-flags";
import { logger } from "@/lib/logger";
import {
  getCohortByJoinCode,
  getOpenEnrollmentCohort,
  normalizeJoinCode,
  resolveProgramMemberForUser,
} from "@/lib/program-auth";
import type { ApplyProfileInput } from "@/lib/validations/program";
import { bootstrapMemberStartDay } from "@/features/program/bootstrap-start-day";
import { programMember } from "@/repositories/legacy/program-member";
import { studentProfile } from "@/repositories/legacy/student-profile";
import { dualWriteProgramMember } from "@/repositories/dual-write";

export const ENTRY_DURATION_MIN = 25;
export const ENTRY_PER_SECTION = 10;
export const ENTRY_TOTAL = ENTRY_PER_SECTION * 2;
export const ENTRY_PASS_TOTAL = 12;
export const ENTRY_PASS_TECHNICAL = 5;
export const ENTRY_MAX_ATTEMPTS = 2;
export const ENTRY_RETAKE_COOLDOWN_HOURS = 24;

export type EntryQuestionClient = {
  id: string;
  section: ProgramEntrySection;
  question: string;
  options: string[];
};

export type EntryReviewRow = {
  questionId: string;
  section: ProgramEntrySection;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  userAnswer: number | null;
  isCorrect: boolean;
};

export type EntryOutcome = "ENROLLED" | "WAITLISTED" | "RETAKE" | "NOT_ELIGIBLE";

export type EntrySubmitOk = {
  ok: true;
  passed: boolean;
  aptitudeScore: number;
  technicalScore: number;
  totalScore: number;
  outcome: EntryOutcome;
  retakeAtIso: string | null;
  review: EntryReviewRow[];
};

type Result<T> = ({ ok: true } & T) | { ok: false; message: string };

export type EntryProfile = {
  fullName: string;
  jobRole: string;
  company: string;
  yearsExperience: number;
  education: string | null;
  university: string | null;
  graduationYear: number | null;
  skills: string[];
  linkedinUrl: string | null;
  resumeUrl: string | null;
  phone: string | null;
  githubUsername: string;
  githubRepoUrl: string;
};

export type EntryState =
  | { screen: "need_code" }
  | { screen: "invalid_code" }
  | { screen: "closed"; cohortName: string }
  | {
      screen: "form";
      cohortName: string;
      joinCode: string;
      existingProfile: EntryProfile | null;
    }
  | { screen: "intro"; attemptNumber: number }
  | { screen: "in_progress"; attemptId: string }
  | { screen: "cooldown"; retakeAtIso: string }
  | { screen: "failed" }
  | { screen: "enrolled" }
  | { screen: "waitlisted" };

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function emptyToNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Newest APPLIED (or mid-funnel) membership for assessment resume. */
async function getAppliedMembership(userId: string) {
  return programMember.findFirst({
    where: { userId, status: "APPLIED" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      cohortId: true,
      fullName: true,
      jobRole: true,
      company: true,
      yearsExperience: true,
      education: true,
      university: true,
      graduationYear: true,
      skills: true,
      linkedinUrl: true,
      resumeUrl: true,
      phone: true,
      githubUsername: true,
      githubRepoUrl: true,
      cohort: {
        select: {
          id: true,
          name: true,
          status: true,
          capacity: true,
          joinCode: true,
        },
      },
    },
  });
}

async function getWaitlistedMembership(userId: string) {
  return programMember.findFirst({
    where: { userId, status: "WAITLISTED" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

/** Capacity-checked enroll or waitlist + Day-start bootstrap when enrolled. */
async function enrollOrWaitlist(
  tx: Prisma.TransactionClient,
  userId: string,
  cohortId: string,
): Promise<"ENROLLED" | "WAITLISTED"> {
  const cohort = await tx.programCohort.findUnique({
    where: { id: cohortId },
    select: { capacity: true },
  });
  const enrolledCount = await tx.programMember.count({
    where: { cohortId, status: "ENROLLED" },
  });
  const hasRoom = !!cohort && enrolledCount < cohort.capacity;

  const memberAfter = await tx.programMember.update({
    where: { userId_cohortId: { userId, cohortId } },
    data: hasRoom
      ? { status: "ENROLLED", enrolledAt: new Date() }
      : { status: "WAITLISTED" },
    select: { id: true },
  });
  await dualWriteProgramMember(tx, memberAfter.id);
  if (hasRoom) {
    await bootstrapMemberStartDay(tx, memberAfter.id);
  }
  return hasRoom ? "ENROLLED" : "WAITLISTED";
}

export async function getEntryState(
  userId: string,
  joinCode?: string | null,
): Promise<EntryState> {
  const enrolled = await resolveProgramMemberForUser(userId);
  if (enrolled) return { screen: "enrolled" };

  const waitlisted = await getWaitlistedMembership(userId);
  if (waitlisted) return { screen: "waitlisted" };

  const applied = await getAppliedMembership(userId);
  if (applied) {
    const cohort = applied.cohort;

    if (isProgramEntryBypassEnabled()) {
      const outcome = await writeClient().$transaction(
        (tx) => enrollOrWaitlist(tx, userId, cohort.id),
        { maxWait: 10_000, timeout: 20_000 },
      );
      return outcome === "ENROLLED"
        ? { screen: "enrolled" }
        : { screen: "waitlisted" };
    }

    const attempts = await prisma.programEntryAttempt.findMany({
      where: { userId, cohortId: cohort.id },
      orderBy: { attemptNumber: "asc" },
      select: { id: true, submittedAt: true, passed: true },
    });

    const inProgress = attempts.find((a) => a.submittedAt === null);
    if (inProgress) {
      return { screen: "in_progress", attemptId: inProgress.id };
    }

    if (cohort.status !== "ENROLLING") {
      return { screen: "closed", cohortName: cohort.name };
    }

    const used = attempts.length;
    if (used === 0) {
      return { screen: "intro", attemptNumber: 1 };
    }

    if (used === 1) {
      const first = attempts[0]!;
      const submittedAt = first.submittedAt!;
      const retakeAt = new Date(
        submittedAt.getTime() + ENTRY_RETAKE_COOLDOWN_HOURS * 3600_000,
      );
      if (Date.now() < retakeAt.getTime()) {
        return { screen: "cooldown", retakeAtIso: retakeAt.toISOString() };
      }
      return { screen: "intro", attemptNumber: 2 };
    }

    return { screen: "failed" };
  }

  const rawCode = joinCode?.trim();
  if (!rawCode) {
    const open = await getOpenEnrollmentCohort();
    if (!open) return { screen: "need_code" };
    return {
      screen: "form",
      cohortName: open.name,
      joinCode: open.joinCode,
      existingProfile: null,
    };
  }

  const cohort = await getCohortByJoinCode(rawCode);
  if (!cohort) return { screen: "invalid_code" };
  if (cohort.status !== "ENROLLING") {
    return { screen: "closed", cohortName: cohort.name };
  }

  return {
    screen: "form",
    cohortName: cohort.name,
    joinCode: cohort.joinCode,
    existingProfile: null,
  };
}

export async function createApplication(
  userId: string,
  profile: ApplyProfileInput,
  joinCode: string,
): Promise<Result<{ cohortId: string }>> {
  const cohort = await getCohortByJoinCode(joinCode);
  if (!cohort) {
    return { ok: false, message: "Invalid cohort join code." };
  }
  if (cohort.status !== "ENROLLING") {
    return { ok: false, message: "Applications for this cohort are closed." };
  }

  const alreadyIn = await resolveProgramMemberForUser(userId);
  if (alreadyIn) {
    return { ok: false, message: "You are already enrolled in a program cohort." };
  }

  const existingStudent = await studentProfile.findUnique({
    where: { userId },
    select: {
      fullName: true,
      role: true,
      organization: true,
      yearsExperience: true,
      college: true,
      graduationYear: true,
      phone: true,
      resumeUrl: true,
    },
  });
  if (!existingStudent) {
    return { ok: false, message: "Complete your registration before applying." };
  }

  const existing = await programMember.findUnique({
    where: { userId_cohortId: { userId, cohortId: cohort.id } },
    select: { status: true },
  });
  if (
    existing &&
    (existing.status === "ENROLLED" ||
      existing.status === "WAITLISTED" ||
      existing.status === "COMPLETED")
  ) {
    return { ok: false, message: "You have already applied to this cohort." };
  }

  const data = {
    fullName: existingStudent.fullName,
    jobRole: existingStudent.role,
    company: existingStudent.organization,
    yearsExperience: existingStudent.yearsExperience,
    education: null,
    university: existingStudent.college,
    graduationYear: existingStudent.graduationYear,
    skills: profile.skills,
    linkedinUrl: emptyToNull(profile.linkedinUrl),
    resumeUrl: existingStudent.resumeUrl,
    phone: existingStudent.phone,
    githubUsername: profile.githubUsername,
    githubRepoUrl: profile.githubRepoUrl,
  };

  await writeClient().$transaction(
    async (tx) => {
      const member = await tx.programMember.upsert({
        where: { userId_cohortId: { userId, cohortId: cohort.id } },
        create: {
          userId,
          cohortId: cohort.id,
          status: "APPLIED",
          ...data,
          recruiterVisibilityConsentAt: new Date(),
        },
        update: { status: "APPLIED", ...data },
        select: { id: true },
      });
      await dualWriteProgramMember(tx, member.id);
      if (isProgramEntryBypassEnabled()) {
        await enrollOrWaitlist(tx, userId, cohort.id);
      }
    },
    // Neon pooler drops idle interactive txs (~5s). Bootstrap needs headroom.
    { maxWait: 10_000, timeout: 20_000 },
  );

  return { ok: true, cohortId: cohort.id };
}

export type ActiveAssessment = {
  attemptId: string;
  attemptNumber: number;
  deadlineIso: string;
  durationMin: number;
  questions: EntryQuestionClient[];
};

async function loadQuestionsForClient(
  ids: string[],
): Promise<EntryQuestionClient[]> {
  const rows = await prisma.programEntryQuestion.findMany({
    where: { id: { in: ids } },
    select: { id: true, section: true, question: true, options: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered: EntryQuestionClient[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row) ordered.push(row);
  }
  return ordered;
}

/** Returns the caller's unsubmitted attempt (for the assessment page), else null. */
export async function getActiveAssessment(
  userId: string,
): Promise<ActiveAssessment | null> {
  const applied = await getAppliedMembership(userId);
  if (!applied) return null;

  const attempt = await prisma.programEntryAttempt.findFirst({
    where: { userId, cohortId: applied.cohortId, submittedAt: null },
    orderBy: { attemptNumber: "desc" },
    select: { id: true, attemptNumber: true, questionIds: true, startedAt: true },
  });
  if (!attempt) return null;

  const ids = (attempt.questionIds as string[]) ?? [];
  const questions = await loadQuestionsForClient(ids);
  const deadline = new Date(
    attempt.startedAt.getTime() + ENTRY_DURATION_MIN * 60_000,
  );

  return {
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    deadlineIso: deadline.toISOString(),
    durationMin: ENTRY_DURATION_MIN,
    questions,
  };
}

export async function startEntryAttempt(
  userId: string,
): Promise<Result<ActiveAssessment>> {
  const applied = await getAppliedMembership(userId);
  if (!applied) {
    return {
      ok: false,
      message: "Apply to the program before starting the assessment.",
    };
  }

  const cohort = applied.cohort;

  // Resume an in-progress attempt instead of creating a second one.
  const resumable = await getActiveAssessment(userId);
  if (resumable) return { ok: true, ...resumable };

  if (cohort.status !== "ENROLLING") {
    return { ok: false, message: "Applications for this cohort are closed." };
  }

  const attempts = await prisma.programEntryAttempt.findMany({
    where: { userId, cohortId: cohort.id },
    orderBy: { attemptNumber: "asc" },
    select: { submittedAt: true },
  });
  if (attempts.length >= ENTRY_MAX_ATTEMPTS) {
    return { ok: false, message: "You have used all your assessment attempts." };
  }
  if (attempts.length === 1) {
    const submittedAt = attempts[0]!.submittedAt;
    if (submittedAt) {
      const retakeAt = submittedAt.getTime() + ENTRY_RETAKE_COOLDOWN_HOURS * 3600_000;
      if (Date.now() < retakeAt) {
        return { ok: false, message: "Your retake is not available yet." };
      }
    }
  }

  const [aptitude, technical] = await Promise.all([
    prisma.programEntryQuestion.findMany({
      where: { section: "APTITUDE", active: true },
      select: { id: true },
    }),
    prisma.programEntryQuestion.findMany({
      where: { section: "TECHNICAL", active: true },
      select: { id: true },
    }),
  ]);

  if (
    aptitude.length < ENTRY_PER_SECTION ||
    technical.length < ENTRY_PER_SECTION
  ) {
    return {
      ok: false,
      message: "The assessment is not ready yet. Please try again later.",
    };
  }

  const aptIds = shuffle(aptitude.map((q) => q.id)).slice(0, ENTRY_PER_SECTION);
  const techIds = shuffle(technical.map((q) => q.id)).slice(0, ENTRY_PER_SECTION);
  const questionIds = [...aptIds, ...techIds];
  const attemptNumber = attempts.length + 1;

  const created = await prisma.programEntryAttempt.create({
    data: {
      userId,
      cohortId: cohort.id,
      attemptNumber,
      questionIds: questionIds as Prisma.InputJsonValue,
    },
    select: { id: true, startedAt: true },
  });

  const questions = await loadQuestionsForClient(questionIds);
  const deadline = new Date(
    created.startedAt.getTime() + ENTRY_DURATION_MIN * 60_000,
  );

  return {
    ok: true,
    attemptId: created.id,
    attemptNumber,
    deadlineIso: deadline.toISOString(),
    durationMin: ENTRY_DURATION_MIN,
    questions,
  };
}

/** Normalize + validate a join code for the apply gate (no side effects). */
export async function peekJoinCode(code: string) {
  const normalized = normalizeJoinCode(code);
  if (!normalized) {
    return { ok: false as const, message: "Enter a cohort join code." };
  }
  const cohort = await getCohortByJoinCode(normalized);
  if (!cohort) {
    return { ok: false as const, message: "Invalid cohort join code." };
  }
  if (cohort.status !== "ENROLLING") {
    return {
      ok: false as const,
      message: "Applications for this cohort are closed.",
    };
  }
  return {
    ok: true as const,
    joinCode: cohort.joinCode,
    cohortName: cohort.name,
  };
}

export async function submitEntryAttempt(
  userId: string,
  attemptId: string,
  answers: (number | null)[],
): Promise<EntrySubmitOk | { ok: false; message: string }> {
  try {
    return await writeClient().$transaction(async (tx) => {
      const attempt = await tx.programEntryAttempt.findFirst({
        where: { id: attemptId, userId },
        select: {
          id: true,
          cohortId: true,
          attemptNumber: true,
          questionIds: true,
          submittedAt: true,
        },
      });
      if (!attempt) {
        return { ok: false as const, message: "Assessment attempt not found." };
      }
      if (attempt.submittedAt) {
        return {
          ok: false as const,
          message: "This assessment has already been submitted.",
        };
      }

      const ids = (attempt.questionIds as string[]) ?? [];
      const questions = await tx.programEntryQuestion.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          section: true,
          question: true,
          options: true,
          correctIndex: true,
          explanation: true,
        },
      });
      const byId = new Map(questions.map((q) => [q.id, q]));

      let aptitudeScore = 0;
      let technicalScore = 0;
      const review: EntryReviewRow[] = [];

      ids.forEach((id, index) => {
        const q = byId.get(id);
        if (!q) return;
        const userAnswer = answers[index] ?? null;
        const isCorrect = userAnswer !== null && userAnswer === q.correctIndex;
        if (isCorrect) {
          if (q.section === "APTITUDE") aptitudeScore += 1;
          else technicalScore += 1;
        }
        review.push({
          questionId: q.id,
          section: q.section,
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
          userAnswer,
          isCorrect,
        });
      });

      const totalScore = aptitudeScore + technicalScore;
      const meetsScoreThreshold =
        totalScore >= ENTRY_PASS_TOTAL && technicalScore >= ENTRY_PASS_TECHNICAL;
      const passed = isProgramEntryBypassEnabled() || meetsScoreThreshold;

      await tx.programEntryAttempt.update({
        where: { id: attempt.id },
        data: {
          answers: answers as Prisma.InputJsonValue,
          aptitudeScore,
          technicalScore,
          passed,
          submittedAt: new Date(),
        },
      });

      let outcome: EntryOutcome;
      let retakeAtIso: string | null = null;

      if (passed) {
        outcome = await enrollOrWaitlist(tx, userId, attempt.cohortId);
      } else if (attempt.attemptNumber < ENTRY_MAX_ATTEMPTS) {
        outcome = "RETAKE";
        retakeAtIso = new Date(
          Date.now() + ENTRY_RETAKE_COOLDOWN_HOURS * 3600_000,
        ).toISOString();
      } else {
        outcome = "NOT_ELIGIBLE";
      }

      return {
        ok: true as const,
        passed,
        aptitudeScore,
        technicalScore,
        totalScore,
        outcome,
        retakeAtIso,
        review,
      };
    });
  } catch (e) {
    logger.error("[program] submitEntryAttempt failed", { error: String(e) });
    return { ok: false, message: "Something went wrong grading your assessment." };
  }
}
