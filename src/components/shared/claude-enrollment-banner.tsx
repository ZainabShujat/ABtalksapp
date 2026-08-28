"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ClaudeChallengeModal,
  OPEN_CLAUDE_MODAL_EVENT,
} from "@/components/dashboard/claude-challenge-modal";

interface Props {
  claudeStartsAt: Date;
  /** Use on /dashboard where the page already mounts ClaudeChallengeModal. */
  useSharedModal?: boolean;
}

export function ClaudeEnrollmentBanner({
  claudeStartsAt,
  useSharedModal = false,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);

  function handleLearnMore() {
    if (useSharedModal) {
      window.dispatchEvent(new CustomEvent(OPEN_CLAUDE_MODAL_EVENT));
      return;
    }
    setModalOpen(true);
  }

  return (
    <>
      <div className="border-b bg-[#FFF5F0]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 md:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-orange-500" />
            <p className="truncate text-sm font-medium">
              <span className="hidden sm:inline">
                Master Claude AI in 60 Days:{" "}
              </span>
              <span className="sm:hidden">Claude Challenge: </span>
              <span className="font-normal text-muted-foreground">
                Starts June 1
              </span>
            </p>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleLearnMore}
            className="h-7 shrink-0 gap-1.5 border-primary/30 text-xs hover:bg-primary/10"
          >
            <span className="hidden sm:inline">Learn More</span>
            <span className="sm:hidden">Join</span>
          </Button>
        </div>
      </div>

      {!useSharedModal && modalOpen ? (
        <ClaudeChallengeModal
          startsAt={claudeStartsAt}
          forceOpen
          onClose={() => setModalOpen(false)}
        />
      ) : null}
    </>
  );
}
