"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  approveRecruiterAction,
  rejectRecruiterAction,
} from "@/app/actions/admin-recruiter-actions";

type PendingRecruiter = {
  id: string;
  fullName: string;
  company: string;
  phone: string | null;
  createdAt: string;
  email: string;
  pendingCandidateAsks: number;
};

export function AdminRecruitersPanel({
  pending,
}: {
  pending: PendingRecruiter[];
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleApprove(id: string) {
    setBusyId(id);
    try {
      const res = await approveRecruiterAction({ recruiterProfileId: id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Recruiter approved.");
      window.location.reload();
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    if (!confirm("Reject this recruiter application?")) return;
    setBusyId(id);
    try {
      const res = await rejectRecruiterAction({ recruiterProfileId: id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Application rejected.");
      window.location.reload();
    } finally {
      setBusyId(null);
    }
  }

  if (pending.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No pending recruiter applications.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {pending.map((row) => (
        <li key={row.id} className="rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium">{row.fullName}</p>
              <p className="text-muted-foreground">{row.company}</p>
              <p className="mt-1 text-muted-foreground">{row.email}</p>
              {row.phone && (
                <p className="text-xs text-muted-foreground">Phone: {row.phone}</p>
              )}
              {row.pendingCandidateAsks > 0 && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-900 dark:text-amber-100">
                  Already asked for {row.pendingCandidateAsks} candidate
                  {row.pendingCandidateAsks === 1 ? "" : "s"} — see Hire
                  requests
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Applied{" "}
                {new Date(row.createdAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busyId !== null}
                onClick={() => void handleApprove(row.id)}
              >
                Approve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyId !== null}
                onClick={() => void handleReject(row.id)}
              >
                Reject
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
