"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { getNotificationsForUser } from "@/features/notification/get-notifications";
import { EMPTY_FEED, type NotificationFeed } from "@/features/notification/types";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const markReadInput = z.array(z.string().min(1).max(200)).max(50);

/**
 * PUBLIC on purpose: AppHeader renders on /students/[id], which is not behind
 * middleware, so a signed-out caller must get an empty feed rather than a
 * redirect or a thrown error. Do NOT add requireAdmin/requireRole here.
 */
export async function getMyNotificationsAction(): Promise<
  Result<NotificationFeed>
> {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return { ok: true, data: EMPTY_FEED };
    }

    const feed = await getNotificationsForUser(userId);
    return { ok: true, data: feed };
  } catch (error) {
    logger.error("[notifications] failed to load feed", { error });
    return { ok: false, message: "Could not load notifications" };
  }
}

/**
 * Marks the given keys read for the current user — they stop counting toward the
 * badge but stay in the list. Keys are opaque strings so this covers admin rows
 * and derived event notifications alike.
 */
export async function markNotificationsReadAction(
  keys: string[],
): Promise<Result<null>> {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return { ok: false, message: "Not signed in" };
    }

    const parsed = markReadInput.safeParse(keys);
    if (!parsed.success) {
      return {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }

    if (parsed.data.length === 0) {
      return { ok: true, data: null };
    }

    await prisma.notificationRead.createMany({
      data: parsed.data.map((notificationKey) => ({ userId, notificationKey })),
      skipDuplicates: true,
    });

    return { ok: true, data: null };
  } catch (error) {
    logger.error("[notifications] failed to mark read", { error });
    return { ok: false, message: "Could not update notifications" };
  }
}
