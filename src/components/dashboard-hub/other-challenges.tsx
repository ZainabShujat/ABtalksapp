import type { Domain } from "@prisma/client";
import { isClaudeEnabled } from "@/lib/feature-flags";
import { HUB_CARD_HOVER_CLASS } from "@/components/dashboard-hub/nav-items";
import { JoinClaudeButton } from "@/components/dashboard-hub/join-claude-button";
import { cn } from "@/lib/utils";

type OtherChallengesProps = {
  joinedDomains: Domain[];
  abandonedDomains: Domain[];
};

export function OtherChallenges({
  joinedDomains,
  abandonedDomains,
}: OtherChallengesProps) {
  const claudeEnabled = isClaudeEnabled();
  const joined = new Set(joinedDomains);
  const abandoned = new Set(abandonedDomains);

  const showClaude =
    claudeEnabled && !joined.has("CLAUDE") && !abandoned.has("CLAUDE");

  if (!showClaude) {
    return null;
  }

  return (
    <section className="scroll-mt-20 px-4 py-8 sm:px-6 lg:ml-4">
      <h2 className="font-heading text-xl font-semibold uppercase text-[#e05226]">
        Other challenges
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:ml-4">
        {showClaude ? (
          <li
            className={cn(
              "rounded-2xl border border-neutral-200 bg-white p-5",
              HUB_CARD_HOVER_CLASS,
            )}
          >
            <p className="font-heading font-semibold text-black">
              Claude Challenge
            </p>
            <p className="mt-1 text-sm text-[#555555]">
              Build with Claude · 60 days
            </p>
            <JoinClaudeButton />
          </li>
        ) : null}
      </ul>
    </section>
  );
}
