import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getRecruiterState } from "@/features/talent-pool/recruiter-registration";
import { RecruiterAuthClosed } from "@/components/talent/recruiter-auth-closed";
import { RecruiterOnboardingWizard } from "@/components/recruiter-onboarding/recruiter-onboarding-wizard";
import { isEmailLoginEnabled, isRecruiterAuthEnabled } from "@/lib/feature-flags";

export const metadata: Metadata = {
  title: "Create a recruiter account | ABTalks",
  description:
    "Find top talent, manage your hiring pipeline, and connect with the right candidates, all from one recruiter dashboard.",
};

/**
 * Public. The onboarding wizard, opened at its first question rather than the
 * welcome — for links that promise "create an account".
 *
 * Same account rules as /talent/register — it calls the same two actions.
 * Recruiters are passwordless: the email is verified by a 6-digit code, and
 * the wizard signs them in with a second code before /hire.
 */
export default async function RecruiterSignupPage() {
  const session = await auth();
  if (session?.user?.id) {
    const state = await getRecruiterState(session.user.id);
    if (state.status === "active") redirect("/hire");
  }

  if (!isRecruiterAuthEnabled()) {
    return <RecruiterAuthClosed />;
  }

  return (
    <RecruiterOnboardingWizard
      initialScreen="identity"
      passwordEnabled={isEmailLoginEnabled()}
    />
  );
}
