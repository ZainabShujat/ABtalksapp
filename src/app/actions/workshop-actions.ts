"use server";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import {
  fullDate,
  getRegistrableEvent,
} from "@/components/workshop/events-data";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendWorkshopConfirmationEmail } from "@/lib/workshop-email";
import { getWorkshopConfig } from "@/lib/workshop-supabase";
import { recordLegalConsents } from "@/features/legal/record-consent";
import { recordNewsletterOptIn } from "@/features/legal/record-newsletter-optin";

/**
 * `email` is deliberately absent: it comes from the session, never the client.
 * Phone is collected but NOT OTP-verified here — that friction belongs to the
 * 60-day registration flow, not a workshop lead form.
 */
const workshopRegistrationSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  role: z.enum(["Student", "Professional"]),
  organization: z.string().trim().min(1).nullish(),
  graduationYear: z.coerce.number().int().min(2020).max(2035).nullish(),
  acceptLegal: z.boolean().refine((v) => v === true, {
    message: "Please accept the Terms of Service and Privacy Policy",
  }),
  // Marketing opt-in — plain boolean, never blocks signup.
  newsletterOptIn: z.boolean(),
});

export type WorkshopRegistrationInput = z.infer<typeof workshopRegistrationSchema>;

type Result =
  | { ok: true; data: { whatsappLink: string } }
  | { ok: false; message: string };

const DUPLICATE_MESSAGE =
  "You've already registered. Please check your email for the webinar details.";
const CLOSED_MESSAGE = "Registration is closed right now. Check back soon!";

export async function submitWorkshopRegistrationAction(
  input: WorkshopRegistrationInput,
): Promise<Result> {
  // Google sign-in is mandatory. A first-time visitor becomes a User by signing
  // in, which is how workshop traffic accumulates in the main User table.
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email?.trim().toLowerCase();

  if (!userId || !email) {
    return { ok: false, message: "Please sign in to reserve your seat." };
  }

  const parsed = workshopRegistrationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Name, phone, and role are required.",
    };
  }
  const { name, phone, role, organization, graduationYear } = parsed.data;

  // Resolved server-side rather than trusted from the client, so a forged event
  // id can never file a signup under another workshop. Still the only source of
  // the eventId that gets written — the client sends none, and cannot.
  //
  // The argument is now an instant rather than an IST day key: registration
  // rolls to the next workshop the moment the current one ends, instead of at
  // IST midnight, and never falls to "closed" because a flag went unedited.
  const event = getRegistrableEvent();
  if (!event) {
    return { ok: false, message: CLOSED_MESSAGE };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.workshopRegistration.create({
        data: {
          eventId: event.id,
          userId,
          name,
          email,
          phone,
          role,
          organization: organization || null,
          graduationYear: role === "Student" ? (graduationYear ?? null) : null,
        },
        select: { id: true },
      });

      // Write-through: keep the member's profile current with what they just
      // told us. Only when a StudentProfile already exists — a workshop-only
      // attendee has no domain or referralCode, so one cannot be created here.
      const profile = await tx.studentProfile.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!profile) return;

      await tx.studentProfile.update({
        where: { userId },
        data: {
          fullName: name,
          // Phone is captured but never marked verified from this form.
          ...(phone ? { phone } : {}),
          ...(role === "Student"
            ? {
                ...(organization ? { college: organization } : {}),
                ...(graduationYear ? { graduationYear } : {}),
              }
            : {
                ...(organization ? { organization } : {}),
              }),
        },
      });
    });
  } catch (err) {
    // P2002 on @@unique([eventId, userId]) — already registered for this event.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { ok: false, message: DUPLICATE_MESSAGE };
    }
    logger.error("Workshop registration failed", {
      eventId: event.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, message: "Failed to save registration. Please try again." };
  }

  await recordLegalConsents({
    userId,
    email,
    source: "workshop",
  });

  await recordNewsletterOptIn({
    userId: userId,
    email: email,
    source: "workshop",
    optIn: parsed.data.newsletterOptIn === true,
  });

  // The row is saved at this point. A mail failure must never fail the request.
  const config = await getWorkshopConfig();
  try {
    await sendWorkshopConfirmationEmail(name, email, {
      ...config,
      webinarDate: fullDate(event.date),
      webinarTime: event.time,
    });
  } catch (emailErr) {
    logger.error("Workshop confirmation email failed", {
      eventId: event.id,
      email,
      message: emailErr instanceof Error ? emailErr.message : String(emailErr),
    });
  }

  return { ok: true, data: { whatsappLink: config.whatsappLink } };
}
