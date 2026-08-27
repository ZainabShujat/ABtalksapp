import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getCandidateProfile } from "@/repositories/candidate";

export interface WorkshopPrefill {
  name: string | null;
  phone: string | null;
  /** College for students, company for professionals. */
  organization: string | null;
  graduationYear: number | null;
  role: "Student" | "Professional" | null;
  /** True when this account already has an ABTalks profile. */
  isExistingMember: boolean;
}

/**
 * Known details for an existing ABTalks member, so the workshop form is mostly
 * pre-filled instead of re-asking. Falls back to the last workshop registration
 * for workshop-only users, who have a User but no StudentProfile.
 *
 * Fails soft — a prefill failure must never block registration.
 */
export async function getWorkshopPrefill(
  userId: string,
): Promise<WorkshopPrefill> {
  const empty: WorkshopPrefill = {
    name: null,
    phone: null,
    organization: null,
    graduationYear: null,
    role: null,
    isExistingMember: false,
  };

  try {
    const profile = await getCandidateProfile(userId);

    if (profile) {
      const isStudent = profile.userType === "STUDENT";
      return {
        name: profile.fullName,
        phone: profile.phone,
        organization: isStudent ? profile.college : profile.organization,
        graduationYear: profile.graduationYear,
        role: isStudent ? "Student" : "Professional",
        isExistingMember: true,
      };
    }

    // No profile — reuse what they gave us at their last workshop so a weekly
    // attendee doesn't retype everything each time.
    const last = await prisma.workshopRegistration.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        name: true,
        phone: true,
        organization: true,
        graduationYear: true,
        role: true,
      },
    });

    if (!last) return empty;

    return {
      name: last.name,
      phone: last.phone,
      organization: last.organization,
      graduationYear: last.graduationYear,
      role: last.role === "Professional" ? "Professional" : "Student",
      isExistingMember: false,
    };
  } catch (err) {
    logger.error("Failed to load workshop prefill", {
      message: err instanceof Error ? err.message : String(err),
    });
    return empty;
  }
}
