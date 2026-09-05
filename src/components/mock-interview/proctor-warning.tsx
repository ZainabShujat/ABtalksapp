"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { ProctorSeverity } from "@/features/interview/proctoring/types";

/**
 * What the candidate is told, live, when something is observed.
 *
 * THE TONE IS THE FEATURE. Every string reaching this component states what
 * happened and what follows from it, and stops. Nothing accuses, nothing
 * threatens, and nothing claims to know why: we observed that the tab was
 * hidden, and we do not know whether that was a lookup, a notification or a
 * doorbell. A practice interview that implies otherwise is worse than one that
 * stays quiet.
 *
 * It is also NON-BLOCKING by construction — `pointer-events-none`, no focus
 * trap, no confirmation. A warning must never be able to stop someone
 * answering, which is the failure mode that makes proctoring worse than no
 * proctoring.
 *
 * WHAT IS VISIBLE IS DERIVED, NOT STORED. The session owns an append-only list
 * of raised warnings; this component renders the ones whose four seconds have
 * not elapsed. Keeping a second copy in local state and expiring it with a
 * timer per warning was the obvious shape and the wrong one — it meant a
 * cascade of `setState` calls from inside an effect, one live timer per
 * warning, and two lists that could disagree about what is on screen.
 */

export type ProctorWarning = {
  /** Unique per raised warning, so repeats of one kind still animate in. */
  id: number;
  /** Epoch ms the warning was raised. Drives expiry. */
  raisedAt: number;
  message: string;
  severity: ProctorSeverity;
};

/** How long one warning stays up. */
const VISIBLE_MS = 4_000;

/** Never stack more than this — two is a notice, five is a pile-up. */
const MAX_VISIBLE = 2;

/** How often expiry is re-checked while anything is on screen. */
const TICK_MS = 250;

export function ProctorWarnings({
  warnings,
}: {
  /** Append-only list from the session. Newest last. */
  warnings: ProctorWarning[];
}) {
  const [now, setNow] = useState(() => Date.now());

  const visible = warnings
    .filter((w) => now - w.raisedAt < VISIBLE_MS)
    .slice(-MAX_VISIBLE);

  // One timer, and only while something is actually showing. When the last
  // warning expires the condition goes false and the component goes idle
  // instead of re-rendering every quarter second for the rest of the interview.
  const showing = visible.length > 0;
  useEffect(() => {
    if (!showing) return;
    const timer = setTimeout(() => setNow(Date.now()), TICK_MS);
    return () => clearTimeout(timer);
  }, [showing, now]);

  if (!showing) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4"
      role="status"
      aria-live="polite"
    >
      {visible.map((warning) => (
        <div
          key={warning.id}
          className="flex max-w-md items-start gap-2.5 rounded-[12px] border border-[#E0A526]/40 bg-[#FFF8EC] px-4 py-2.5 shadow-sm"
        >
          <AlertTriangle
            className="mt-px size-4 shrink-0 text-[#B37700]"
            strokeWidth={1.75}
          />
          <p className="text-[13px] leading-snug text-[#4B3A16]">
            {warning.message}
          </p>
        </div>
      ))}
    </div>
  );
}
