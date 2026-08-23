import { redirect } from "next/navigation";
import { Domain } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isClaudeEnabled } from "@/lib/feature-flags";
import { ClaudeOnboardingClient } from "@/components/claude/claude-onboarding-client";
import { studentProfile } from "@/repositories/legacy/student-profile";

export default async function ClaudeSignupPage() {
  if (!isClaudeEnabled()) {
    redirect("/");
  }

  const session = await auth();

  if (session?.user?.id) {
    const userExists = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true },
    });

    if (!userExists) {
      redirect(
        `/api/auth/signout?callbackUrl=${encodeURIComponent("/claude-signup")}`,
      );
    }

    const profile = await studentProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    if (profile) {
      const claudeEnrollment = await prisma.enrollment.findFirst({
        where: {
          userId: session.user.id,
          domain: Domain.CLAUDE,
        },
        select: { id: true },
      });

      if (claudeEnrollment) {
        redirect("/claude");
      }
      redirect("/dashboard");
    }

    redirect("/register?domain=CLAUDE");
  }

  return <ClaudeOnboardingClient />;
}
