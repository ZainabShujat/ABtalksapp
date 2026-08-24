import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { askClaudeJson } from "@/lib/anthropic";
import { logger } from "@/lib/logger";
import { PROGRAM_TOTAL_DAYS } from "@/features/program/constants";
import { programMember } from "@/repositories/legacy/program-member";
import {
  collectPassSkipSets,
  getMemberDayStates,
  getMemberProgressDay,
} from "@/features/program/progression";

export const INTERVIEW_DURATION_SEC = 900;
export const INTERVIEW_MIN_DURATION_SEC = 180;
export const INTERVIEW_MAX_SUBMIT_DURATION_SEC = 1200;
const IN_PROGRESS_STALE_MS = 30 * 60 * 1000;
const MAX_RESETS = 2;

export type InterviewTranscriptLine = {
  role: "ai" | "candidate";
  text: string;
  ts: number;
};

type EvaluateResponse = {
  commScore: number;
  techScore: number;
  problemScore: number;
  overallScore: number;
  summary: string;
};

type MemberContext = {
  fullName: string;
  jobRole: string | null;
  company: string | null;
  yearsExperience: number | null;
  missionPoints: number;
  conceptPoints: number;
  commitPoints: number;
  projectPoints: number;
  aiRecommendation: string | null;
  moduleScores: { moduleNumber: number; title: string; passed: number; total: number }[];
  projectTitles: { moduleNumber: number; title: string; score: number | null }[];
};

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, Math.round(score)));
}

async function ensureInterviewRecord(memberId: string) {
  return prisma.programInterview.upsert({
    where: { memberId },
    create: { memberId },
    update: {},
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      durationSec: true,
      transcript: true,
      commScore: true,
      techScore: true,
      problemScore: true,
      overallScore: true,
      summary: true,
      evaluatedAt: true,
      resetCount: true,
    },
  });
}

async function loadMemberContext(memberId: string): Promise<MemberContext | null> {
  const [member, projects, { modules, days }] = await Promise.all([
    programMember.findUnique({
      where: { id: memberId },
      select: {
        fullName: true,
        jobRole: true,
        company: true,
        yearsExperience: true,
        missionPoints: true,
        conceptPoints: true,
        commitPoints: true,
        projectPoints: true,
        aiRecommendation: true,
      },
    }),
    prisma.programProject.findMany({
      where: { memberId },
      select: {
        moduleNumber: true,
        writeup: true,
        aiScore: true,
        adminScore: true,
      },
      orderBy: { moduleNumber: "asc" },
    }),
    getMemberDayStates(memberId),
  ]);

  if (!member) return null;

  const moduleScores = modules.map((mod) => {
    const modDays = days.filter((d) => d.moduleNumber === mod.number);
    const passed = modDays.filter((d) => d.state === "PASSED").length;
    return {
      moduleNumber: mod.number,
      title: mod.title,
      passed,
      total: modDays.length,
    };
  });

  const projectTitles = projects.map((p) => {
    const firstLine = p.writeup.split("\n")[0]?.trim() || `Module ${p.moduleNumber} project`;
    return {
      moduleNumber: p.moduleNumber,
      title: firstLine.slice(0, 120),
      score: p.adminScore ?? p.aiScore,
    };
  });

  return { ...member, moduleScores, projectTitles };
}

export function buildInterviewInstructions(member: MemberContext): string {
  const moduleLines = member.moduleScores
    .map((m) => `Module ${m.moduleNumber} (${m.title}): ${m.passed}/${m.total} missions passed`)
    .join("\n");
  const projectLines =
    member.projectTitles.length > 0
      ? member.projectTitles
          .map(
            (p) =>
              `Module ${p.moduleNumber}: ${p.title}${p.score !== null ? ` (score ${p.score}/100)` : ""}`,
          )
          .join("\n")
      : "No Boss Build projects submitted yet.";

  return [
    "You are a senior technical interviewer for an enterprise AI mastery program.",
    "Conduct a structured 15-minute voice interview. Be courteous and professional.",
    "",
    "Candidate context:",
    `- Name: ${member.fullName}`,
    `- Role: ${member.jobRole ?? "—"} at ${member.company ?? "—"}`,
    `- Experience: ${member.yearsExperience ?? "—"} years`,
    `- Score components: missions ${member.missionPoints}, concepts ${member.conceptPoints}, commits ${member.commitPoints}, projects ${member.projectPoints}`,
    moduleLines,
    "Projects:",
    projectLines,
    member.aiRecommendation ? `Prior AI mentor note: ${member.aiRecommendation}` : "",
    "",
    "Structure (15 minutes total):",
    "1. ~2 min — warm intro and background",
    "2. ~5 min — AI/data fundamentals from Modules 1–2",
    "3. ~5 min — agents/LLM ops from Modules 3–4",
    "4. ~3 min — one practical scenario question",
    "",
    "Style rules:",
    "- Ask ONE question at a time.",
    "- Follow up at most once per topic before moving on.",
    "- Never reveal scores or grading criteria.",
    "- At 15 minutes, give a brief closing line and end politely.",
    "- Never discuss anything outside this interview; if asked, redirect back.",
    "- Keep responses concise — this is a voice conversation.",
  ]
    .filter(Boolean)
    .join("\n");
}

export type InterviewEligibility =
  | { state: "locked"; reason: string }
  | { state: "ready"; resetsRemaining: number }
  | { state: "in_progress"; startedAt: string; resetsRemaining: number }
  | { state: "completed" }
  | { state: "exhausted"; message: string };

export async function getInterviewEligibility(
  memberId: string,
): Promise<InterviewEligibility> {
  const member = await programMember.findUnique({
    where: { id: memberId },
    select: {
      cohort: { select: { endsAt: true } },
    },
  });
  if (!member) return { state: "locked", reason: "Member not found." };

  const submissions = await prisma.programMissionSubmission.findMany({
    where: { memberId },
    select: { dayNumber: true, passed: true, payload: true },
  });
  const { passedDays } = collectPassSkipSets(submissions);
  const progressDay = getMemberProgressDay(passedDays);
  const programComplete = progressDay >= PROGRAM_TOTAL_DAYS;
  const cohortEnded = new Date() > member.cohort.endsAt;

  if (!programComplete && !cohortEnded) {
    return {
      state: "locked",
      reason: `Reach Day ${PROGRAM_TOTAL_DAYS} to unlock your exit interview.`,
    };
  }

  const interview = await ensureInterviewRecord(memberId);
  const resetsRemaining = Math.max(0, MAX_RESETS - interview.resetCount);

  if (interview.status === "COMPLETED") {
    return { state: "completed" };
  }

  if (interview.resetCount >= MAX_RESETS && interview.status === "FAILED") {
    return {
      state: "exhausted",
      message: "You have used all available interview attempts. Contact your program admin.",
    };
  }

  if (interview.status === "IN_PROGRESS" && interview.startedAt) {
    const ageMs = Date.now() - interview.startedAt.getTime();
    if (ageMs < IN_PROGRESS_STALE_MS) {
      return {
        state: "in_progress",
        startedAt: interview.startedAt.toISOString(),
        resetsRemaining,
      };
    }
  }

  if (interview.status === "FAILED" && interview.resetCount >= MAX_RESETS) {
    return {
      state: "exhausted",
      message: "You have used all available interview attempts. Contact your program admin.",
    };
  }

  return { state: "ready", resetsRemaining };
}

export type InterviewMemberView = {
  eligibility: InterviewEligibility;
  interview: {
    status: string;
    durationSec: number | null;
    commScore: number | null;
    techScore: number | null;
    problemScore: number | null;
    overallScore: number | null;
    summary: string | null;
    evaluatedAt: string | null;
    transcript: InterviewTranscriptLine[];
  };
};

export async function getInterviewMemberView(
  memberId: string,
): Promise<InterviewMemberView> {
  const [eligibility, interview] = await Promise.all([
    getInterviewEligibility(memberId),
    ensureInterviewRecord(memberId),
  ]);

  const transcript = Array.isArray(interview.transcript)
    ? (interview.transcript as InterviewTranscriptLine[])
    : [];

  return {
    eligibility,
    interview: {
      status: interview.status,
      durationSec: interview.durationSec,
      commScore: interview.commScore,
      techScore: interview.techScore,
      problemScore: interview.problemScore,
      overallScore: interview.overallScore,
      summary: interview.summary,
      evaluatedAt: interview.evaluatedAt?.toISOString() ?? null,
      transcript,
    },
  };
}

export type InterviewDashboardCard =
  | { state: "locked"; label: string }
  | { state: "ready"; label: string }
  | { state: "in_progress"; label: string }
  | { state: "completed"; overallScore: number | null; label: string }
  | { state: "exhausted"; label: string };

export async function getInterviewDashboardCard(
  memberId: string,
): Promise<InterviewDashboardCard> {
  const view = await getInterviewMemberView(memberId);
  switch (view.eligibility.state) {
    case "locked":
      return { state: "locked", label: "Locked until program end" };
    case "ready":
      return { state: "ready", label: "Ready — schedule your 15-min voice interview" };
    case "in_progress":
      return { state: "in_progress", label: "Interview in progress" };
    case "exhausted":
      return { state: "exhausted", label: "No attempts remaining" };
    case "completed":
      return {
        state: "completed",
        overallScore: view.interview.overallScore,
        label: view.interview.overallScore !== null
          ? `Completed — ${view.interview.overallScore}/100 overall`
          : "Completed — evaluation pending",
      };
  }
}

export async function prepareInterviewStart(
  memberId: string,
): Promise<
  | { ok: true; instructions: string; safetyIdentifier: string }
  | { ok: false; message: string }
> {
  const eligibility = await getInterviewEligibility(memberId);
  if (
    eligibility.state !== "ready" &&
    eligibility.state !== "in_progress"
  ) {
    return { ok: false, message: "You are not eligible to start the interview." };
  }

  const interview = await ensureInterviewRecord(memberId);

  if (interview.status === "IN_PROGRESS") {
    const ageMs = interview.startedAt
      ? Date.now() - interview.startedAt.getTime()
      : IN_PROGRESS_STALE_MS;
    const stale = ageMs >= IN_PROGRESS_STALE_MS;
    const nextResetCount = stale
      ? interview.resetCount
      : interview.resetCount + 1;

    if (!stale && nextResetCount > MAX_RESETS) {
      return { ok: false, message: "No interview attempts remaining." };
    }

    await prisma.programInterview.update({
      where: { memberId },
      data: {
        status: "FAILED",
        startedAt: null,
        resetCount: stale ? undefined : { increment: 1 },
      },
    });
  }

  const member = await loadMemberContext(memberId);
  if (!member) return { ok: false, message: "Member not found." };

  const instructions = buildInterviewInstructions(member);
  const safetyIdentifier = createHash("sha256")
    .update(memberId)
    .digest("hex")
    .slice(0, 64);

  await prisma.programInterview.update({
    where: { memberId },
    data: {
      status: "IN_PROGRESS",
      startedAt: new Date(),
      endedAt: null,
      durationSec: null,
      transcript: Prisma.JsonNull,
      commScore: null,
      techScore: null,
      problemScore: null,
      overallScore: null,
      summary: null,
      evaluatedAt: null,
    },
  });

  return { ok: true, instructions, safetyIdentifier };
}

export async function completeInterview(
  memberId: string,
  transcript: InterviewTranscriptLine[],
  durationSec: number,
): Promise<{ ok: true; interviewId: string } | { ok: false; message: string }> {
  if (durationSec < INTERVIEW_MIN_DURATION_SEC) {
    return {
      ok: false,
      message: "Interview must be at least 3 minutes to submit.",
    };
  }

  const interview = await prisma.programInterview.findUnique({
    where: { memberId },
    select: { id: true, status: true },
  });

  if (!interview || interview.status !== "IN_PROGRESS") {
    return { ok: false, message: "No interview in progress." };
  }

  await prisma.programInterview.update({
    where: { id: interview.id },
    data: {
      status: "COMPLETED",
      endedAt: new Date(),
      durationSec,
      transcript: transcript as unknown as Prisma.InputJsonValue,
    },
  });

  return { ok: true, interviewId: interview.id };
}

export async function evaluateInterview(
  interviewId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const interview = await prisma.programInterview.findUnique({
    where: { id: interviewId },
    select: {
      id: true,
      status: true,
      transcript: true,
      durationSec: true,
      memberId: true,
      member: {
        select: {
          fullName: true,
          jobRole: true,
          company: true,
          yearsExperience: true,
        },
      },
    },
  });

  if (!interview || interview.status !== "COMPLETED") {
    return { ok: false, message: "Interview not found or not completed." };
  }

  const lines = Array.isArray(interview.transcript)
    ? (interview.transcript as InterviewTranscriptLine[])
    : [];

  const transcriptText = lines
    .map((l) => `${l.role === "ai" ? "Interviewer" : "Candidate"}: ${l.text}`)
    .join("\n");

  const ai = await askClaudeJson<EvaluateResponse>({
    system:
      'You evaluate B2B program exit voice interviews. Reply JSON only: {"commScore":0-100,"techScore":0-100,"problemScore":0-100,"overallScore":0-100,"summary":"2-3 recruiter-readable sentences"}. Score communication clarity, technical depth, and structured problem-solving separately; overall is holistic.',
    user: [
      `Candidate: ${interview.member.fullName}, ${interview.member.jobRole ?? "—"} at ${interview.member.company ?? "—"}, ${interview.member.yearsExperience ?? "—"} yrs exp.`,
      `Duration: ${interview.durationSec ?? "?"} seconds`,
      `Transcript:\n${transcriptText || "(empty transcript)"}`,
    ].join("\n\n"),
    maxTokens: 1024,
  });

  if (!ai.ok) {
    logger.error("[interview] evaluation failed", { interviewId, message: ai.message });
    return { ok: false, message: ai.message };
  }

  const commScore = clampScore(Number(ai.data.commScore));
  const techScore = clampScore(Number(ai.data.techScore));
  const problemScore = clampScore(Number(ai.data.problemScore));
  const overallScore = clampScore(Number(ai.data.overallScore));
  const summary =
    typeof ai.data.summary === "string" ? ai.data.summary.trim() : "";

  if (
    !Number.isFinite(commScore) ||
    !Number.isFinite(techScore) ||
    !Number.isFinite(problemScore) ||
    !Number.isFinite(overallScore)
  ) {
    return { ok: false, message: "AI returned invalid scores." };
  }

  await prisma.programInterview.update({
    where: { id: interviewId },
    data: {
      commScore,
      techScore,
      problemScore,
      overallScore,
      summary: summary || null,
      evaluatedAt: new Date(),
    },
  });

  return { ok: true };
}

export async function adminResetInterview(
  adminId: string,
  memberId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const member = await programMember.findUnique({
    where: { id: memberId },
    select: { userId: true },
  });
  if (!member) return { ok: false, message: "Member not found." };

  await prisma.$transaction(async (tx) => {
    await tx.programInterview.upsert({
      where: { memberId },
      create: { memberId },
      update: {
        status: "NOT_STARTED",
        startedAt: null,
        endedAt: null,
        durationSec: null,
        transcript: Prisma.JsonNull,
        commScore: null,
        techScore: null,
        problemScore: null,
        overallScore: null,
        summary: null,
        evaluatedAt: null,
        resetCount: 0,
      },
    });

    await tx.adminAction.create({
      data: {
        adminUserId: adminId,
        targetUserId: member.userId,
        actionType: "PROGRAM_RESET_INTERVIEW",
        reason,
        metadata: { memberId },
      },
    });
  });

  return { ok: true };
}

export async function listInterviewsForAdmin(cohortId: string) {
  const members = await programMember.findMany({
    where: {
      cohortId,
      status: { in: ["ENROLLED", "COMPLETED"] },
    },
    select: {
      id: true,
      fullName: true,
      company: true,
      interview: {
        select: {
          id: true,
          status: true,
          startedAt: true,
          endedAt: true,
          durationSec: true,
          commScore: true,
          techScore: true,
          problemScore: true,
          overallScore: true,
          summary: true,
          evaluatedAt: true,
          transcript: true,
          resetCount: true,
        },
      },
    },
    orderBy: { fullName: "asc" },
  });

  return members.map((m) => {
    const i = m.interview;
    const transcript =
      i && Array.isArray(i.transcript)
        ? (i.transcript as InterviewTranscriptLine[])
        : [];
    return {
      interviewId: i?.id ?? null,
      memberId: m.id,
      memberName: m.fullName,
      company: m.company,
      status: i?.status ?? "NOT_STARTED",
      durationSec: i?.durationSec ?? null,
      commScore: i?.commScore ?? null,
      techScore: i?.techScore ?? null,
      problemScore: i?.problemScore ?? null,
      overallScore: i?.overallScore ?? null,
      summary: i?.summary ?? null,
      evaluatedAt: i?.evaluatedAt?.toISOString() ?? null,
      resetCount: i?.resetCount ?? 0,
      transcript,
    };
  });
}
