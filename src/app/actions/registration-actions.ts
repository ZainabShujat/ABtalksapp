"use server";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after } from "next/server";
import { auth } from "@/auth";
import { UserType } from "@prisma/client";
import { claudeWelcomeEmail } from "@/features/email/claude-welcome-email";
import { completeRegistration } from "@/features/registration/complete-registration";
import { sendEmail } from "@/lib/email";
import { isClaudeEnabled } from "@/lib/feature-flags";
import { registerPayloadSchema } from "@/lib/validations/register";

export async function completeRegistrationAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, message: "Not authenticated" };
  }

  const rawSkills = formData.get("skills") as string;
  const skills = rawSkills
    ? rawSkills.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const refRaw = formData.get("referralCode");
  const referralCode =
    typeof refRaw === "string"
      ? refRaw.trim().toUpperCase().slice(0, 6)
      : "";

  const yearRaw = formData.get("graduationYear");
  const graduationYear =
    typeof yearRaw === "string" && yearRaw.trim() !== ""
      ? Number.parseInt(yearRaw, 10)
      : Number(yearRaw);

  const userTypeRaw = formData.get("userType");
  const userType =
    typeof userTypeRaw === "string" &&
    userTypeRaw.trim().toUpperCase() === UserType.PROFESSIONAL
      ? UserType.PROFESSIONAL
      : UserType.STUDENT;

  const yearsExpRaw = formData.get("yearsExperience");
  const yearsExperience =
    typeof yearsExpRaw === "string" && yearsExpRaw.trim() !== ""
      ? Number.parseInt(yearsExpRaw, 10)
      : Number(yearsExpRaw);

  const fullNameRaw = formData.get("fullName");
  const fullName =
    typeof fullNameRaw === "string" ? fullNameRaw.trim() : fullNameRaw;

  const collegeRaw = formData.get("college");
  const college =
    typeof collegeRaw === "string" ? collegeRaw.trim() : collegeRaw;

  const collegeIdRaw = formData.get("collegeId");
  const collegeId =
    typeof collegeIdRaw === "string" ? collegeIdRaw.trim() : collegeIdRaw;

  const organizationRaw = formData.get("organization");
  const organization =
    typeof organizationRaw === "string"
      ? organizationRaw.trim()
      : organizationRaw;

  const roleRaw = formData.get("role");
  const role = typeof roleRaw === "string" ? roleRaw.trim() : roleRaw;

  const countryCodeRaw = formData.get("countryCode");
  const countryCode =
    typeof countryCodeRaw === "string" && countryCodeRaw.trim() !== ""
      ? countryCodeRaw.trim()
      : "+91";

  const phoneNumberRaw = formData.get("phoneNumber");
  const phoneNumber =
    typeof phoneNumberRaw === "string" ? phoneNumberRaw.trim() : "";

  const parsed = registerPayloadSchema.safeParse({
    fullName,
    college,
    collegeId,
    graduationYear: Number.isFinite(graduationYear) ? graduationYear : undefined,
    userType,
    organization,
    role,
    yearsExperience: Number.isFinite(yearsExperience) ? yearsExperience : undefined,
    domain: formData.get("domain"),
    skills,
    linkedinUrl: formData.get("linkedinUrl") || "",
    countryCode,
    phoneNumber,
    githubUsername: formData.get("githubUsername") || "",
    referralCode,
    acceptLegal: formData.get("acceptLegal") === "true",
    newsletterOptIn: formData.get("newsletterOptIn") === "true",
  });

  if (!parsed.success) {
    return {
      ok: false as const,
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  if (parsed.data.domain === "CLAUDE" && !isClaudeEnabled()) {
    return { ok: false as const, message: "That track is not open." };
  }

  const result = await completeRegistration(session.user.id, parsed.data, {
    email: session.user.email,
  });
  if (!result.ok) {
    return { ok: false as const, message: result.message };
  }

  if (session.user.email && parsed.data.domain === "CLAUDE") {
    const to = session.user.email;
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "https://abtalks.in";
    after(async () => {
      const { subject, html, text } = claudeWelcomeEmail({
        fullName: parsed.data.fullName,
        appUrl,
      });
      const pdf = readFileSync(
        join(
          process.cwd(),
          "public/documents/ABTalks-60-Day-Challenge-Guidelines.pdf",
        ),
      );
      await sendEmail({
        to,
        subject,
        html,
        text,
        attachments: [
          {
            filename: "ABTalks-60-Day-Challenge-Guidelines.pdf",
            content: pdf,
          },
        ],
      });
    });
  }

  return { ok: true as const };
}
