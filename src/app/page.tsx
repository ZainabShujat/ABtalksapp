import { getLandingState } from "@/features/landing/get-landing-state";
import { isClaudeEnabled } from "@/lib/feature-flags";
import { LandingPage } from "@/components/landing/site/landing-page";

export default async function HomePage() {
  const state = await getLandingState();
  return <LandingPage claudeEnabled={isClaudeEnabled()} state={state} />;
}
