"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  gradeAllUngradedAction,
  gradeProjectAction,
  generateRecommendationsAction,
  overrideProjectScoreAction,
} from "@/app/actions/program-ai-actions";

type UngradedRow = {
  projectId: string;
  memberName: string;
  company: string;
  moduleNumber: number;
  repoUrl: string;
  submittedAt: string;
};

type GradedRow = {
  projectId: string;
  memberName: string;
  company: string;
  moduleNumber: number;
  repoUrl: string;
  aiScore: number | null;
  adminScore: number | null;
  effectiveScore: number;
  aiFeedback: string | null;
  aiRubricJson: unknown;
  gradedAt: string | null;
};

type CriterionBar = { name: string; score: number; note?: string };

function parseCriteria(json: unknown): CriterionBar[] {
  if (!json || typeof json !== "object") return [];
  const criteria = (json as { criteria?: unknown }).criteria;
  if (!Array.isArray(criteria)) return [];
  return criteria
    .filter(
      (c): c is CriterionBar =>
        !!c &&
        typeof c === "object" &&
        typeof (c as CriterionBar).name === "string" &&
        typeof (c as CriterionBar).score === "number",
    )
    .map((c) => ({
      name: c.name,
      score: c.score,
      note: c.note,
    }));
}

export function AdminProjectsPanel({
  cohortId,
  ungraded,
  graded,
}: {
  cohortId: string;
  ungraded: UngradedRow[];
  graded: GradedRow[];
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overrideScores, setOverrideScores] = useState<Record<string, string>>(
    {},
  );
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>(
    {},
  );

  async function handleGrade(projectId: string) {
    setBusyId(projectId);
    try {
      const res = await gradeProjectAction({ projectId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Graded: ${res.data.score}/100`);
      window.location.reload();
    } finally {
      setBusyId(null);
    }
  }

  async function handleGradeAll() {
    setBusyId("all");
    try {
      const res = await gradeAllUngradedAction(cohortId);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Graded ${res.data.graded}, failed ${res.data.failed}`);
      window.location.reload();
    } finally {
      setBusyId(null);
    }
  }

  async function handleRecommendations() {
    setBusyId("recs");
    try {
      const res = await generateRecommendationsAction({ cohortId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        `Generated ${res.data.generated}, skipped ${res.data.skipped}, failed ${res.data.failed}`,
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleOverride(projectId: string) {
    const score = Number(overrideScores[projectId]);
    const reason = overrideReasons[projectId]?.trim() ?? "";
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      toast.error("Enter a score between 0 and 100.");
      return;
    }
    if (!reason) {
      toast.error("Provide a reason for the override.");
      return;
    }
    setBusyId(projectId);
    try {
      const res = await overrideProjectScoreAction({ projectId, score, reason });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Score overridden.");
      window.location.reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => void handleGradeAll()}
          disabled={busyId !== null || ungraded.length === 0}
        >
          Grade all ungraded ({ungraded.length})
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleRecommendations()}
          disabled={busyId !== null}
        >
          Generate recommendations
        </Button>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Ungraded queue</h2>
        {ungraded.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submitted projects waiting.</p>
        ) : (
          <ul className="space-y-3">
            {ungraded.map((row) => (
              <li key={row.projectId} className="rounded-xl border p-4 text-sm">
                <p className="font-medium">
                  {row.memberName} · Module {row.moduleNumber}
                </p>
                <p className="text-muted-foreground">{row.company}</p>
                <a
                  href={row.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-primary underline-offset-4 hover:underline"
                >
                  {row.repoUrl}
                </a>
                <div className="mt-3">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleGrade(row.projectId)}
                    disabled={busyId !== null}
                  >
                    {busyId === row.projectId ? "Grading…" : "Grade with AI"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Graded projects</h2>
        {graded.length === 0 ? (
          <p className="text-sm text-muted-foreground">No graded projects yet.</p>
        ) : (
          <ul className="space-y-4">
            {graded.map((row) => {
              const criteria = parseCriteria(row.aiRubricJson);
              return (
                <li key={row.projectId} className="rounded-xl border p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {row.memberName} · Module {row.moduleNumber}
                      </p>
                      <p className="text-muted-foreground">{row.company}</p>
                    </div>
                    <p className="font-display text-xl font-bold">
                      {row.effectiveScore}/100
                      {row.adminScore !== null && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          (override)
                        </span>
                      )}
                    </p>
                  </div>
                  {criteria.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {criteria.map((c) => (
                        <div key={c.name}>
                          <div className="flex justify-between text-xs">
                            <span>{c.name}</span>
                            <span>{c.score}/100</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${c.score}%` }}
                            />
                          </div>
                          {c.note && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {c.note}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {row.aiFeedback && (
                    <p className="mt-3 whitespace-pre-wrap text-muted-foreground">
                      {row.aiFeedback}
                    </p>
                  )}
                  <div className="mt-4 grid gap-2 sm:grid-cols-[120px_1fr_auto]">
                    <div>
                      <Label htmlFor={`score-${row.projectId}`}>Override</Label>
                      <Input
                        id={`score-${row.projectId}`}
                        type="number"
                        min={0}
                        max={100}
                        placeholder="0–100"
                        value={overrideScores[row.projectId] ?? ""}
                        onChange={(e) =>
                          setOverrideScores((s) => ({
                            ...s,
                            [row.projectId]: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor={`reason-${row.projectId}`}>Reason</Label>
                      <Input
                        id={`reason-${row.projectId}`}
                        value={overrideReasons[row.projectId] ?? ""}
                        onChange={(e) =>
                          setOverrideReasons((s) => ({
                            ...s,
                            [row.projectId]: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleOverride(row.projectId)}
                        disabled={busyId !== null}
                      >
                        Apply
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
