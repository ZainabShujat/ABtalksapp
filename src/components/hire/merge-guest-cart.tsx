"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  adoptGuestScoutSessionAction,
  recordSampleDemandAction,
} from "@/app/actions/hire-actions";
import { readGuestSession } from "@/components/hire/guest-session";
import { mergeGuestCartAction } from "@/app/actions/talent-actions";
import { placeBulkEngagementRequestAction } from "@/app/actions/hire-request-actions";
import {
  guestCartProgramIds,
  guestCartWithoutMerged,
  readGuestCart,
  writeGuestCart,
} from "@/components/hire/guest-cart";
import {
  clearPendingDemand,
  readPendingDemand,
} from "@/components/hire/pending-demand";
import {
  clearPendingCheckout,
  readPendingCheckout,
  saveCheckoutFlash,
} from "@/components/hire/pending-checkout";

/**
 * After an approved sign-in: move the guest cart onto the account, and if they
 * had already hit Request, place that request so they do not have to click again.
 *
 * The guest cart is the only copy of a shortlist somebody built before they had
 * an account, so nothing here removes an item until the server has confirmed
 * that item is on the account. It used to drop every program candidate whenever
 * the action returned `ok` — and the action returned `ok` even when it had
 * merged nothing, which is exactly what happens while a recruiter is still
 * waiting on approval. That combination erased the shortlist they signed up to
 * keep, silently, on the ordinary signup path.
 */
export function MergeGuestCart() {
  const running = useRef(false);
  const done = useRef(false);

  useEffect(() => {
    // `running` stops two renders racing; `done` latches only on success, so a
    // failed merge is retried on the next mount instead of being lost for the
    // rest of the session.
    if (running.current || done.current) return;
    running.current = true;

    void (async () => {
      try {
        const pendingDemand = readPendingDemand();
        if (pendingDemand) {
          const recorded = await recordSampleDemandAction({
            spec: pendingDemand.spec,
          });
          if (recorded.ok) {
            clearPendingDemand();
            toast.success("Noted — we'll be in touch when someone matches.");
          } else {
            toast.error(recorded.message);
          }
        }

        const items = readGuestCart();
        const programIds = guestCartProgramIds(items);

        if (programIds.length > 0) {
          const merged = await mergeGuestCartAction(programIds);

          if (!merged.ok) {
            // Cart untouched, so the next visit retries with everything intact.
            toast.error(
              `${merged.message} Your ${programIds.length} shortlisted candidate(s) are still saved here.`,
            );
            return;
          }

          // Keep anything the server did not confirm. A partial merge used to
          // report success and take the failures down with it.
          writeGuestCart(guestCartWithoutMerged(items, merged.data.mergedIds));

          if (merged.data.failedIds.length > 0) {
            toast.error(
              `${merged.data.failedIds.length} of ${programIds.length} candidate(s) could not be added yet — they are still saved here.`,
            );
            return;
          }
        }

        done.current = true;

        const guestBrief = readGuestSession();
        if (
          guestBrief &&
          guestBrief.messages.some((m) => m.role === "user")
        ) {
          await adoptGuestScoutSessionAction({
            spec: guestBrief.spec,
            summary: guestBrief.summary,
            searched: guestBrief.searched,
            messages: guestBrief.messages,
          });
        }

        const pending = readPendingCheckout();
        if (!pending || pending.candidateRefs.length === 0) return;

        const placed = await placeBulkEngagementRequestAction({
          candidateRefs: pending.candidateRefs,
          note: pending.note,
        });
        if (!placed.ok) {
          toast.error(placed.message);
          return;
        }
        clearPendingCheckout();
        saveCheckoutFlash({
          placed: placed.data.placed,
          skipped: placed.data.skipped,
        });
        window.location.href = "/hire/requests";
      } finally {
        running.current = false;
      }
    })();
  }, []);

  return null;
}
