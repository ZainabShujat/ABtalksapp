"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  linkRealCandidateAction,
  updateVirtualRequestStatusAction,
} from "@/app/actions/virtual-candidate-actions";

/**
 * The sourcing queue: recruiter demand we have not been able to answer.
 *
 * Every row is a requirement somebody asked for and we did not have. That makes
 * this list the most direct statement the platform has about who we should be
 * onboarding next — `siblingCount` is on each row precisely so a requirement
 * three recruiters are waiting on is visibly not the same as one.
 */

export type QueueRow = {
  id: string;
  status: string;
  createdAt: string;
  timelineDays: number | null;
  recruiterNote: string | null;
  priority: number;
  recruiter: { id: string; name: string | null; email: string };
  virtualCandidate: {
    id: string;
    title: string;
    requiredSkills: string[];
    experienceMin: number | null;
    experienceMax: number | null;
    locationLabel: string | null;
  };
  siblingCount: number;
};

/** Mirrors the store's transition table, so the UI cannot offer an illegal move. */
const NEXT: Record<string, string[]> = {
  REQUESTED: ["SOURCING", "CANCELLED"],
  SOURCING: ["CANDIDATE_FOUND", "CANCELLED"],
  CANDIDATE_FOUND: ["CANDIDATE_SHARED", "SOURCING", "CANCELLED"],
  CANDIDATE_SHARED: ["FULFILLED", "SOURCING", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
  EXPIRED: ["SOURCING"],
};

function experience(row: QueueRow): string {
  const { experienceMin: lo, experienceMax: hi } = row.virtualCandidate;
  if (lo !== null && hi !== null) return lo === hi ? `${lo} yrs` : `${lo}–${hi} yrs`;
  if (lo !== null) return `${lo}+ yrs`;
  if (hi !== null) return `up to ${hi} yrs`;
  return "not specified";
}

export function VirtualCandidateQueue({ rows }: { rows: QueueRow[] }) {
  const [pending, startTransition] = useTransition();
  const [linking, setLinking] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [note, setNote] = useState("");

  function move(requestId: string, status: string) {
    startTransition(async () => {
      const res = await updateVirtualRequestStatusAction({ requestId, status, note: null });
      if (!res.ok) toast.error(res.message);
      else toast.success(`Moved to ${status.replace(/_/g, " ").toLowerCase()}`);
    });
  }

  function link(requestId: string) {
    startTransition(async () => {
      const res = await linkRealCandidateAction({
        requestId,
        candidateUserId: candidateId.trim(),
        note: note.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Candidate linked. The recruiter can be told now.");
      setLinking(null);
      setCandidateId("");
      setNote("");
    });
  }

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No open virtual candidate requests. Every requirement a recruiter has
        asked for so far, we have been able to answer from the pool.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <article key={r.id} className="rounded-xl border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display font-bold">{r.virtualCandidate.title}</p>
              <p className="text-muted-foreground text-sm">
                {r.recruiter.name ?? r.recruiter.email} · asked{" "}
                {new Date(r.createdAt).toLocaleDateString()}
                {r.timelineDays ? ` · needs in ${r.timelineDays} days` : ""}
              </p>
            </div>
            <span className="rounded-full border px-2.5 py-0.5 text-xs font-semibold">
              {r.status.replace(/_/g, " ")}
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-xs uppercase">Skills</dt>
              <dd>{r.virtualCandidate.requiredSkills.join(" · ") || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase">Experience</dt>
              <dd>{experience(r)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase">Location</dt>
              <dd>{r.virtualCandidate.locationLabel ?? "—"}</dd>
            </div>
          </dl>

          {r.recruiterNote && (
            <p className="text-muted-foreground mt-2 text-sm italic">
              “{r.recruiterNote}”
            </p>
          )}

          {r.siblingCount > 0 && (
            <p className="mt-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
              {r.siblingCount} other recruiter{r.siblingCount === 1 ? " is" : "s are"}{" "}
              waiting on this same requirement — one search may answer them all.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {(NEXT[r.status] ?? []).map((s) => (
              <button
                key={s}
                type="button"
                disabled={pending}
                onClick={() => move(r.id, s)}
                className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                {s === "SOURCING" ? "Start sourcing" : s.replace(/_/g, " ").toLowerCase()}
              </button>
            ))}
            {["SOURCING", "CANDIDATE_FOUND", "CANDIDATE_SHARED"].includes(r.status) && (
              <button
                type="button"
                disabled={pending}
                onClick={() => setLinking(linking === r.id ? null : r.id)}
                className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                Link real candidate
              </button>
            )}
          </div>

          {linking === r.id && (
            <div className="mt-3 space-y-2 border-t pt-3">
              <label className="text-muted-foreground text-xs uppercase" htmlFor={`c-${r.id}`}>
                Candidate user id
              </label>
              <input
                id={`c-${r.id}`}
                value={candidateId}
                onChange={(e) => setCandidateId(e.target.value)}
                placeholder="cuid of the User row"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                disabled={pending}
              />
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Internal note (optional)"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                disabled={pending}
              />
              <button
                type="button"
                disabled={pending || !candidateId.trim()}
                onClick={() => link(r.id)}
                className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                {pending ? "Linking…" : "Link candidate"}
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
