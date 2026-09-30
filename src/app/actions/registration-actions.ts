"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { completeRegistration } from "@/features/registration/complete-registration";
import { applyStoredResumeToProfile } from "@/features/resume/service";
import { logger } from "@/lib/logger";
import { registerPayloadSchema } from "@/lib/validations/register";

/** Trimmed string from FormData, or "" for anything else. */
function text(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

export async function completeRegistrationAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, message: "Not authenticated" };
  }

  const referralCode = text(formData, "referralCode").toUpperCase().slice(0, 6);

  const phoneCountryCodeRaw = text(formData, "phoneCountryCode");
  const phoneCountryCode = phoneCountryCodeRaw !== "" ? phoneCountryCodeRaw : "+91";

  const parsed = registerPayloadSchema.safeParse({
    fullName: text(formData, "fullName"),
    // No default: a missing or unknown value fails validation, so the candidate
    // has to choose student or working professional.
    userType: text(formData, "userType").toUpperCase(),
    phoneCountryCode,
    phoneNumber: text(formData, "phoneNumber"),
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

  const result = await completeRegistration(session.user.id, parsed.data, {
    email: session.user.email,
  });
  if (!result.ok) {
    return { ok: false as const, message: result.message };
  }

  /*
   * Résumé upload is optional. When a READY CandidateResume exists (uploaded
   * before submit), merge fills education, experience, projects, certifications,
   * skills and LinkedIn / GitHub / portfolio links. applyStoredResumeToProfile
   * no-ops when there is no READY row.
   *
   * Never fatal. The registration is already committed; a candidate whose
   * enrichment failed (or who skipped upload) is registered with a thinner
   * profile, not turned away.
   */
  try {
    await applyStoredResumeToProfile(session.user.id);
  } catch (error) {
    logger.error("[registration] resume merge after register failed", {
      userId: session.user.id,
      error: String(error),
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/profile");
  return { ok: true as const };
}
