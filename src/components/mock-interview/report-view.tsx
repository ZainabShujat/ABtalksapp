import { AlertTriangle, CheckCircle2, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssessmentReportDocument } from "@/features/interview/platform/report-assembly";
import type { ProctorSummary } from "@/features/interview/proctoring/types";
import { ProctorReportCard } from "@/components/mock-interview/proctor-report-card";

/**
 * The stored assessment report.
 *
 * Server Component, no client JavaScript — the cohort report page makes the
 * same choice, and for the same reason: a report is a record of an assessment
 * that already happened, so there is nothing to interact with.
 *
 * Every number rendered here was computed in `platform/scoring.ts` and frozen
 * into the document at completion. Nothing is recomputed at render time, so two
 * views of one attempt can never disagree.
 */

const CARD = "rounded-[16px] border border-[#E0E0E0] bg-white p-5";

function scoreColor(score: number): string {
  if (score >= 80) return "#1A7F37";
  if (score >= 60) return "#E05226";
  return "#C9282B";
}

function Bar({ score }: { score: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F0F0F0]">
      <div
        className="h-full rounded-full"
        style={{ width: `${score}%`, backgroundColor: scoreColor(score) }}
      />
    </div>
  );
}

export function MockInterviewReportView({
  report,
  generatedAt,
  proctoring = null,
}: {
  report: AssessmentReportDocument;
  generatedAt: Date;
  /**
   * Session observations for this attempt (Proctoring v0.1).
   *
   * Optional and defaulted, so every other caller of this component keeps
   * working unchanged and a report with no proctoring data renders exactly the
   * report it rendered before. Not part of the stored document: see the note in
   * `getAttemptProctoringSummary`.
   */
  proctoring?: ProctorSummary | null;
}) {
  const { overall, coverage } = report;

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------ overall */}
      <section className={cn(CARD, "bg-[#FFF5F0]")}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8F8F8F]">
              Attempt {coverage.attemptNumber}
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-[#111111]">
              {coverage.domainLabel}
            </h2>
            <p className="mt-1 text-[13px] text-[#8F8F8F]">
              {generatedAt.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              {" · "}
              {Math.round(overall.durationSec / 60)} min
              {" · "}
              {overall.questionsAnswered} of {overall.questionsAsked} answered
            </p>
          </div>
          <div className="text-right">
            <p
              className="font-display text-4xl font-bold leading-none"
              style={{ color: scoreColor(overall.score) }}
            >
              {overall.scoreOutOfTen.toFixed(1)}
              <span className="text-lg text-[#8F8F8F]">/10</span>
            </p>
            <p className="mt-1 text-[13px] font-semibold text-[#4B4B4B]">
              {overall.readiness}
            </p>
          </div>
        </div>

        {report.assessmentStatus.status !== "NORMAL" ? (
          <div className="mt-4 flex items-start gap-2.5 rounded-[10px] border border-[#E05226]/30 bg-[#FFECE3] p-3">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-[#E05226]"
              strokeWidth={2}
            />
            <p className="text-[13px] leading-relaxed text-[#4B4B4B]">
              {report.assessmentStatus.note}
            </p>
          </div>
        ) : null}
      </section>

      {/* --------------------------------------------------------- summary */}
      <section className={CARD}>
        <h3 className="text-[15px] font-semibold text-[#111111]">Summary</h3>
        <p className="mt-2 text-sm leading-relaxed text-[#4B4B4B]">
          {report.summary}
        </p>
        {report.recommendation ? (
          <>
            <h3 className="mt-5 text-[15px] font-semibold text-[#111111]">
              What to practise next
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[#4B4B4B]">
              {report.recommendation}
            </p>
          </>
        ) : null}
      </section>

      {/* ---------------------------------------------------- competencies */}
      <section>
        <h3 className="mb-3 text-lg font-semibold text-[#111111]">
          How you scored
        </h3>
        <div className="space-y-3">
          {report.competencies.map((c) => (
            <div key={c.competencyId} className={CARD}>
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-[14px] font-semibold text-[#111111]">
                  {c.label}
                </h4>
                <span className="shrink-0 text-[13px] font-semibold text-[#4B4B4B]">
                  {c.unassessed ? (
                    <span className="text-[#8F8F8F]">Not assessed</span>
                  ) : (
                    <>
                      {c.scoreOutOfTen.toFixed(1)}
                      <span className="text-[#8F8F8F]">/10</span>
                      <span className="ml-2 text-[12px] font-normal text-[#8F8F8F]">
                        {c.weight}% weight
                      </span>
                    </>
                  )}
                </span>
              </div>
              {!c.unassessed ? (
                <div className="mt-2.5">
                  <Bar score={c.score} />
                </div>
              ) : null}
              <p className="mt-2 text-[13px] leading-relaxed text-[#4B4B4B]">
                {c.justification}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- sections */}
      {report.sections.length > 0 ? (
        <section>
          <h3 className="mb-3 text-lg font-semibold text-[#111111]">
            By area
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {report.sections.map((s) => (
              <div key={s.sectionId} className={CARD}>
                <div className="flex items-baseline justify-between gap-3">
                  <h4 className="text-[14px] font-semibold text-[#111111]">
                    {s.label}
                  </h4>
                  <span className="shrink-0 text-[13px] font-semibold">
                    {s.score === null ? (
                      <span className="text-[#8F8F8F]">—</span>
                    ) : (
                      <span style={{ color: scoreColor(s.score) }}>
                        {s.score}
                      </span>
                    )}
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] text-[#8F8F8F]">{s.note}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------- strengths + improvements */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[#111111]">
            <CheckCircle2 className="size-4 text-[#1A7F37]" strokeWidth={2} />
            Strengths
          </h3>
          <ul className="mt-3 space-y-3">
            {report.strengths.map((s, i) => (
              <li key={i} className="text-sm leading-relaxed text-[#4B4B4B]">
                {s.text}
                {/* The citation is the point: an uncited claim was filtered out
                    before this document was stored. */}
                <span className="mt-1 block text-[12px] text-[#8F8F8F]">
                  From {s.evidenceRefs.join(", ")}
                </span>
              </li>
            ))}
            {report.strengths.length === 0 ? (
              <li className="text-sm text-[#8F8F8F]">
                Nothing was recorded here.
              </li>
            ) : null}
          </ul>
        </section>

        <section className={CARD}>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[#111111]">
            <Target className="size-4 text-[#E05226]" strokeWidth={2} />
            To work on
          </h3>
          <ul className="mt-3 space-y-3">
            {report.improvements.map((s, i) => (
              <li key={i} className="text-sm leading-relaxed text-[#4B4B4B]">
                {s.text}
                <span className="mt-1 block text-[12px] text-[#8F8F8F]">
                  From {s.evidenceRefs.join(", ")}
                </span>
              </li>
            ))}
            {report.improvements.length === 0 ? (
              <li className="text-sm text-[#8F8F8F]">
                Nothing was recorded here.
              </li>
            ) : null}
          </ul>
        </section>
      </div>

      {/* ------------------------------------------------------- your answers */}
      {report.evidence.some((e) => e.answered) ? (
        <section>
          <h3 className="mb-3 text-lg font-semibold text-[#111111]">
            Your answers
          </h3>
          <div className="space-y-3">
            {report.evidence
              .filter((e) => e.answered)
              .map((e) => (
                <details key={e.questionId} className={CARD}>
                  <summary className="cursor-pointer list-none">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-[14px] font-medium text-[#111111]">
                        {e.question}
                      </span>
                      <span
                        className="shrink-0 text-[13px] font-semibold"
                        style={{ color: scoreColor(e.score) }}
                      >
                        {e.score}
                      </span>
                    </span>
                  </summary>
                  <div className="mt-3 border-t border-[#E0E0E0] pt-3">
                    <p className="text-[12px] font-semibold uppercase tracking-wider text-[#8F8F8F]">
                      You said
                    </p>
                    <p className="mt-1 text-sm italic leading-relaxed text-[#4B4B4B]">
                      &ldquo;{e.answerExcerpt}&rdquo;
                    </p>

                    {e.matched.length > 0 ? (
                      <>
                        <p className="mt-3 text-[12px] font-semibold uppercase tracking-wider text-[#1A7F37]">
                          Covered
                        </p>
                        <ul className="mt-1 space-y-1">
                          {e.matched.map((m) => (
                            <li key={m} className="text-[13px] text-[#4B4B4B]">
                              &bull; {m}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}

                    {e.missing.length > 0 ? (
                      <>
                        <p className="mt-3 text-[12px] font-semibold uppercase tracking-wider text-[#8F8F8F]">
                          Missed
                        </p>
                        <ul className="mt-1 space-y-1">
                          {e.missing.map((m) => (
                            <li key={m} className="text-[13px] text-[#8F8F8F]">
                              &bull; {m}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </div>
                </details>
              ))}
          </div>
        </section>
      ) : null}

      {proctoring ? <ProctorReportCard summary={proctoring} /> : null}

      <p className="text-[12px] text-[#8F8F8F]">
        Report v{report.version} &middot; {coverage.packId} v
        {coverage.packVersion} &middot; rubric {coverage.rubricId}
      </p>
    </div>
  );
}
