import "server-only";
import { prisma } from "@/lib/db";
import { studentProfile } from "@/repositories/legacy/student-profile";

export type RecruiterState =
  | { status: "none" }
  | { status: "pending"; fullName: string; company: string }
  | { status: "approved"; fullName: string; company: string };

export async function getRecruiterState(userId: string): Promise<RecruiterState> {
  const profile = await prisma.recruiterProfile.findUnique({
    where: { userId },
    select: { fullName: true, company: true, approved: true },
  });
  if (!profile) return { status: "none" };
  if (!profile.approved) {
    return {
      status: "pending",
      fullName: profile.fullName,
      company: profile.company,
    };
  }
  return {
    status: "approved",
    fullName: profile.fullName,
    company: profile.company,
  };
}

export async function registerRecruiter(
  userId: string,
  input: { fullName: string; company: string; phone?: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const [user, existingStudent, existing] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    }),
    studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    }),
    prisma.recruiterProfile.findUnique({
      where: { userId },
      select: { id: true, approved: true },
    }),
  ]);

  if (!user) return { ok: false, message: "Account not found." };
  if (existingStudent) {
    return {
      ok: false,
      message:
        "Student challenge accounts cannot register as recruiters. Use a separate Google account.",
    };
  }
  if (user.role !== "STUDENT" && user.role !== "RECRUITER") {
    return { ok: false, message: "This account cannot register as a recruiter." };
  }
  if (existing) {
    return {
      ok: false,
      message: existing.approved
        ? "You already have recruiter access."
        : "Your recruiter application is already pending review.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.recruiterProfile.create({
      data: {
        userId,
        fullName: input.fullName,
        company: input.company,
        phone: input.phone || null,
        approved: false,
      },
    });
    await tx.user.update({
      where: { id: userId },
      data: { role: "RECRUITER" },
    });
  });

  return { ok: true };
}
