"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const categoryEnum = z.enum([
  "GENERAL",
  "WORKSHOP",
  "HACKATHON",
  "COHORT",
  "CHALLENGE",
]);
const audienceEnum = z.enum(["ALL", "CHALLENGE", "PROGRAM", "HACKATHON"]);

const hrefSchema = z
  .string()
  .trim()
  .max(300)
  .refine(
    (v) => v.startsWith("/") || v.startsWith("https://"),
    "Link must start with / or https://",
  );

const createInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
  body: z.string().trim().max(500).optional(),
  href: hrefSchema.optional(),
  category: categoryEnum,
  audience: audienceEnum,
  /** ISO datetime from the form's datetime-local field. */
  expiresAt: z.string().trim().min(1).optional(),
});

const idInput = z.object({ id: z.string().min(1) });

export async function createNotificationAction(input: {
  title: string;
  body?: string;
  href?: string;
  category: z.infer<typeof categoryEnum>;
  audience: z.infer<typeof audienceEnum>;
  expiresAt?: string;
}): Promise<Result<null>> {
  const admin = await requireAdmin();
  if (!admin.userId) return { ok: false, message: "Missing admin session" };

  const parsed = createInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const { title, body, href, category, audience, expiresAt } = parsed.data;

  let expiry: Date | null = null;
  if (expiresAt) {
    const parsedDate = new Date(expiresAt);
    if (Number.isNaN(parsedDate.getTime())) {
      return { ok: false, message: "Invalid expiry date" };
    }
    expiry = parsedDate;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.notification.create({
        data: {
          title,
          body: body || null,
          href: href || null,
          category,
          audience,
          expiresAt: expiry,
          createdByAdminId: admin.userId,
        },
        select: { id: true },
      });

      await tx.adminAction.create({
        data: {
          adminUserId: admin.userId!,
          // AdminAction.targetUserId is required and FK-constrained; a broadcast
          // has no target student, so the acting admin stands in as the target.
          targetUserId: admin.userId!,
          actionType: "createNotification",
          metadata: { notificationId: created.id, title, audience, category },
        },
        select: { id: true },
      });
    });
  } catch (error) {
    logger.error("[admin] failed to create notification", { error });
    return { ok: false, message: "Could not create announcement" };
  }

  revalidatePath("/admin/notifications");
  return { ok: true, data: null };
}

export async function deactivateNotificationAction(input: {
  id: string;
}): Promise<Result<null>> {
  const admin = await requireAdmin();
  if (!admin.userId) return { ok: false, message: "Missing admin session" };

  const parsed = idInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const existing = await prisma.notification.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, title: true, isActive: true },
  });
  if (!existing) return { ok: false, message: "Announcement not found" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.notification.update({
        where: { id: existing.id },
        data: { isActive: false },
        select: { id: true },
      });

      await tx.adminAction.create({
        data: {
          adminUserId: admin.userId!,
          targetUserId: admin.userId!,
          actionType: "deactivateNotification",
          metadata: { notificationId: existing.id, title: existing.title },
        },
        select: { id: true },
      });
    });
  } catch (error) {
    logger.error("[admin] failed to deactivate notification", { error });
    return { ok: false, message: "Could not deactivate announcement" };
  }

  revalidatePath("/admin/notifications");
  return { ok: true, data: null };
}

export async function deleteNotificationAction(input: {
  id: string;
}): Promise<Result<null>> {
  const admin = await requireAdmin();
  if (!admin.userId) return { ok: false, message: "Missing admin session" };

  const parsed = idInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const existing = await prisma.notification.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, title: true },
  });
  if (!existing) return { ok: false, message: "Announcement not found" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.notification.delete({
        where: { id: existing.id },
        select: { id: true },
      });

      await tx.adminAction.create({
        data: {
          adminUserId: admin.userId!,
          targetUserId: admin.userId!,
          actionType: "deleteNotification",
          metadata: { notificationId: existing.id, title: existing.title },
        },
        select: { id: true },
      });
    });
  } catch (error) {
    logger.error("[admin] failed to delete notification", { error });
    return { ok: false, message: "Could not delete announcement" };
  }

  // Read rows keyed `admin:<id>` are intentionally left behind: they are
  // harmless and cuid ids are never reused.
  revalidatePath("/admin/notifications");
  return { ok: true, data: null };
}
