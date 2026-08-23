"use server";

import { z } from "zod";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

const contactSchema = z.object({
  name: z.string().min(2),
  phone: z.string().regex(/^[+]?[\d\s()-]{7,18}$/),
  email: z.string().email(),
  message: z.string().min(10),
});

export type ContactResult =
  | { ok: true; data: { sent: true } }
  | { ok: false; message: string };

export async function submitContactMessage(
  input: unknown,
): Promise<ContactResult> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const { name, phone, email, message } = parsed.data;
  const subject = `Contact form: ${name}`;
  const text = `Name: ${name}\nPhone: ${phone}\nEmail: ${email}\n\n${message}`;
  const html = `<p><strong>Name:</strong> ${escapeHtml(name)}</p>
<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
<p><strong>Email:</strong> ${escapeHtml(email)}</p>
<p>${escapeHtml(message).replace(/\n/g, "<br />")}</p>`;

  try {
    const result = await sendEmail({
      to: "team@abtalks.in",
      subject,
      html,
      text,
    });
    if (result.ok) {
      return { ok: true, data: { sent: true } };
    }
    if (result.skipped) {
      return { ok: true, data: { sent: true } };
    }
    logger.error("submitContactMessage failed");
    return {
      ok: false,
      message: "Could not send your message. Try again.",
    };
  } catch (error) {
    logger.error("submitContactMessage threw", { error });
    return {
      ok: false,
      message: "Could not send your message. Try again.",
    };
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
