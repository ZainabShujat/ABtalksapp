import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLandingState } from "@/features/landing/get-landing-state";
import { getRecruiterState } from "@/features/talent-pool/recruiter-registration";
import { isClaudeEnabled } from "@/lib/feature-flags";
import { LandingPage } from "@/components/landing/site/landing-page";

export default async function HomePage() {
  const session = await auth();
  if (session?.user?.id) {
    // RecruiterProfile is the current database-backed recruiter authority.
    // Checking it here keeps a stale JWT role from sending the wrong account
    // to its home surface, and pending recruiters can still use Scout's
    // existing non-persistent experience.
    const recruiter = await getRecruiterState(session.user.id);
    redirect(recruiter.status === "none" ? "/dashboard" : "/hire");
  }

  const state = await getLandingState();
  return <LandingPage claudeEnabled={isClaudeEnabled()} state={state} />;
}
