import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getRecruiterState } from "@/features/talent-pool/recruiter-registration";
import { RecruiterAuthClosed } from "@/components/talent/recruiter-auth-closed";
import { RecruiterOnboardingWizard } from "@/components/recruiter-onboarding/recruiter-onboarding-wizard";
import { isEmailLoginEnabled, isRecruiterAuthEnabled } from "@/lib/feature-flags";

export const metadata: Metadata = {
  title: "Set up your recruiting workspace | Hire with ABTalks",
  description:
    "Create your ABTalks recruiter workspace in a few short steps: your details, your company and who you're hiring.",
};

/**
 * Public. The recruiter onboarding wizard — the same account rules as
 * /talent/register (it calls the same two actions), spread over short steps.
 *
 * Deliberately NOT under /hire: that layout wraps every page in HireChrome,
 * and the middleware's `/hire` prefix check would put anything named /hire-*
 * behind a session. Same guards as /recruiter-onboarding/signup.
 */
export default async function RecruiterOnboardingPage() {
  const session = await auth();
  if (session?.user?.id) {
    const state = await getRecruiterState(session.user.id);
    if (state.status === "active") redirect("/hire");
  }

  if (!isRecruiterAuthEnabled()) {
    return <RecruiterAuthClosed />;
  }

  return <RecruiterOnboardingWizard passwordEnabled={isEmailLoginEnabled()} />;
}
