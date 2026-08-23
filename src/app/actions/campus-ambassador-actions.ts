"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { studentProfile } from "@/repositories/legacy/student-profile";

export async function applyCampusAmbassador() {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Not authenticated" };
  }

  try {
    await studentProfile.update({
      where: { userId: session.user.id },
      data: {
        isCampusAmbassadorCandidate: true,
        ambassadorAppliedAt: new Date(),
      },
    });

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    console.error("[applyCampusAmbassador] error:", error);
    return { ok: false, message: "Failed to apply. Try again." };
  }
}

export async function dismissCampusAmbassador() {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Not authenticated" };
  }

  try {
    await studentProfile.update({
      where: { userId: session.user.id },
      data: {
        ambassadorDismissedAt: new Date(),
      },
    });

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    console.error("[dismissCampusAmbassador] error:", error);
    return { ok: false, message: "Failed to dismiss." };
  }
}
