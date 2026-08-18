"use server";

import { auth } from "@/auth";
import { updateProfile } from "@/features/profile/update-profile";
import type { UpdateProfileResult } from "@/features/profile/update-profile";
import { prisma } from "@/lib/db";
import { UserType } from "@prisma/client";

function parseSkillsJson(raw: string | null): unknown {
  if (!raw || raw.trim() === "") return [];
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function updateProfileAction(
  formData: FormData,
): Promise<UpdateProfileResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "You must be signed in." };
  }

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: session.user.id },
    select: { userType: true },
  });

  if (!profile) {
    return { ok: false, message: "Profile not found" };
  }

  const skillsParsed = parseSkillsJson(
    typeof formData.get("skills") === "string"
      ? (formData.get("skills") as string)
      : null,
  );
  if (skillsParsed === null) {
    return { ok: false, message: "Invalid skills data" };
  }

  return updateProfile(session.user.id, {
    userType: profile.userType,
    fullName: String(formData.get("fullName") ?? ""),
    college:
      profile.userType === UserType.STUDENT
        ? String(formData.get("college") ?? "")
        : undefined,
    collegeId:
      profile.userType === UserType.STUDENT
        ? String(formData.get("collegeId") ?? "")
        : undefined,
    graduationYear:
      profile.userType === UserType.STUDENT
        ? formData.get("graduationYear")
        : undefined,
    organization:
      profile.userType === UserType.PROFESSIONAL
        ? String(formData.get("organization") ?? "")
        : undefined,
    role:
      profile.userType === UserType.PROFESSIONAL
        ? String(formData.get("role") ?? "")
        : undefined,
    yearsExperience:
      profile.userType === UserType.PROFESSIONAL
        ? formData.get("yearsExperience")
        : undefined,
    skills: Array.isArray(skillsParsed) ? (skillsParsed as string[]) : [],
    linkedinUrl: String(formData.get("linkedinUrl") ?? ""),
    resumeUrl: String(formData.get("resumeUrl") ?? ""),
    githubUsername: String(formData.get("githubUsername") ?? ""),
    phone: String(formData.get("phone") ?? ""),
  });
}
