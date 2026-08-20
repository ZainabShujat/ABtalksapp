import "server-only";
import { prisma } from "@/lib/db";
import { askClaudeJson } from "@/lib/anthropic";
import { isCohortFrozen } from "@/features/program/progression";

const MAX_PAYLOAD_CHARS = 8000;

type MentorResponse = {
  strengths: string[];
  improvements: string[];
};

function truncatePayload(payload: unknown): string {
  const text =
    typeof payload === "string" ? payload : JSON.stringify(payload ?? {}, null, 2);
  return text.length > MAX_PAYLOAD_CHARS
    ? `${text.slice(0, MAX_PAYLOAD_CHARS)}\n…(truncated)`
    : text;
}

function formatMentorMarkdown(data: MentorResponse): string {
  const strengths = Array.isArray(data.strengths) ? data.strengths : [];
  const improvements = Array.isArray(data.improvements) ? data.improvements : [];
  const lines = ["### Strengths", ...strengths.map((s) => `- ${s}`), "", "### Improvements", ...improvements.map((s) => `- ${s}`)];
  return lines.join("\n");
}

export async function reviewMission(
  memberId: string,
  dayNumber: number,
): Promise<
  | { ok: true; feedback: string }
  | { ok: false; message: string }
> {
  const member = await prisma.programMember.findUnique({
    where: { id: memberId },
    select: {
      cohort: { select: { id: true, name: true, status: true, endsAt: true } },
    },
  });
  if (!member) return { ok: false, message: "Member not found." };
  if (await isCohortFrozen(member.cohort)) {
    return { ok: false, message: "This cohort has ended." };
  }

  const submission = await prisma.programMissionSubmission.findFirst({
    where: { memberId, dayNumber, passed: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      aiFeedback: true,
      payload: true,
      dayNumber: true,
    },
  });

  if (!submission) {
    return { ok: false, message: "Pass this mission before requesting a review." };
  }

  if (submission.aiFeedback) {
    return { ok: true, feedback: submission.aiFeedback };
  }

  const day = await prisma.programDay.findUnique({
    where: { dayNumber },
    select: {
      title: true,
      missionType: true,
      briefMd: true,
    },
  });
  if (!day) return { ok: false, message: "Day not found." };

  const briefSummary = day.briefMd.slice(0, 2000);
  const payloadText = truncatePayload(submission.payload);

  const ai = await askClaudeJson<MentorResponse>({
    system:
      'You are an AI mentor for a B2B engineering program. Reply JSON only: {"strengths":["..."],"improvements":["..."]}. Give 2-3 concrete items in each list.',
    user: [
      `Day ${dayNumber}: ${day.title} (${day.missionType})`,
      `Brief:\n${briefSummary}`,
      `Passing submission:\n${payloadText}`,
    ].join("\n\n"),
    maxTokens: 1024,
  });

  if (!ai.ok) return { ok: false, message: ai.message };

  const feedback = formatMentorMarkdown(ai.data);

  await prisma.programMissionSubmission.update({
    where: { id: submission.id },
    data: { aiFeedback: feedback },
  });

  return { ok: true, feedback };
}

export async function getMissionMentorFeedback(
  memberId: string,
  dayNumber: number,
): Promise<string | null> {
  const submission = await prisma.programMissionSubmission.findFirst({
    where: { memberId, dayNumber, passed: true },
    select: { aiFeedback: true },
    orderBy: { createdAt: "desc" },
  });
  return submission?.aiFeedback ?? null;
}
