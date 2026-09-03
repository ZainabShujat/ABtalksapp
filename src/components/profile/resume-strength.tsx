import { Lightbulb, Minus } from "lucide-react";
import type { ResumeView } from "@/features/resume/types";
import { cn } from "@/lib/utils";

/**
 * Resume Strength, as the candidate sees it.
 *
 * The score describes the resume, not a job. It is never labelled ATS, match or
 * compatibility anywhere in this component — no job description was involved in
 * producing it, and a label implying otherwise would be a lie to the candidate.
 *
 * Deliberately small. The engine behind this scores seven weighted categories
 * and stores every one of them, but a candidate reading their own profile does
 * not need a diagnostic panel — they need to know how they are doing and what
 * to do next. Category bars, per-category numbers and a "what is working" list
 * were all removed for that reason; they are still computed, still persisted in
 * `CandidateResume.analysis`, and still available to whatever needs them.
 *
 * A Server Component: it renders plain data and has no interactivity.
 */

function tone(score: number) {
  if (score >= 75) return { text: "text-emerald-500", bar: "bg-emerald-500" };
  if (score >= 50) return { text: "text-amber-500", bar: "bg-amber-500" };
  return { text: "text-rose-500", bar: "bg-rose-500" };
}

export function ResumeStrength({
  strength,
}: {
  strength: NonNullable<ResumeView["strength"]>;
}) {
  const t = tone(strength.overallScore);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-muted/20 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Resume strength
        </p>

        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="flex items-baseline gap-1">
            <span
              className={cn("font-display text-4xl font-bold tabular-nums", t.text)}
            >
              {strength.overallScore}
            </span>
            <span className="text-lg text-muted-foreground">/ 100</span>
          </p>
          <p className="text-sm font-medium">{strength.band}</p>
        </div>

        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={strength.overallScore}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Resume strength"
        >
          <div
            className={cn("h-full rounded-full transition-all duration-500", t.bar)}
            style={{ width: `${strength.overallScore}%` }}
          />
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          How complete and well written your resume is on its own — not measured
          against any particular job.
        </p>
      </div>

      {strength.tips.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <Lightbulb className="size-4 text-amber-500" aria-hidden />
            Areas to improve
          </h4>
          <ul className="space-y-1.5">
            {strength.tips.map((tip) => (
              <li key={tip} className="flex gap-2 text-sm text-muted-foreground">
                <Minus className="mt-1 size-3 shrink-0" aria-hidden />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
