import type { InterviewReportDocument } from "@/features/interview/report-assembly";
import {
  CheckCircle2,
  AlertTriangle,
  Circle,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  BrainCircuit,
  MessageSquare,
  Wrench,
} from "lucide-react";

/**
 * The assessment report, as an evaluator reads it.
 * Presentation layer redesigned for an Executive Evaluator persona.
 */

const LEVEL_STYLE: Record<string, string> = {
  STRONG: "border-[#6AE276]/40 bg-[#6AE276]/10 text-[#6AE276]",
  DEVELOPING: "border-[#E2C56A]/40 bg-[#E2C56A]/10 text-[#E2C56A]",
  WEAK: "border-[#F98080]/40 bg-[#F98080]/10 text-[#F98080]",
  NOT_DEMONSTRATED: "border-[#F98080]/30 bg-[#F98080]/5 text-[#F98080]/85",
  NOT_ASSESSED: "border-[var(--iv-border)] bg-white/5 text-[var(--iv-text-faint)]",
};

const STRENGTH_LABEL: Record<string, string> = {
  STRONG: "Strong",
  PARTIAL: "Developing",
  WEAK: "Weak",
  OFF_TOPIC: "Off Topic",
  UNANSWERED: "Not Reached",
  NOT_JUDGED: "Not Assessed",
};

function Score({ value, size = "md" }: { value: number; size?: "md" | "lg" | "xl" }) {
  return (
    <span
      className={
        size === "xl"
          ? "font-display text-[56px] font-bold tabular-nums text-white leading-none"
          : size === "lg"
            ? "font-display text-4xl font-bold tabular-nums text-white"
            : "font-display text-xl font-bold tabular-nums text-[var(--iv-text)]"
      }
    >
      {value.toFixed(1)}
      <span
        className={
          size === "xl"
            ? "ml-1 text-2xl font-normal text-[var(--iv-text-faint)]"
            : size === "lg"
              ? "ml-1 text-xl font-normal text-[var(--iv-text-faint)]"
              : "ml-1 text-xs font-normal text-[var(--iv-text-faint)]"
        }
      >
        /10
      </span>
    </span>
  );
}

function Meter({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value * 10));
  const tone = value >= 7 ? "#6AE276" : value >= 4.5 ? "#E2C56A" : "#F98080";
  return (
    <span className="mt-2 block h-1 w-full rounded-full bg-white/5">
      <span
        className="block h-1 rounded-full"
        style={{ width: `${pct}%`, backgroundColor: tone }}
      />
    </span>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-6">
      <div className="border-b border-[var(--iv-border)] pb-3">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.15em] text-[var(--iv-text-muted)]">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1.5 text-[14px] text-[var(--iv-text-faint)]">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[14px] border border-[var(--iv-border)] bg-[#0A0D14] p-5 ${className}`}>
      {children}
    </div>
  );
}

export function InterviewReportView({
  report,
  generatedAt,
}: {
  report: InterviewReportDocument;
  generatedAt: Date;
}) {
  const assessedModules = report.modules.filter((m) => m.assessed);
  const unassessedModules = report.modules.filter((m) => !m.assessed);
  
  const strongSkills = report.skills.filter((s) => s.level === "STRONG");
  const developingSkills = report.skills.filter((s) => s.level === "DEVELOPING");
  const weakSkills = report.skills.filter((s) => s.level === "WEAK");
  const notDemonstratedSkills = report.skills.filter((s) => s.level === "NOT_DEMONSTRATED");

  const readinessColor = 
    report.overall.readiness.toLowerCase().includes("strong") ? "text-[#6AE276]" :
    report.overall.readiness.toLowerCase().includes("promising") ? "text-[#6AE276]" :
    report.overall.readiness.toLowerCase().includes("developing") ? "text-[#E2C56A]" : "text-[#F98080]";

  return (
    <div className="interview-room mx-auto max-w-5xl space-y-20 pb-24 pt-8 text-[var(--iv-text)]">
      
      {/* ================================================== */}
      {/* LEVEL 1 — 10-SECOND EXECUTIVE SUMMARY              */}
      {/* ================================================== */}
      
      <header className="space-y-8">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-[#968BEC]">
            AI Cohort Interview Report
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white md:text-4xl">
            {report.candidate.name}
          </h1>
          <p className="mt-2 text-[15px] text-[var(--iv-text-muted)]">
            {report.milestone.label} · {report.candidate.cohort}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          
          {/* Main Score & Readiness */}
          <div className="col-span-1 md:col-span-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--iv-text-faint)] mb-2">
              Overall Score
            </p>
            <Score value={report.overall.scoreOutOfTen} size="xl" />
            
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--iv-text-faint)] mb-1">
                Readiness
              </p>
              <span className={`text-lg font-semibold tracking-wide ${readinessColor}`}>
                {report.overall.readiness}
              </span>
            </div>
          </div>
          
          {/* Executive Assessment */}
          <div className="col-span-1 md:col-span-2 space-y-6">
            <div className="text-[16px] leading-relaxed text-[var(--iv-text-muted)] font-medium">
              {report.summary}
            </div>
            
            {/* Competency Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {report.competencies.map((c) => (
                <div key={c.competency} className="rounded-[10px] border border-[var(--iv-border)] bg-white/[0.02] p-4">
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-[13px] font-medium text-white">{c.label}</span>
                    <span className="font-display text-[15px] font-bold text-white">{c.scoreOutOfTen.toFixed(1)}</span>
                  </div>
                  <Meter value={c.scoreOutOfTen} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Key Strengths & Weaknesses (Scannable) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-white/5">
          <div>
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-[#6AE276] mb-3 flex items-center gap-2">
              <CheckCircle2 className="size-4" /> Key Strengths
            </h3>
            <ul className="space-y-2">
              {strongSkills.slice(0, 5).map((s, i) => (
                <li key={i} className="text-[14px] text-[var(--iv-text-muted)] leading-snug">
                  {s.skill}
                </li>
              ))}
              {strongSkills.length === 0 && <li className="text-[13px] text-[var(--iv-text-faint)]">None explicitly demonstrated</li>}
            </ul>
          </div>
          
          <div>
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-[#E2C56A] mb-3 flex items-center gap-2">
              <AlertTriangle className="size-4" /> Developing / Weak
            </h3>
            <ul className="space-y-2">
              {[...developingSkills, ...weakSkills].slice(0, 5).map((s, i) => (
                <li key={i} className="text-[14px] text-[var(--iv-text-muted)] leading-snug">
                  {s.skill}
                </li>
              ))}
              {developingSkills.length === 0 && weakSkills.length === 0 && <li className="text-[13px] text-[var(--iv-text-faint)]">None identified</li>}
            </ul>
          </div>

          <div>
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-[var(--iv-text-faint)] mb-3 flex items-center gap-2">
              <Circle className="size-4" /> Expected but Missing
            </h3>
            <ul className="space-y-2">
              {report.expectedButNotDemonstrated.slice(0, 5).map((s, i) => (
                <li key={i} className="text-[14px] text-[var(--iv-text-muted)] leading-snug">
                  {s.skill}
                </li>
              ))}
              {report.expectedButNotDemonstrated.length === 0 && <li className="text-[13px] text-[var(--iv-text-faint)]">Nothing missing</li>}
            </ul>
          </div>
        </div>
      </header>


      {/* ================================================== */}
      {/* LEVEL 2 — "WHY?" (MODULES & SKILLS)                */}
      {/* ================================================== */}
      
      <Section title="Module Performance">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {assessedModules.map((m) => (
            <Card key={m.moduleNumber} className="flex flex-col h-full">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-[15px] font-semibold text-white">Module {m.moduleNumber}</h3>
                  <p className="text-[13px] text-[var(--iv-text-faint)] mt-1">{m.title}</p>
                </div>
                <div className="text-right">
                  <Score value={m.scoreOutOfTen ?? 0} />
                  <p className={`text-[11px] font-bold uppercase mt-1 ${
                    (m.scoreOutOfTen ?? 0) >= 7 ? "text-[#6AE276]" : (m.scoreOutOfTen ?? 0) >= 4.5 ? "text-[#E2C56A]" : "text-[#F98080]"
                  }`}>
                    {(m.scoreOutOfTen ?? 0) >= 7 ? "Strong" : (m.scoreOutOfTen ?? 0) >= 4.5 ? "Developing" : "Weak"}
                  </p>
                </div>
              </div>
              
              <p className="text-[14px] leading-relaxed text-[var(--iv-text-muted)] mb-5">
                {m.note}
              </p>

              <div className="grid grid-cols-2 gap-4 mt-auto pt-4 border-t border-[var(--iv-border)]">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--iv-text-faint)] mb-2">Demonstrated</p>
                  <ul className="space-y-1">
                    {m.strengths.slice(0,3).map((s, i) => <li key={i} className="text-[13px] text-[#6AE276] flex gap-2"><span>✓</span><span className="text-[var(--iv-text-muted)]">{s}</span></li>)}
                  </ul>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--iv-text-faint)] mb-2">Development Areas</p>
                  <ul className="space-y-1">
                    {m.missingSkills.slice(0,3).map((s, i) => <li key={i} className="text-[13px] text-[#E2C56A] flex gap-2"><span>△</span><span className="text-[var(--iv-text-muted)]">{s}</span></li>)}
                  </ul>
                </div>
              </div>
            </Card>
          ))}
          
          {unassessedModules.length > 0 && (
             <div className="col-span-1 lg:col-span-2 rounded-[14px] border border-dashed border-[var(--iv-border)] p-5 bg-white/[0.01]">
               <h3 className="text-[13px] font-semibold text-white mb-2">Not Assessed</h3>
               <p className="text-[13px] text-[var(--iv-text-muted)]">
                 {unassessedModules.map(m => `Module ${m.moduleNumber} (${m.title})`).join(", ")}
               </p>
               <p className="text-[12px] text-[var(--iv-text-faint)] mt-2">
                 No questions were drawn from these modules during this specific milestone.
               </p>
             </div>
          )}
        </div>
      </Section>

      <Section title="Skill Assessment">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {(["STRONG", "DEVELOPING", "WEAK", "NOT_DEMONSTRATED"] as const).map((level) => {
             const list = report.skills.filter(s => s.level === level);
             if (list.length === 0) return null;
             return (
               <div key={level}>
                 <span className={`inline-flex rounded-[6px] border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${LEVEL_STYLE[level]}`}>
                    {level.replace(/_/g, " ").toLowerCase()}
                 </span>
                 <ul className="mt-4 space-y-3">
                   {list.map((s, i) => (
                     <li key={i} className="text-[14px] leading-relaxed text-[var(--iv-text-muted)] flex items-start gap-3">
                       <span className={`mt-0.5 ${level === 'STRONG' ? 'text-[#6AE276]' : level === 'DEVELOPING' ? 'text-[#E2C56A]' : 'text-[#F98080]'}`}>
                         {level === 'STRONG' ? '✓' : level === 'DEVELOPING' ? '△' : '○'}
                       </span>
                       <span>
                         <strong className="text-white font-medium">{s.skill}</strong> — {s.note}
                       </span>
                     </li>
                   ))}
                 </ul>
               </div>
             )
          })}
        </div>
      </Section>


      {/* ================================================== */}
      {/* LEVEL 3 — EVIDENCE / DEEP DIVE (QUESTIONS)         */}
      {/* ================================================== */}
      
      <Section title="Evidence & Deep Dive" subtitle="Expand any question to read the specific exchange and grading justification.">
        <div className="space-y-3">
          {report.questionAssessments.map((q, idx) => (
            <details key={q.questionId} className="group rounded-[12px] border border-[var(--iv-border)] bg-[#0A0D14] overflow-hidden [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer items-center justify-between p-4 md:p-5 hover:bg-white/[0.02] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent-500">
                <div className="flex items-center gap-4">
                  <div className="shrink-0 flex items-center justify-center size-8 rounded-full bg-white/5 text-[var(--iv-text-faint)] group-open:bg-[#968BEC]/20 group-open:text-[#968BEC] transition-colors">
                    <ChevronRight className="size-4 group-open:rotate-90 transition-transform duration-200" />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-semibold text-white">Q{q.order} · {q.moduleTitle ?? "General"}</h3>
                    <p className="text-[13px] text-[var(--iv-text-faint)] mt-1 truncate max-w-[200px] md:max-w-md">{q.question}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4 text-right">
                  <span className={`hidden sm:inline-flex rounded-[6px] border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                    LEVEL_STYLE[q.strength === "STRONG" ? "STRONG" : q.strength === "PARTIAL" ? "DEVELOPING" : q.strength === "UNANSWERED" || q.strength === "NOT_JUDGED" ? "NOT_ASSESSED" : "WEAK"]
                  }`}>
                    {STRENGTH_LABEL[q.strength]}
                  </span>
                  {q.judged ? (
                     <div className="w-16"><Score value={q.scoreOutOfTen} /></div>
                  ) : (
                     <div className="w-16 text-[13px] text-[var(--iv-text-faint)]">No score</div>
                  )}
                </div>
              </summary>
              
              <div className="border-t border-[var(--iv-border)] p-5 md:p-6 space-y-8 bg-[#05070A]">
                
                {/* 1. What was asked */}
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--iv-text-faint)] mb-2">What Was Assessed</h4>
                  <p className="text-[15px] leading-relaxed text-[var(--iv-text)]">{q.question}</p>
                </div>

                {/* 2. Candidate Answer Excerpt */}
                {q.answerExcerpt && (
                  <div>
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--iv-text-faint)] mb-2">Candidate Answer</h4>
                    <blockquote className="border-l-2 border-[var(--iv-border)] pl-4 text-[14px] leading-relaxed text-[var(--iv-text-muted)] italic">
                      &ldquo;{q.answerExcerpt}&rdquo;
                    </blockquote>
                  </div>
                )}

                {/* 3. Expected & Demonstrated */}
                {q.judged ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white/[0.02] p-5 rounded-[10px]">
                    <div>
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--iv-text-faint)] mb-3">Demonstrated</h4>
                      <ul className="space-y-2">
                        {q.demonstrated.map((item, i) => (
                          <li key={i} className="text-[13px] text-[var(--iv-text-muted)] flex gap-2"><span className="text-[#6AE276]">✓</span> {item}</li>
                        ))}
                        {q.partiallyDemonstrated.map((item, i) => (
                          <li key={`p-${i}`} className="text-[13px] text-[var(--iv-text-muted)] flex gap-2"><span className="text-[#E2C56A]">△</span> {item} <span className="text-[11px] text-[var(--iv-text-faint)]">(after probing)</span></li>
                        ))}
                        {q.demonstrated.length === 0 && q.partiallyDemonstrated.length === 0 && <li className="text-[13px] text-[var(--iv-text-faint)]">Nothing clearly demonstrated</li>}
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--iv-text-faint)] mb-3">Missing</h4>
                      <ul className="space-y-2">
                        {q.missing.map((item, i) => (
                          <li key={i} className="text-[13px] text-[var(--iv-text-muted)] flex gap-2"><span className="text-[#F98080]">○</span> {item}</li>
                        ))}
                        {q.missing.length === 0 && <li className="text-[13px] text-[var(--iv-text-faint)]">Nothing missing</li>}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white/[0.02] p-5 rounded-[10px]">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--iv-text-faint)] mb-3">Expected of this question</h4>
                    <ul className="space-y-2">
                      {q.expected.map((item, i) => (
                        <li key={i} className="text-[13px] text-[var(--iv-text-muted)] flex gap-2"><span className="text-[var(--iv-text-faint)]">•</span> {item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 4. Score Justification */}
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--iv-text-faint)] mb-2">
                    {q.judged ? "Why This Score" : "Why There Is No Score"}
                  </h4>
                  <p className="text-[14px] leading-relaxed text-[var(--iv-text-muted)]">{q.whyThisScore}</p>
                </div>

                {/* 5. Adaptive Follow-ups */}
                {q.probes.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--iv-text-faint)] mb-4">Adaptive Follow-ups</h4>
                    <div className="space-y-6 border-l border-[#968BEC]/30 ml-2 pl-6 relative">
                      {q.probes.map((p, pIdx) => (
                        <div key={p.level} className="relative">
                          <span className="absolute -left-[30px] top-1 size-[9px] rounded-full bg-[#968BEC]" />
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#968BEC] mb-2">
                            {p.mode === "CLARIFY" ? "Clarification Requested" : "Deep Probe"}
                          </p>
                          <p className="text-[14px] leading-relaxed text-[var(--iv-text)]">{p.question}</p>
                          {p.answerExcerpt && (
                            <blockquote className="mt-3 text-[13px] leading-relaxed text-[var(--iv-text-muted)] italic">
                              &ldquo;{p.answerExcerpt}&rdquo;
                            </blockquote>
                          )}
                          <p className="mt-3 text-[13px] font-medium text-[var(--iv-text-muted)]">
                            <span className="text-[var(--iv-text-faint)] mr-2">Outcome:</span> {p.outcome}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
              </div>
            </details>
          ))}
        </div>
      </Section>


      {/* ================================================== */}
      {/* AGENT INSIGHTS & TRANSCRIPT EVIDENCE               */}
      {/* ================================================== */}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {report.agentInsights.length > 0 && (
          <Section title="Agent Insights" subtitle="Behavioral & structural observations across the interview.">
            <div className="space-y-4">
              {report.agentInsights.map((insight, i) => (
                <Card key={i}>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--iv-text-faint)] mb-2">
                    {insight.label}
                  </p>
                  <p className="text-[14px] leading-relaxed text-[var(--iv-text-muted)]">
                    {insight.detail}
                  </p>
                </Card>
              ))}
            </div>
          </Section>
        )}

        {report.transcriptExcerpts.length > 0 && (
          <Section title="Transcript Excerpts" subtitle="Defining moments from the conversation.">
            <div className="space-y-4">
              {report.transcriptExcerpts.map((x, i) => (
                <Card key={i}>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--iv-text-faint)] mb-2">
                    {x.reason} <span className="lowercase font-normal opacity-50">from {x.questionId}</span>
                  </p>
                  <p className="text-[13px] text-[var(--iv-text-faint)] mb-3">
                    {x.question}
                  </p>
                  <blockquote className="border-l-2 border-[var(--iv-border)] pl-3 text-[14px] leading-relaxed text-[var(--iv-text-muted)] italic">
                    &ldquo;{x.answer}&rdquo;
                  </blockquote>
                </Card>
              ))}
            </div>
          </Section>
        )}

      </div>


      {/* ================================================== */}
      {/* FINAL RECOMMENDATION                               */}
      {/* ================================================== */}
      
      <Section title="Final Recommendation">
        <Card className="bg-gradient-to-br from-white/[0.03] to-transparent border-[#968BEC]/20">
          <p className={`text-xl font-bold tracking-wide ${readinessColor}`}>
            {report.overall.readiness}
          </p>
          <p className="mt-3 text-[16px] leading-relaxed text-[var(--iv-text)] font-medium">
            {report.recommendation}
          </p>

          {report.improvements.length > 0 && (
            <div className="mt-6 pt-6 border-t border-[var(--iv-border)]">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--iv-text-faint)] mb-3">
                Where to focus
              </p>
              <ul className="space-y-3">
                {report.improvements.map((item, i) => (
                  <li key={i} className="text-[14px] leading-relaxed flex items-start gap-3 text-[var(--iv-text-muted)]">
                    <span className="mt-1 text-[#E2C56A]"><ChevronRight className="size-4" /></span>
                    <span>
                      {item.text}
                      {item.suggestedDays.length > 0 && (
                        <span className="block mt-1 text-[12px] text-[var(--iv-text-faint)]">
                          Revisit day {item.suggestedDays.join(", ")}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </Section>


      {/* ================================================== */}
      {/* TECHNICAL AUDIT (COLLAPSED)                        */}
      {/* ================================================== */}
      
      <div className="pt-20">
        <details className="group [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wider text-[var(--iv-text-faint)] hover:text-white transition-colors flex items-center justify-center gap-2">
            Technical Audit & Metadata <ChevronDown className="size-4 group-open:rotate-180 transition-transform" />
          </summary>
          <div className="mt-6 p-6 rounded-[14px] border border-[var(--iv-border)] bg-black/20 text-[12px] text-[var(--iv-text-faint)] space-y-6">
            
            {report.assessmentStatus.status !== "NORMAL" && (
              <div className="border border-[#F98080]/30 bg-[#F98080]/10 text-[#F98080] p-4 rounded-lg">
                <span className="font-bold">Assessment Integrity Flag: {report.assessmentStatus.status}</span>
                <p className="mt-1">{report.assessmentStatus.note}</p>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="font-semibold text-[var(--iv-text-muted)] mb-1">Duration</p>
                <p className="tabular-nums">{Math.floor(report.overall.durationSec / 60)}m {report.overall.durationSec % 60}s</p>
              </div>
              <div>
                <p className="font-semibold text-[var(--iv-text-muted)] mb-1">Flow</p>
                <p className="tabular-nums">Asked: {report.overall.questionsAsked} / Answered: {report.overall.questionsAnswered}</p>
                <p className="tabular-nums">Follow-ups: {report.overall.followUpsAsked} / Redirects: {report.overall.redirectsIssued}</p>
              </div>
              <div>
                <p className="font-semibold text-[var(--iv-text-muted)] mb-1">Scope</p>
                <p className="tabular-nums">Days {report.milestone.scopeFrom}–{report.milestone.scopeTo}</p>
                {report.milestone.progressDay && <p className="tabular-nums">Progress Day: {report.milestone.progressDay}</p>}
              </div>
              <div>
                <p className="font-semibold text-[var(--iv-text-muted)] mb-1">System</p>
                <p>Report v{report.version} · Bank v{report.milestone.bankVersion}</p>
                <p>Generated: {generatedAt.toISOString().slice(0, 10)}</p>
              </div>
            </div>
            
          </div>
        </details>
      </div>

    </div>
  );
}
