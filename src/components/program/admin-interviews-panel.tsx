"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  adminEvaluateInterviewAction,
  adminResetInterviewAction,
} from "@/app/actions/program-interview-actions";

type InterviewRow = {
  interviewId: string | null;
  memberId: string;
  memberName: string;
  company: string;
  status: string;
  durationSec: number | null;
  commScore: number | null;
  techScore: number | null;
  problemScore: number | null;
  overallScore: number | null;
  summary: string | null;
  evaluatedAt: string | null;
  resetCount: number;
  transcript: { role: string; text: string; ts: number }[];
};

function formatDuration(sec: number | null): string {
  if (sec === null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export function AdminInterviewsPanel({ rows }: { rows: InterviewRow[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewRow, setViewRow] = useState<InterviewRow | null>(null);
  const [resetReasons, setResetReasons] = useState<Record<string, string>>({});

  async function handleReEvaluate(interviewId: string) {
    setBusyId(interviewId);
    try {
      const res = await adminEvaluateInterviewAction({ interviewId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Re-evaluated.");
      window.location.reload();
    } finally {
      setBusyId(null);
    }
  }

  async function handleReset(memberId: string) {
    const reason = resetReasons[memberId]?.trim() ?? "";
    if (!reason) {
      toast.error("Provide a reason for the reset.");
      return;
    }
    setBusyId(memberId);
    try {
      const res = await adminResetInterviewAction({ memberId, reason });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Interview reset.");
      window.location.reload();
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No interview records yet for enrolled members.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium">Scores</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.memberId} className="border-b last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{row.memberName}</p>
                  <p className="text-xs text-muted-foreground">{row.company}</p>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {row.status.replace("_", " ")}
                  </span>
                  {row.resetCount > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.resetCount} restart{row.resetCount === 1 ? "" : "s"}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {formatDuration(row.durationSec)}
                </td>
                <td className="px-4 py-3">
                  {row.overallScore !== null ? (
                    <div className="text-xs">
                      <p className="font-semibold">{row.overallScore}/100</p>
                      <p className="text-muted-foreground">
                        C{row.commScore ?? "—"} T{row.techScore ?? "—"} P
                        {row.problemScore ?? "—"}
                      </p>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setViewRow(row)}
                    >
                      Transcript
                    </Button>
                    {row.status === "COMPLETED" && row.interviewId && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyId !== null}
                        onClick={() => void handleReEvaluate(row.interviewId!)}
                      >
                        Re-evaluate
                      </Button>
                    )}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Input
                      placeholder="Reset reason"
                      className="h-8 text-xs"
                      value={resetReasons[row.memberId] ?? ""}
                      onChange={(e) =>
                        setResetReasons((s) => ({
                          ...s,
                          [row.memberId]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busyId !== null}
                      onClick={() => void handleReset(row.memberId)}
                    >
                      Reset
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!viewRow} onOpenChange={() => setViewRow(null)}>
        <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {viewRow?.memberName} — transcript
            </DialogTitle>
          </DialogHeader>
          {viewRow?.summary && (
            <p className="text-sm text-muted-foreground">{viewRow.summary}</p>
          )}
          <ul className="space-y-2 text-sm">
            {viewRow?.transcript.map((line, i) => (
              <li key={i}>
                <Label className="text-xs text-primary">
                  {line.role === "ai" ? "Interviewer" : "Candidate"}
                </Label>
                <p className="text-muted-foreground">{line.text}</p>
              </li>
            ))}
          </ul>
          {viewRow && viewRow.transcript.length === 0 && (
            <p className="text-sm text-muted-foreground">No transcript lines.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
