import { ProgramLanding } from "@/components/program/landing/program-landing";
import { auth } from "@/auth";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";
import { getEntryState } from "@/features/program/entry";

export const metadata = {
  title: "AI Cohort — ABTalks",
  description:
    "Build and deploy a production-grade enterprise AI chatbot in 31 days — RAG, agents, MCP, guardrails, Docker, Kubernetes — and get in front of recruiters.",
};

async function getPrimaryCta(): Promise<{ label: string; href: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { label: "Apply now", href: `${PROGRAM_AI_COHORT_BASE}/apply` };
  }

  const state = await getEntryState(session.user.id);
  switch (state.screen) {
    case "enrolled":
      return { label: "Go to dashboard", href: `${PROGRAM_AI_COHORT_BASE}/dashboard` };
    case "in_progress":
    case "intro":
      return { label: "Continue application", href: `${PROGRAM_AI_COHORT_BASE}/apply` };
    case "cooldown":
    case "failed":
    case "waitlisted":
      return { label: "View status", href: `${PROGRAM_AI_COHORT_BASE}/apply` };
    default:
      return { label: "Apply now", href: `${PROGRAM_AI_COHORT_BASE}/apply` };
  }
}

export default async function ProgramLandingPage() {
  const cta = await getPrimaryCta();
  return <ProgramLanding cta={cta} />;
}
