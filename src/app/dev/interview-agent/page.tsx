import { notFound } from "next/navigation";
import { InterviewAgentDemo } from "@/components/dev/interview-agent-demo";

/**
 * Developer harness for the LangGraph interview agent.
 *
 * Not part of the product. It exists so the agent can be demonstrated on its
 * own — no cohort dashboard, no eligibility, no voice, no database — which is
 * exactly what makes it a fair demonstration of the agent rather than of the
 * app around it.
 *
 * 404s outside development. The Server Actions repeat that check themselves,
 * since a route guard does not protect an action endpoint.
 */
export const metadata = {
  title: "LangGraph Interview Agent — Dev Demo",
};

export default function InterviewAgentDemoPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <InterviewAgentDemo />;
}
