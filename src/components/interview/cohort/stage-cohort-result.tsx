"use client";

import { useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { BLUEPRINT_LABEL } from "@/features/interview/cohort/blueprint";
import { RUBRIC } from "@/features/interview/rubric";
import type { FinishInterviewData } from "@/features/interview/provider";
import type { InterviewBlueprintKey } from "@/features/interview/cohort-eligibility";
import type { EvidenceTier } from "@/features/interview/types";
import { ChevronDown, ChevronUp } from "lucide-react";

const TIER_LABEL: Record<EvidenceTier, string> = {
  NONE: "No evidence",
  CLAIMED: "Claimed",
  EXPLAINED: "Explained",
  DEMONSTRATED: "Demonstrated",
};

const TIER_COLOR: Record<EvidenceTier, string> = {
  NONE: "text-foreground/40",
  CLAIMED: "text-amber-600",
  EXPLAINED: "text-blue-600",
  DEMONSTRATED: "text-emerald-600",
};

/**
 * Mock evidence data for the report. Will be replaced with real data from the
 * backend when the report assembly is connected.
 */
const MOCK_STRENGTHS = [
  "Strong understanding of retrieval-augmented generation. Articulated when to prefer retrieval over fine-tuning and discussed freshness trade-offs with precision.",
  "Demonstrated practical reasoning about system architecture. Named specific tools, explained choices, and described failure recovery.",
  "Excellent communication clarity — structured answers that addressed the question directly without prompting.",
];

const MOCK_IMPROVEMENTS = [
  "Evaluation methodology could be strengthened. Consider exploring metrics beyond cosine similarity for retrieval quality.",
  "Edge-case reasoning was occasionally vague — practice walking through specific failure scenarios end to end.",
];

const MOCK_EVIDENCE = [
  {
    competency: "Technical Depth",
    quote:
      "I implemented a versioning check so stale embeddings don't get served. The vector store is rebuilt when documents change, but the original documents remain the source of truth.",
    question: "How did you approach building the retrieval pipeline?",
  },
  {
    competency: "Problem Solving",
    quote:
      "I added a minimum similarity threshold — if no chunk passes 0.7 cosine similarity, the system responds with an honest 'I don't have enough information' rather than hallucinating.",
    question: "What happens if none of the retrieved chunks are relevant?",
  },
  {
    competency: "Practical Application",
    quote:
      "I started by including everything, but that hit token limits and reduced quality. So I implemented a relevance scoring step — top 3 chunks by similarity.",
    question: "How did you decide what context to include in your prompts?",
  },
];

const MOCK_MODULES = [
  { name: "Module 1 — LLM Foundations", score: 88 },
  { name: "Module 2 — Retrieval Systems", score: 81 },
  { name: "Module 3 — Prompt Engineering", score: 86 },
  { name: "Module 4 — Evaluation & Deployment", score: 78 },
];

/**
 * REPORT SCREEN — Professional assessment report.
 *
 * Uses AB Talks design tokens. Shows overall score, competency breakdown,
 * module performance, strengths, improvements, and expandable evidence.
 */
export function StageCohortResult({
  result,
  blueprint,
  candidateName,
}: {
  result: FinishInterviewData | null;
  blueprint: InterviewBlueprintKey;
  candidateName: string;
}) {
  const [expandedEvidence, setExpandedEvidence] = useState<number | null>(null);

  if (!result) {
    return (
      <section className="border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">No result</span>
        <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
          This interview did not produce a score
        </h2>
        <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
          Your milestone was not consumed. You can start again.
        </p>
      </section>
    );
  }

  const { scores } = result;
  const labelFor = (competency: string) =>
    RUBRIC.find((r) => r.competency === competency)?.label ?? competency;
  const weightFor = (competency: string) =>
    RUBRIC.find((r) => r.competency === competency)?.weight ?? 0;

  const now = new Date();
  const formattedDate = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const durationMin = Math.round((result.durationSec ?? 0) / 60);

  return (
    <div style={{ animation: "iv-fade-in 0.5s ease-out" }}>
      {/* ───── Report Header ───── */}
      <section className="poster px-6 py-8 md:px-10 md:py-10">
        <span
          className="block text-[13px] font-extrabold uppercase leading-[14px] tracking-[0.08em]"
          style={{ color: "hsl(var(--background) / 0.6)" }}
        >
          AI Cohort Interview · Assessment Report
        </span>

        <h1
          className="mt-4 font-extrabold tracking-[-0.03em]"
          style={{
            fontSize: "clamp(28px, 4vw, 44px)",
            lineHeight: 1.1,
            marginLeft: "-0.04em",
          }}
        >
          {BLUEPRINT_LABEL[blueprint]}
        </h1>

        {/* Candidate info */}
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-1 text-[14px]" style={{ color: "hsl(var(--background) / 0.65)" }}>
          <span><strong className="font-bold" style={{ color: "hsl(var(--background) / 0.85)" }}>Candidate</strong> {candidateName}</span>
          <span><strong className="font-bold" style={{ color: "hsl(var(--background) / 0.85)" }}>Date</strong> {formattedDate}</span>
          {durationMin > 0 && (
            <span><strong className="font-bold" style={{ color: "hsl(var(--background) / 0.85)" }}>Duration</strong> {durationMin} min</span>
          )}
        </div>
      </section>

      {/* ───── Overall Score ───── */}
      <section className="mt-0 border-2 border-[hsl(var(--divider)/0.4)] px-6 py-8 md:px-10">
        <span className="kicker">Overall Assessment</span>
        <div className="mt-4 flex items-baseline gap-4">
          <span
            className="font-extrabold tracking-[-0.04em] text-primary"
            style={{ fontSize: "clamp(48px, 6vw, 72px)", lineHeight: 1, marginLeft: "-0.05em" }}
          >
            {scores.overallScore}
          </span>
          <span className="text-[22px] font-bold text-foreground/40">/100</span>
        </div>
        {scores.summary && (
          <p className="mt-4 max-w-[62ch] text-[16px] leading-7 text-foreground/78">
            {scores.summary}
          </p>
        )}
      </section>

      {/* ───── Module Performance ───── */}
      <section className="mt-8">
        <span className="kicker">Module Performance</span>
        <div className="lattice mt-4 grid grid-cols-1 sm:grid-cols-2">
          {MOCK_MODULES.map((mod) => (
            <div key={mod.name} className="px-5 py-5 flex items-center justify-between gap-4">
              <span className="text-[15px] font-bold leading-6 flex-1 min-w-0">
                {mod.name}
              </span>
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-[100px] h-2 border-2 border-[hsl(var(--divider)/0.3)]">
                  <div
                    className="h-full bg-primary transition-all duration-700"
                    style={{ width: `${mod.score}%` }}
                  />
                </div>
                <span className="text-[16px] font-extrabold w-[32px] text-right tabular-nums">
                  {mod.score}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ───── Core Competencies ───── */}
      <section className="mt-8">
        <span className="kicker">Core Competencies</span>
        <div className="lattice mt-4 grid grid-cols-1">
          {scores.perCompetency.map((entry) => (
            <div
              key={entry.competency}
              className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-5"
            >
              <span className="w-[220px] shrink-0 text-[15px] font-extrabold leading-7">
                {labelFor(entry.competency)}
                <span className="ml-2 font-normal text-foreground/45 text-[13px]">
                  {weightFor(entry.competency)}%
                </span>
              </span>

              <span className={`w-[110px] shrink-0 text-[14px] leading-6 font-medium ${TIER_COLOR[entry.tier]}`}>
                {TIER_LABEL[entry.tier]}
              </span>

              <span className="flex-1 min-w-[120px]">
                <span className="block h-2.5 w-full border-2 border-[hsl(var(--divider)/0.3)]">
                  <span
                    className="block h-full bg-primary transition-all duration-700"
                    style={{ width: `${entry.score}%` }}
                  />
                </span>
              </span>

              <span className="w-[50px] shrink-0 text-right text-[16px] font-extrabold leading-7 tabular-nums">
                {entry.score}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ───── Strengths ───── */}
      <section className="mt-8 border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">Strengths</span>
        <ul className="mt-4 space-y-3">
          {MOCK_STRENGTHS.map((s, i) => (
            <li key={i} className="flex gap-3 text-[15.5px] leading-7 text-foreground/78">
              <span className="mt-2 block size-1.5 shrink-0 rounded-full bg-emerald-500" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ───── Areas to Improve ───── */}
      <section className="mt-6 border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">Areas to Improve</span>
        <ul className="mt-4 space-y-3">
          {MOCK_IMPROVEMENTS.map((s, i) => (
            <li key={i} className="flex gap-3 text-[15.5px] leading-7 text-foreground/78">
              <span className="mt-2 block size-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ───── Evidence ───── */}
      <section className="mt-8">
        <span className="kicker">Evidence</span>
        <div className="mt-4 space-y-0">
          {MOCK_EVIDENCE.map((ev, i) => (
            <div
              key={i}
              className="border-2 border-[hsl(var(--divider)/0.4)] border-b-0 last:border-b-2"
            >
              <button
                type="button"
                className="w-full px-5 py-4 flex items-center justify-between text-left focus-spark"
                onClick={() => setExpandedEvidence(expandedEvidence === i ? null : i)}
              >
                <div>
                  <span className="text-[14px] font-extrabold text-primary">
                    {ev.competency}
                  </span>
                  <span className="block mt-0.5 text-[14px] text-foreground/55 line-clamp-1">
                    {ev.question}
                  </span>
                </div>
                {expandedEvidence === i ? (
                  <ChevronUp className="size-4 text-foreground/40 shrink-0 ml-3" />
                ) : (
                  <ChevronDown className="size-4 text-foreground/40 shrink-0 ml-3" />
                )}
              </button>
              {expandedEvidence === i && (
                <div
                  className="px-5 pb-5 border-t border-[hsl(var(--divider)/0.15)]"
                  style={{ animation: "iv-fade-in 0.25s ease-out" }}
                >
                  <p className="pt-4 text-[15px] leading-7 text-foreground/70 italic">
                    &ldquo;{ev.quote}&rdquo;
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ───── Final Summary ───── */}
      <section className="mt-8 border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">Summary</span>
        <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
          {scores.summary ||
            "This candidate demonstrated solid understanding across core competencies with particular strength in practical application and technical reasoning. Further development recommended in evaluation methodology and edge-case analysis."}
        </p>
      </section>

      {/* ───── Actions ───── */}
      <section className="mt-8 border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">What happens next</span>
        <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
          This score is yours. It is not shown to recruiters unless you choose to
          release it. Your assessment is stored on your profile as evidence of your
          capability.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/program/dashboard" className={buttonVariants()}>
            Back to dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
