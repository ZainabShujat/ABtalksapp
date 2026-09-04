"use client";

import { useEffect, useState, useTransition } from "react";
// BookmarkPlus, not ShoppingCart: this is a shortlist, not a basket, and
// nothing downstream is a purchase. The label already says "Add to Shortlist".
import { BookmarkPlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { toggleShortlistAction } from "@/app/actions/talent-actions";
import {
  cartItemFromMatch,
  guestCartHas,
  toggleGuestCart,
} from "@/components/hire/guest-cart";
import type { MatchCardData } from "@/components/hire/match-card";
import { useHireAuth } from "@/components/hire/hire-auth-provider";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Add / remove a candidate from the cart.
 *
 * Program members still go through RecruiterShortlistItem (FK to
 * ProgramMember). Everyone else — Claude, 60-day, hackathon — lives in
 * the device cart keyed on candidateRef. Never write those ids into
 * memberId: that column addresses a ProgramMember row.
 */
export function ShortlistButton({
  candidateRef,
  programMemberId,
  initialShortlisted,
  compact = false,
  jobRole,
  totalScore,
  displayName,
  skills,
  snapshot,
  onToggle,
  className,
  podLabel = false,
}: {
  candidateRef: string;
  /** Set only for US-cohort / program members. */
  programMemberId?: string | null;
  initialShortlisted: boolean;
  jobRole?: string;
  totalScore?: number;
  displayName?: string | null;
  skills?: string[];
  snapshot?: MatchCardData;
  /** Icon-only, for dense rows. */
  compact?: boolean;
  onToggle?: (inCart: boolean) => void;
  className?: string;
  /** Hire desk copy — same cart, different label. */
  podLabel?: boolean;
}) {
  const { approved } = useHireAuth();
  const useDb = Boolean(approved && programMemberId);
  const [inCart, setInCart] = useState(initialShortlisted);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (useDb) return;
    setInCart(guestCartHas(candidateRef));
  }, [candidateRef, useDb]);

  function toggleLocal() {
    const next = toggleGuestCart(
      snapshot
        ? cartItemFromMatch(snapshot)
        : {
            candidateRef,
            jobRole: jobRole ?? "Candidate",
            totalScore: totalScore ?? 0,
            displayName: displayName ?? null,
            skills,
          },
    );
    setInCart(next);
    onToggle?.(next);
    // Nothing on add. The shortlist bar appears with the count the moment a
    // candidate goes in, and it is the designed confirmation — a toast on top
    // of it is the same news twice, in a style the desk does not use anywhere
    // else. Removal still speaks, because the bar only shrinks and has no way
    // to say which row left.
    if (!next) {
      toast.success(podLabel ? "Removed from Shortlist" : "Removed from cart");
    }
  }

  function toggle() {
    if (!useDb) {
      toggleLocal();
      return;
    }
    startTransition(async () => {
      const result = await toggleShortlistAction({ memberId: programMemberId! });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setInCart(result.data.shortlisted);
      onToggle?.(result.data.shortlisted);
      if (!result.data.shortlisted) {
        toast.success(podLabel ? "Removed from Shortlist" : "Removed from cart");
      }
    });
  }

  const label = podLabel
    ? inCart
      ? "In Shortlist"
      : "Add to Shortlist"
    : inCart
      ? "Remove from cart"
      : "Add to cart";

  return (
    <button
      type="button"
      disabled={pending}
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn(
        buttonVariants({
          variant: "secondary",
          size: compact ? "icon" : "lg",
        }),
        "shrink-0 gap-1.5 disabled:opacity-50",
        inCart &&
          "bg-primary/15 text-primary hover:bg-primary/25 dark:bg-primary/20 dark:hover:bg-primary/30",
        className,
      )}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : inCart ? (
        <X className="size-3.5" aria-hidden="true" />
      ) : podLabel ? (
        // The desk header's own Shortlist mark, reusing its markup and classes
        // rather than pointing a bare <img> at the same file.
        //
        // `.hire-hbtn__icon` is a crop viewport, not a plain image slot: the
        // JPEG carries a wide white margin, and `--pod` scales it ~180% and
        // offsets it to frame just the glyph. Rendering the file at its natural
        // size — which is what a bare <img> does — shows the padding too, so
        // the mark comes out small and washed out. The same rules also carry
        // the dark-mode invert.
        //
        // Only the `podLabel` (Scout desk) variant takes it; the generic cart
        // button keeps its lucide glyph.
        <span
          className="hire-hbtn__icon hire-hbtn__icon--pod"
          aria-hidden="true"
        >
          <img src="/hire/talentpod.jpg" alt="" width={18} height={20} />
        </span>
      ) : (
        <BookmarkPlus className="size-3.5" aria-hidden="true" />
      )}
      {!compact && label}
    </button>
  );
}
