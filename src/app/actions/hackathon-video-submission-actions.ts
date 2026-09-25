"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  VIDEOTHON,
  getVideothonSubmissionWindow,
} from "@/features/hackathon-video/config";
import {
  videoSubmissionSchema,
  type VideoSubmissionInput,
} from "@/lib/validations/hackathon-video";

/**
 * Save (or update in place) the signed-in participant's VideoThon entry.
 * Rewrites the same row until the deadline — no edit history, by design.
 */
export async function saveVideoSubmissionAction(input: VideoSubmissionInput) {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, message: "Please sign in first." };
  }
  const userId = session.user.id;

  const parsed = videoSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const window = getVideothonSubmissionWindow();
  if (!window.unlocked) {
    return {
      ok: false as const,
      message: `Submissions open at kickoff — ${VIDEOTHON.kickoffLabel}.`,
    };
  }
  if (window.closed) {
    return {
      ok: false as const,
      message: `Submissions closed on ${VIDEOTHON.deadlineLabel}.`,
    };
  }

  const existing = await prisma.hackathonVideoRegistration.findUnique({
    where: { eventId_userId: { eventId: VIDEOTHON.eventId, userId } },
    select: { id: true },
  });
  if (!existing) {
    return {
      ok: false as const,
      message: "You're not registered for VideoThon yet.",
    };
  }

  try {
    await prisma.hackathonVideoRegistration.update({
      where: { id: existing.id },
      data: {
        submissionUrl: parsed.data.submissionUrl,
        submissionNotes: parsed.data.notes ?? null,
        submissionUpdatedAt: new Date(),
      },
      select: { id: true },
    });
  } catch (error) {
    logger.error("videothon submission save failed", { error, userId });
    return {
      ok: false as const,
      message: "Couldn't save your submission. Try again.",
    };
  }

  revalidatePath("/hackathon/dashboard");
  revalidatePath("/hackathon/submission");

  return { ok: true as const };
}
