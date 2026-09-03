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
        // The Shortlist mark from the desk header (`/hire/talentpod.jpg`), so
        // the button on a card and the nav item it feeds are recognisably the
        // same thing. Only the `podLabel` — i.e. Scout desk — variant takes it;
        // the generic cart button keeps its lucide glyph.
        <img
          src="/hire/talentpod.jpg"
          alt=""
          width={14}
          height={16}
          aria-hidden="true"
          className="shrink-0"
        />
      ) : (
        <BookmarkPlus className="size-3.5" aria-hidden="true" />
      )}
      {!compact && label}
    </button>
  );
}
