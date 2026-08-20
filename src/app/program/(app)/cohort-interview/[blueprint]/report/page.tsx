import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProgramMember } from "@/lib/program-auth";
import {
  parseBlueprintParam,
  BLUEPRINT_LABEL,
} from "@/features/interview/cohort/blueprint";
import { getCohortInterviewReport } from "@/features/interview/service";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The persisted assessment report.
 *
 * Server Component with no client JavaScript at all: it reads the stored
 * document and renders it. Nothing is recomputed here — a report is the record
 * of an assessment that already happened, and regenerating it on each view
 * would let the same interview say different things on different days.
 *
 * Every number on this page came out of `module-scoring.ts` / `scoring.ts` at
 * completion time, and every narrative claim carries the question ids it rests
 * on. The evidence section at the bottom is what makes those citations
 * checkable rather than decorative.
 */
export default async function CohortInterviewReportPage({
  params,
}: {
  params: Promise<{ blueprint: string }>;
}) {
  // Authenticate BEFORE looking at the URL, as the interview page does.
  const { member } = await requireProgramMember();

  const { blueprint: rawBlueprint } = await params;
  const blueprint = parseBlueprintParam(rawBlueprint);
  if (!blueprint) notFound();

  // Member-scoped at the query level: another member's interview id resolves to
  // "no report", never to their report.
  const result = await getCohortInterviewReport(member.id, blueprint);

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {BLUEPRINT_LABEL[blueprint]} — report
        </h1>
        <p className="text-sm text-muted-foreground">{result.message}</p>
        <Link
          href="/program/dashboard"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  const { report, generatedAt } = result.data;
  const answered = report.evidence.filter((e) => e.answered);

  return (
    <div className="mx-auto max-w-4xl space-y-10 pb-16">
      {/* ---------------------------------------------------------- header */}
      <header className="space-y-3 border-b pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          AI Cohort interview report
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {report.milestone.label}
        </h1>
        <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Candidate</dt>
            <dd className="font-medium">
              {report.candidate.name}
              {report.candidate.jobRole ? ` — ${report.candidate.jobRole}` : ""}
              {report.candidate.company ? ` at ${report.candidate.company}` : ""}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Cohort</dt>
            <dd className="font-medium">{report.candidate.cohort}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Assessed</dt>
            <dd className="font-medium">
              Days {report.milestone.scopeFrom}–{report.milestone.scopeTo}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Live progress</dt>
            <dd className="font-medium">
              {report.milestone.progressDay
                ? `Day ${report.milestone.progressDay}`
                : "—"}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                context only, not scored
              </span>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="font-medium">
              {Math.floor(report.overall.durationSec / 60)}m{" "}
              {report.overall.durationSec % 60}s
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Generated</dt>
            <dd className="font-medium">
              {generatedAt.toISOString().slice(0, 10)}
            </dd>
          </div>
        </dl>
      </header>

      {/* --------------------------------------------------------- overall */}
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Overall
        </p>
        <p className="font-display text-6xl font-bold tabular-nums text-[hsl(var(--primary))]">
          {report.overall.score}
          <span className="ml-2 text-2xl font-normal text-muted-foreground">
            / 100
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          {report.overall.tier.toLowerCase().replace(/_/g, " ")} ·{" "}
          {report.overall.questionsAnswered} of {report.overall.questionsAsked}{" "}
          questions answered · {report.overall.escalationsEarned} deeper probe
          {report.overall.escalationsEarned === 1 ? "" : "s"} earned ·{" "}
          {report.overall.followUpsAsked} follow-up
          {report.overall.followUpsAsked === 1 ? "" : "s"}
        </p>
      </section>

      {/* --------------------------------------------------------- modules */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Module performance
        </h2>
        <ol className="divide-y border-y">
          {report.modules.map((mod) => (
            <li
              key={mod.moduleNumber}
              className="flex items-baseline gap-4 py-3"
            >
              <span className="w-6 shrink-0 text-sm tabular-nums text-muted-foreground">
                {mod.moduleNumber}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium">{mod.title}</span>
                <span className="block text-xs text-muted-foreground">
                  Days {mod.dayRange.from}–{mod.dayRange.to} · {mod.note}
                  {mod.evidenceRefs.length > 0
                    ? ` · ${mod.evidenceRefs.join(", ")}`
                    : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                {mod.score === null ? (
                  <span className="text-sm text-muted-foreground">
                    not assessed
                  </span>
                ) : (
                  <span className="font-display text-xl font-bold tabular-nums">
                    {mod.score}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------------------------------------------- competencies */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Competencies
        </h2>
        <ol className="divide-y border-y">
          {report.competencies.map((comp) => (
            <li key={comp.competency} className="py-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-medium">{comp.label}</span>
                <span className="font-display text-xl font-bold tabular-nums">
                  {comp.score}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    weight {comp.weight}%
                  </span>
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {comp.justification}
                {comp.evidenceRefs.length > 0
                  ? ` · ${comp.evidenceRefs.join(", ")}`
                  : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------------- narrative */}
      <div className="grid gap-8 sm:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Strengths
          </h2>
          <ul className="space-y-3">
            {report.strengths.map((item, i) => (
              <li key={i} className="text-sm leading-6">
                {item.text}
                <span className="mt-1 block text-xs text-muted-foreground">
                  {item.evidenceRefs.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Areas to improve
          </h2>
          <ul className="space-y-3">
            {report.improvements.map((item, i) => (
              <li key={i} className="text-sm leading-6">
                {item.text}
                <span className="mt-1 block text-xs text-muted-foreground">
                  {item.evidenceRefs.join(", ")}
                  {item.suggestedDays.length > 0
                    ? ` · revisit day ${item.suggestedDays.join(", ")}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ---------------------------------------------- beyond the milestone */}
      {report.beyondMilestone.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Beyond the milestone — asked, not scored
          </h2>
          {report.beyondMilestone.map((row) => (
            <div key={row.questionId} className="border-l-2 pl-4">
              <p className="text-sm font-medium">{row.question}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                &ldquo;{row.answerExcerpt}&rdquo;
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{row.note}</p>
            </div>
          ))}
        </section>
      ) : null}

      {/* -------------------------------------------------------- evidence */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Evidence — every answer this report is built on
        </h2>
        {answered.map((row) => (
          <article key={row.questionId} className="space-y-2 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              {row.questionId} · {row.mode.toLowerCase()} ·{" "}
              {row.competency.replace(/_/g, " ").toLowerCase()} · module{" "}
              {row.moduleNumber ?? "—"} · days {row.sourceDays.join(", ")}
              {row.depthReached > 1 ? ` · reached depth ${row.depthReached}` : ""}
              {row.tier === "EXTENSION" ? " · extension" : ""}
            </p>
            <p className="text-sm font-medium">{row.question}</p>
            <p className="text-sm text-muted-foreground">
              &ldquo;{row.answerExcerpt}&rdquo;
            </p>
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <p className="font-semibold uppercase tracking-wide text-muted-foreground">
                  Covered
                </p>
                <ul className="mt-1 space-y-0.5">
                  {row.matched.length > 0 ? (
                    row.matched.map((m, i) => <li key={i}>{m}</li>)
                  ) : (
                    <li className="text-muted-foreground">nothing</li>
                  )}
                </ul>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wide text-muted-foreground">
                  Missed
                </p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {row.missing.length > 0 ? (
                    row.missing.map((m, i) => <li key={i}>{m}</li>)
                  ) : (
                    <li>nothing</li>
                  )}
                </ul>
              </div>
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">
              score {row.score}
            </p>
          </article>
        ))}
      </section>

      {/* --------------------------------------------------------- summary */}
      <section className="space-y-3 border-t pt-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Interview summary
        </h2>
        <p className="text-sm leading-6">{report.summary}</p>

        <h2 className="pt-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Recommendation
        </h2>
        <p className="text-sm leading-6">{report.recommendation}</p>

        {report.narrativeDegraded ? (
          <p className="pt-2 text-xs text-muted-foreground">
            The written sections were generated from the recorded evidence
            because the narrative model was unavailable. Scores are unaffected —
            they are always computed in code.
          </p>
        ) : null}
      </section>

      <div className="flex gap-3">
        <Link
          href="/program/dashboard"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
