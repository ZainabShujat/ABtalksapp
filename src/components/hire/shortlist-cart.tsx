"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2, Lock, Send } from "lucide-react";
import { toast } from "sonner";
import { placeBulkEngagementRequestAction } from "@/app/actions/hire-request-actions";
import { useHireAuth } from "@/components/hire/hire-auth-provider";
import { savePendingCheckout } from "@/components/hire/pending-checkout";
import { refPublicId, type CandidateSource } from "@/features/hire/candidate-ref";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CartRow = {
  candidateRef: string;
  /** Program members only — drives the evidence-profile link. */
  memberId: string | null;
  jobRole: string;
  totalScore: number;
  note: string | null;
  displayName?: string | null;
  skills?: string[];
  revealedName: string | null;
  /** Live engagement status for this candidate, if one exists. */
  engagementStatus: string | null;
  source?: CandidateSource;
  locationLabel?: string | null;
  yearsExperience?: number;
  missionsPassed?: number;
  totalTrackDays?: number | null;
  certificateIssued?: boolean;
  rationale?: string | null;
  workMode?: string | null;
  educationLevel?: string | null;
  availabilityUnknown?: boolean;
  compensationBand?: string | null;
};

const STATUS_COPY: Record<string, string> = {
  SUBMITTED: "Requested",
  IN_REVIEW: "In review",
  CONTACT_SHARED: "Contact shared",
  DECLINED: "Declined",
};

export function ShortlistCart({ rows }: { rows: CartRow[] }) {
  const router = useRouter();
  const { approved, pending: approvalPending, openAuth } = useHireAuth();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  // Already-requested candidates cannot be requested again, so they are not
  // selectable — the count on the button is always the number that will move.
  const selectable = useMemo(
    () => rows.filter((r) => !r.engagementStatus),
    [rows],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(selectable.map((r) => r.candidateRef)),
  );

  const allSelected =
    selectable.length > 0 && selected.size === selectable.length;

  function toggle(candidateRef: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(candidateRef)) next.delete(candidateRef);
      else next.add(candidateRef);
      return next;
    });
  }

  function place() {
    if (!approved) {
      if (approvalPending) {
        toast.error("Your recruiter application is still being reviewed.");
        return;
      }
      savePendingCheckout({
        candidateRefs: [...selected],
        note: note.trim() || undefined,
      });
      openAuth("checkout");
      return;
    }
    startTransition(async () => {
      const res = await placeBulkEngagementRequestAction({
        candidateRefs: [...selected],
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setNote("");
      setSelected(new Set());
      toast.success(
        res.data.placed === 0
          ? "Those were already requested."
          : `${res.data.placed} request${res.data.placed === 1 ? "" : "s"} placed. Our team will pick them up.`,
      );
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Your cart is empty. Add candidates from a search or the pool, then
          request them all in one go.
        </p>
        <Link
          href="/hire"
          className={cn(buttonVariants({ size: "sm" }), "mt-4")}
        >
          Start a search
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {selectable.length > 0 && (
        <button
          type="button"
          onClick={() =>
            setSelected(
              allSelected ? new Set() : new Set(selectable.map((r) => r.candidateRef)),
            )
          }
          className="text-xs font-medium text-primary hover:underline"
        >
          {allSelected ? "Clear selection" : `Select all ${selectable.length}`}
        </button>
      )}

      <ul className="divide-y rounded-xl border bg-card">
        {rows.map((r) => {
          const requested = Boolean(r.engagementStatus);
          const checked = selected.has(r.candidateRef);
          const publicId = refPublicId(r.candidateRef);
          return (
            <li
              key={r.candidateRef}
              className={cn(
                "flex flex-wrap items-center gap-3 px-4 py-3",
                requested && "opacity-70",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={requested || pending}
                onChange={() => toggle(r.candidateRef)}
                aria-label={`Select ${publicId}`}
                className="size-4 shrink-0 accent-[var(--color-primary)] disabled:opacity-40"
              />
              <div className="min-w-0 flex-1">
                {approved && r.memberId ? (
                  <Link
                    href={`/talent/members/${r.memberId}`}
                    className="font-medium hover:underline"
                  >
                    {r.revealedName ?? publicId}
                  </Link>
                ) : (
                  <span className="font-medium">
                    {r.revealedName ?? publicId}
                  </span>
                )}
                <p className="text-xs text-muted-foreground">
                  {r.jobRole} · {r.totalScore} pts
                  {r.note ? ` · ${r.note}` : ""}
                </p>
              </div>
              {requested && (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {r.engagementStatus === "CONTACT_SHARED" ? (
                    <CheckCircle2 className="size-3" aria-hidden="true" />
                  ) : (
                    <Lock className="size-3" aria-hidden="true" />
                  )}
                  {STATUS_COPY[r.engagementStatus!] ?? r.engagementStatus}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 rounded-xl border bg-muted/40 p-4">
        <label htmlFor="cart-note" className="text-sm font-medium">
          Add a comment for our team{" "}
          <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="cart-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="e.g. we can interview all of these next week; budget is flexible for the right person"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending || selected.size === 0}
            onClick={place}
            className={cn(
              buttonVariants({ size: "lg" }),
              "gap-2 disabled:opacity-50",
            )}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Place request for {selected.size}{" "}
            {selected.size === 1 ? "candidate" : "candidates"}
          </button>
          <p className="text-xs text-muted-foreground">
            Each one is reviewed separately, we confirm with the candidate
            before sharing any details.
          </p>
        </div>
      </div>
    </div>
  );
}
