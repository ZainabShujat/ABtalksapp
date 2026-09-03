"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Send, UserRound } from "lucide-react";
import { toast } from "sonner";
import { placeBulkEngagementRequestAction } from "@/app/actions/hire-request-actions";
import { toggleShortlistAction } from "@/app/actions/talent-actions";
import { useHireAuth } from "@/components/hire/hire-auth-provider";
import { useHireDesk } from "@/components/hire/hire-desk-context";
import { DeskShortlistButton } from "@/components/hire/desk-shortlist-button";
import {
  DESK_REQUESTED_EVENT,
  markRequested,
  readRequested,
} from "@/components/hire/desk-requested";
import { readGuestCart, toggleGuestCart } from "@/components/hire/guest-cart";
import { savePendingCheckout } from "@/components/hire/pending-checkout";
import { decodeCandidateRef, refPublicId } from "@/features/hire/candidate-ref";
import type { CartRow } from "@/components/hire/shortlist-cart";
import { hydrateMatch } from "@/components/hire/evidence-cache";
import { MatchMetaTags, MatchPills } from "@/components/hire/hire-card-facts";
import { PodEmptyArt } from "@/components/hire/pod-empty-art";
import type { MatchCardData } from "@/components/hire/match-card";
import { cn } from "@/lib/utils";

function cartRowToMatch(row: CartRow): MatchCardData {
  return hydrateMatch({
    candidateRef: row.candidateRef,
    programMemberId: row.memberId,
    jobRole: row.jobRole,
    score: row.totalScore,
    displayName: row.displayName,
    source: row.source,
    locationLabel: row.locationLabel,
    tier: "PARTIAL",
    rationale: row.rationale ?? null,
    gaps: [],
    availabilityUnknown: row.availabilityUnknown ?? false,
    shortlisted: true,
    engagementStatus: row.engagementStatus,
    compensationBand: row.compensationBand,
    evidence: {
      skills: row.skills,
      yearsExperience: row.yearsExperience,
      missionsPassed: row.missionsPassed,
      totalTrackDays: row.totalTrackDays,
      certificateIssued: row.certificateIssued,
      workMode: row.workMode,
      educationLevel: row.educationLevel,
    },
  });
}

function isAsked(row: CartRow, requested: string[]): boolean {
  return Boolean(row.engagementStatus) || requested.includes(row.candidateRef);
}

export function HireTalentPod({ serverRows }: { serverRows: CartRow[] }) {
  const router = useRouter();
  const { closePod, openInspect } = useHireDesk();
  const { approved, pending: approvalPending, openAuth } = useHireAuth();
  const [extra, setExtra] = useState<CartRow[]>([]);
  const [requested, setRequested] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const sync = () => {
      setExtra(
        readGuestCart().map((i) => ({
          candidateRef: i.candidateRef,
          memberId:
            decodeCandidateRef(i.candidateRef)?.source === "PROGRAM"
              ? decodeCandidateRef(i.candidateRef)!.id
              : null,
          jobRole: i.jobRole,
          totalScore: i.totalScore,
          note: null,
          displayName: i.displayName ?? null,
          skills: i.skills,
          source: i.source,
          locationLabel: i.locationLabel,
          yearsExperience: i.yearsExperience,
          missionsPassed: i.missionsPassed,
          totalTrackDays: i.totalTrackDays,
          certificateIssued: i.certificateIssued,
          rationale: i.rationale,
          workMode: i.workMode,
          educationLevel: i.educationLevel,
          availabilityUnknown: i.availabilityUnknown,
          compensationBand: i.compensationBand,
          revealedName: null,
          engagementStatus: null,
        })),
      );
      setRequested(readRequested());
    };
    sync();
    window.addEventListener("abtalks-hire-cart", sync);
    window.addEventListener(DESK_REQUESTED_EVENT, sync);
    return () => {
      window.removeEventListener("abtalks-hire-cart", sync);
      window.removeEventListener(DESK_REQUESTED_EVENT, sync);
    };
  }, []);

  const rows = useMemo(() => {
    const seen = new Set(serverRows.map((r) => r.candidateRef));
    return [...serverRows, ...extra.filter((r) => !seen.has(r.candidateRef))];
  }, [serverRows, extra]);

  const selectable = useMemo(
    () => rows.filter((r) => !isAsked(r, requested)),
    [rows, requested],
  );

  useEffect(() => {
    const allowed = new Set(selectable.map((r) => r.candidateRef));
    setSelected((prev) => {
      const next = new Set([...prev].filter((ref) => allowed.has(ref)));
      if (next.size === prev.size && [...next].every((r) => prev.has(r))) {
        return prev;
      }
      return next;
    });
  }, [selectable]);

  function toggle(candidateRef: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(candidateRef)) next.delete(candidateRef);
      else next.add(candidateRef);
      return next;
    });
  }

  function remove(row: CartRow) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(row.candidateRef);
      return next;
    });
    if (approved && row.memberId) {
      startTransition(async () => {
        const res = await toggleShortlistAction({ memberId: row.memberId! });
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        toast.success("Removed from Shortlist");
      });
      return;
    }
    toggleGuestCart({
      candidateRef: row.candidateRef,
      jobRole: row.jobRole,
      totalScore: row.totalScore,
    });
    toast.success("Removed from Shortlist");
  }

  function place() {
    const refs = selectable
      .map((r) => r.candidateRef)
      .filter((ref) => selected.has(ref));
    if (refs.length === 0) {
      toast.error("Select at least one candidate who is not already requested.");
      return;
    }
    if (!approved) {
      if (approvalPending) {
        toast.error("Your recruiter application is still being reviewed.");
        return;
      }
      savePendingCheckout({
        candidateRefs: refs,
        note: note.trim() || undefined,
      });
      openAuth("checkout");
      return;
    }
    startTransition(async () => {
      const res = await placeBulkEngagementRequestAction({
        candidateRefs: refs,
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        res.data.placed === 0
          ? "Those were already requested."
          : `${res.data.placed} request${res.data.placed === 1 ? "" : "s"} placed.`,
      );
      if (res.data.placed > 0) {
        markRequested(refs);
        setSelected(new Set());
        setNote("");
        router.refresh();
      }
    });
  }

  const allSelected =
    selectable.length > 0 && selected.size === selectable.length;

  return (
    <section className="hire-pod" aria-label="Your Shortlist">
      <header className="hire-pod__header">
        <button type="button" className="hire-back" onClick={closePod}>
          <ChevronLeft aria-hidden="true" />
          Back to Scout
        </button>
        <h1 className="hire-pod__title">Your Shortlist</h1>
      </header>

      <div className="hire-pod__main">
        <div className="hire-pod__col">
          {selectable.length > 0 && (
            <button
              type="button"
              className="hire-pod__selectall"
              onClick={() =>
                setSelected(
                  allSelected
                    ? new Set()
                    : new Set(selectable.map((r) => r.candidateRef)),
                )
              }
            >
              {allSelected
                ? "Clear selection"
                : `Select all ${selectable.length} remaining`}
            </button>
          )}

          <div className="hire-pod__list">
            {rows.length === 0 ? (
              <div className="pod-empty">
                <p className="pod-empty__copy">
                  Your Shortlist is empty. Add candidates from a search, then
                  tick the ones you want to request.
                </p>
                <PodEmptyArt />
                <button
                  type="button"
                  className="pod-empty__cta"
                  onClick={closePod}
                >
                  Start a search
                </button>
              </div>
            ) : (
              rows.map((row) => {
                const publicId = refPublicId(row.candidateRef);
                const asked = isAsked(row, requested);
                const checked = selected.has(row.candidateRef);
                const match = cartRowToMatch(row);
                const stack =
                  match.evidence.skills && match.evidence.skills.length > 0
                    ? match.evidence.skills.slice(0, 6).join(" · ")
                    : row.displayName
                      ? row.jobRole
                      : null;
                return (
                  <article
                    key={row.candidateRef}
                    className={cn(
                      "hire-pod__card",
                      asked && "is-asked",
                      checked && "is-picked",
                    )}
                  >
                    <div className="hire-pod__who">
                      {!asked ? (
                        <input
                          type="checkbox"
                          className="hire-pod__check"
                          checked={checked}
                          disabled={pending}
                          onChange={() => toggle(row.candidateRef)}
                          aria-label={`Select ${row.displayName || publicId}`}
                        />
                      ) : (
                        <span className="desk-card__avatar" aria-hidden="true">
                          <UserRound className="size-6" />
                        </span>
                      )}
                      <div>
                        <p className="hire-pod__name">
                          {row.displayName || row.revealedName || row.jobRole}
                        </p>
                        {stack && <p className="desk-card__stack">{stack}</p>}
                        <p className="hire-pod__ref">{publicId}</p>
                        <MatchMetaTags match={match} />
                      </div>
                    </div>
                    <div className="desk-card__score">
                      <div>
                        <b>{row.totalScore}</b>
                      </div>
                      <span>out of 100</span>
                    </div>
                    <MatchPills match={match} compact />
                    {match.rationale && (
                      <p className="desk-card__why">{match.rationale}</p>
                    )}
                    <div className="hire-pod__actions">
                      <button
                        type="button"
                        className="desk-ghost"
                        onClick={() => openInspect(match)}
                      >
                        View more details
                        <ChevronRight className="size-3.5" aria-hidden="true" />
                      </button>
                      {asked ? (
                        <span className="hire-pod__status">Requested</span>
                      ) : (
                        <>
                          <DeskShortlistButton
                            candidateRef={row.candidateRef}
                            jobRole={row.jobRole}
                            match={match}
                          />
                          <button
                            type="button"
                            className="desk-ghost"
                            onClick={() => remove(row)}
                          >
                            Remove from Shortlist
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>

        <aside className="hire-pod__request">
          <p className="hire-pod__kicker">Request</p>
          <h2>
            Add a comment for our team <span>(optional)</span>
          </h2>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder="e.g. we can interview these next week; budget is flexible for the right person"
          />
          <p className="hire-pod__note">
            Only the ticked people are sent. Already requested stay in the pod
            and are not sent again.
          </p>
          <button
            type="button"
            className="hire-pod__submit"
            disabled={pending || selected.size === 0}
            onClick={place}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Place request for {selected.size} candidate
            {selected.size === 1 ? "" : "s"}
          </button>
        </aside>
      </div>
    </section>
  );
}
