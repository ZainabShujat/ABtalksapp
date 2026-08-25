"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/admin-auth";

type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

const addSeatSchema = z.object({
  email: z.string().trim().email().max(200),
  company: z.string().trim().min(1).max(200),
  contactName: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
});

const toggleSeatSchema = z.object({
  seatId: z.string().cuid(),
  active: z.boolean(),
});

export async function addRecruiterSeatAction(
  input: unknown,
): Promise<ActionResult<{ seatId: string }>> {
  const admin = await requireAdmin();

  const parsed = addSeatSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the email and company." };
  }
  // Lowercased at write time, because the login lookup matches exactly.
  const email = parsed.data.email.toLowerCase();

  try {
    const seat = await prisma.verifiedRecruiterSeat.upsert({
      where: { email },
      create: {
        email,
        company: parsed.data.company,
        contactName: parsed.data.contactName || null,
        notes: parsed.data.notes || null,
        verifiedByAdminId: admin.userId ?? null,
      },
      // Re-adding a revoked seat reinstates it rather than erroring.
      update: {
        company: parsed.data.company,
        contactName: parsed.data.contactName || null,
        notes: parsed.data.notes || null,
        active: true,
        revokedAt: null,
        verifiedByAdminId: admin.userId ?? null,
      },
      select: { id: true },
    });

    revalidatePath("/admin/recruiter-seats");
    revalidatePath("/admin/recruiters");
    return { ok: true, data: { seatId: seat.id } };
  } catch (error) {
    logger.error("[hire] addRecruiterSeatAction", { error: String(error) });
    return { ok: false, message: "Could not save the seat." };
  }
}

/**
 * Revoking a seat stops new recruiter registrations on that email and marks the
 * company inactive. It deliberately does NOT delete the row — who was verified,
 * and when, is a record worth keeping.
 *
 * It also revokes the existing RecruiterProfile, otherwise revoking the seat
 * would change nothing for someone already inside.
 */
export async function setRecruiterSeatActiveAction(
  input: unknown,
): Promise<ActionResult<{ seatId: string; active: boolean }>> {
  await requireAdmin();

  const parsed = toggleSeatSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid seat." };
  const { seatId, active } = parsed.data;

  try {
    const seat = await prisma.verifiedRecruiterSeat.update({
      where: { id: seatId },
      data: { active, revokedAt: active ? null : new Date() },
      select: { id: true, email: true, active: true },
    });

    const user = await prisma.user.findFirst({
      where: { email: seat.email },
      select: { id: true },
    });
    if (user) {
      await prisma.recruiterProfile.updateMany({
        where: { userId: user.id },
        data: { approved: active },
      });
    }

    revalidatePath("/admin/recruiter-seats");
    revalidatePath("/admin/recruiters");
    revalidatePath("/admin/program/recruiters");
    return { ok: true, data: { seatId: seat.id, active: seat.active } };
  } catch (error) {
    logger.error("[hire] setRecruiterSeatActiveAction", {
      error: String(error),
    });
    return { ok: false, message: "Could not update the seat." };
  }
}
