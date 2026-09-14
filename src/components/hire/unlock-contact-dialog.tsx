"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  previewUnlockAction,
  unlockContactAction,
} from "@/app/actions/hire-unlock-actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCreditsMinor } from "@/lib/credits-format";
import { cn } from "@/lib/utils";

/**
 * "Unlock contact details" — cost shown first (T-229).
 *
 * ## What this must say before it charges
 *
 * The cost, the current balance, and what will be left. All three, before the
 * confirm button, because a recruiter deciding whether to spend is entitled to
 * see the consequence of spending rather than discover it afterwards. The
 * after-figure carries the strongest weight of the three: it is the one a
 * person actually decides on.
 *
 * ## Why the numbers here decide nothing
 *
 * They are fetched for display and are already stale by the time anyone reads
 * them — another tab may have spent the balance. The server re-reads the price
 * and the balance inside the transaction that charges, so what is rendered here
 * can be wrong without being dangerous. Nothing in the payload carries a price.
 *
 * The disabled state on the confirm button is a courtesy, not a safeguard. A
 * double click, a retry and two browsers at once are all made harmless by the
 * ledger's unique key, not by this component (T-230).
 *
 * ## Design
 *
 * T-202 was not available, and Sohail asked that implementation not wait for
 * it. So this borrows the desk's own language rather than inventing one: the
 * `hire-app` token scope and overlay treatment that `recruiter-auth-dialog`
 * already uses, the kicker, and the pill buttons from `hire-scout.css`. No new
 * tokens, no new type scale, nothing decorative.
 *
 * It is deliberately shallow — one `Figure` row repeated three times and one
 * branch per state — so replacing the visuals later is a change to this file
 * and its CSS block, and to nothing else.
 */

type Props = {
  /** `PROGRAM:<id>` / `CLAUDE:<id>` — a name for a candidate, never a key. */
  candidateRef: string;
  /** For the dialog subtitle only. Never used to address anything. */
  publicId: string;
  className?: string;
  onUnlocked?: () => void;
  /**
   * Replaces the default "Unlock contact" pill with a custom trigger — the
   * inspector's "Reveal email" / "Reveal number" rows and the resume eye.
   * When set, the trigger takes only `className`, not the pill styling.
   */
  triggerLabel?: ReactNode;
  triggerAriaLabel?: string;
  triggerTitle?: string;
};

type Preview = {
  alreadyUnlocked: boolean;
  costMinor: number;
  balanceMinor: number;
  remainingMinor: number;
  affordable: boolean;
  currency: string;
};

export function UnlockContactDialog({
  candidateRef,
  publicId,
  className,
  onUnlocked,
  triggerLabel,
  triggerAriaLabel,
  triggerTitle,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  async function openDialog() {
    setOpen(true);
    setPreview(null);
    setError(null);
    setLoading(true);
    try {
      const result = await previewUnlockAction({ candidateRef });
      if (!result.ok) {
        // The real reason, whatever it is. A withdrawn candidate is not a
        // money problem and must never be worded as one.
        setError(result.message);
        return;
      }
      setPreview({
        alreadyUnlocked: result.alreadyUnlocked,
        costMinor: result.costMinor,
        balanceMinor: result.balanceMinor,
        remainingMinor: result.remainingMinor,
        affordable: result.affordable,
        currency: result.currency,
      });
    } catch {
      setError("Could not load the cost. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function confirm() {
    startTransition(async () => {
      const result = await unlockContactAction({ candidateRef });

      if (!result.ok) {
        setError(result.message);
        toast.error(result.message);
        return;
      }

      toast.success(
        result.charged
          ? `Contact unlocked — ${formatCreditsMinor(result.costMinor)} spent`
          : "Contact unlocked — no charge",
      );
      setOpen(false);
      onUnlocked?.();
      router.refresh();
    });
  }

  const currency = preview?.currency ?? "USD";
  const blocked = preview !== null && !preview.alreadyUnlocked && !preview.affordable;

  return (
    <>
      {triggerLabel ? (
        <button
          type="button"
          className={className}
          aria-haspopup="dialog"
          aria-label={triggerAriaLabel}
          title={triggerTitle}
          onClick={openDialog}
        >
          {triggerLabel}
        </button>
      ) : (
        <button
          type="button"
          className={cn("hire-unlock-trigger", className)}
          onClick={openDialog}
        >
          <Lock className="size-3.5" aria-hidden="true" />
          Unlock contact
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="hire-app hire-unlock sm:max-w-sm" showCloseButton>
          <DialogHeader>
            <p className="hire-auth__kicker">ABTalks Hire</p>
            <DialogTitle>Unlock contact details</DialogTitle>
            <DialogDescription>
              {publicId} — email and phone, visible to you alone.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <p className="hire-unlock__loading">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Checking your balance
            </p>
          ) : error ? (
            <p className="hire-unlock__notice">{error}</p>
          ) : preview?.alreadyUnlocked ? (
            <div className="hire-unlock__free">
              <p className="hire-unlock__freetag">
                <Check className="size-3.5" aria-hidden="true" />
                Already unlocked
              </p>
              <p className="hire-unlock__freenote">
                You unlocked this candidate before. Opening their details again
                costs nothing.
              </p>
            </div>
          ) : preview ? (
            <>
              <dl className="hire-unlock__figures">
                <Figure
                  label="This unlock costs"
                  value={formatCreditsMinor(preview.costMinor, currency)}
                />
                <Figure
                  label="Your balance"
                  value={formatCreditsMinor(preview.balanceMinor, currency)}
                />
                <Figure
                  label="After unlock"
                  value={formatCreditsMinor(preview.remainingMinor, currency)}
                  strong
                />
              </dl>
              {blocked ? (
                <p className="hire-unlock__notice">
                  You have{" "}
                  {formatCreditsMinor(preview.balanceMinor, currency)} and this
                  unlock costs{" "}
                  {formatCreditsMinor(preview.costMinor, currency)}. Nothing has
                  been charged.{" "}
                  <Link href="/hire/credits" onClick={() => setOpen(false)}>
                    View credits
                  </Link>{" "}
                  or contact ABTalks at team@abtalks.in for more credits.
                </p>
              ) : null}
            </>
          ) : null}

          <div className="hire-unlock__actions">
            <button
              type="button"
              className="hire-unlock__cancel"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="hire-unlock__confirm"
              onClick={confirm}
              disabled={pending || loading || preview === null || blocked}
            >
              {pending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Unlocking
                </>
              ) : preview?.alreadyUnlocked ? (
                "Show contact details"
              ) : (
                `Unlock for ${formatCreditsMinor(preview?.costMinor ?? 0, currency)}`
              )}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * One labelled figure.
 *
 * A `<dl>` row rather than a styled div, because that is what these are: three
 * terms and their values. `strong` marks the one the decision actually turns on.
 */
function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={cn("hire-unlock__row", strong && "is-strong")}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
