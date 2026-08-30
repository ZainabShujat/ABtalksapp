"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  resetDemoInterviewAction,
  startDemoInterviewAction,
  submitDemoAnswerAction,
} from "@/app/actions/dev-interview-agent-actions";
import type { DemoView } from "@/features/interview/agent/demo-session";

/**
 * Developer demo UI for the LangGraph agent.
 *
 * The single rule this component follows: it NEVER decides anything. It holds
 * no action, no counter and no routing logic of its own — every value shown,
 * including the debug panel and the node trace, arrives from the server after a
 * real graph run. The preset buttons are text shortcuts, not shortcuts around
 * the graph: "Off-topic" sends an off-topic sentence and renders whatever the
 * policy actually decided to do with it.
 *
 * Styling is intentionally plain. This is a harness, not product UI.
 */

const NODE_ORDER = [
  "receiveAnswer",
  "analyzeAnswer",
  "routeResponse",
  "followUp",
  "nextQuestion",
  "redirect",
  "repeat",
  "updateState",
  "complete",
];

export function InterviewAgentDemo() {
  const [view, setView] = useState<DemoView | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const started = useRef(false);

  function start() {
    startTransition(async () => {
      const result = await startDemoInterviewAction({ blueprint: "DAY_15" });
      if (result.ok) {
        setView(result.data);
        setError(null);
      } else {
        setError(result.message);
      }
    });
  }

  // Open a session on first mount so the page is usable immediately.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start();
  }, []);

  function send(text: string) {
    if (!view || text.trim().length === 0) return;
    startTransition(async () => {
      const result = await submitDemoAnswerAction({
        sessionId: view.sessionId,
        answerText: text,
      });
      if (result.ok) {
        setView(result.data);
        setAnswer("");
        setError(null);
      } else {
        setError(result.message);
      }
    });
  }

  function reset() {
    startTransition(async () => {
      if (view) await resetDemoInterviewAction({ sessionId: view.sessionId });
      setAnswer("");
      setError(null);
      const result = await startDemoInterviewAction({ blueprint: "DAY_15" });
      if (result.ok) setView(result.data);
      else setError(result.message);
    });
  }

  const debug = view?.debug;

  return (
    <div className="min-h-svh bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header>
          <h1 className="text-xl font-semibold">AI Interview Agent</h1>
          <p className="text-sm text-slate-400">
            LangGraph demo · {view?.blueprintLabel ?? "loading…"} ·{" "}
            <span className="font-mono">provider: {debug?.provider ?? "—"}</span>
          </p>
        </header>

        {error ? (
          <p className="rounded border border-amber-600 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            {error}
          </p>
        ) : null}

        <div className="grid gap-6 md:grid-cols-[1fr_320px]">
          {/* ---------------------------------------------- conversation */}
          <section className="flex flex-col gap-4">
            <div className="rounded border border-slate-800 bg-slate-900 p-4">
              <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">
                Interviewer
                {view?.question
                  ? ` · question ${view.question.order} of ${view.question.total}`
                  : ""}
              </p>
              <p className="text-sm leading-relaxed">
                {view?.finished
                  ? "Interview complete."
                  : (view?.question?.text ?? "…")}
              </p>
            </div>

            <div className="rounded border border-slate-800 bg-slate-900">
              <p className="border-b border-slate-800 px-4 py-2 text-xs uppercase tracking-wide text-slate-500">
                Conversation
              </p>
              <div className="max-h-80 overflow-y-auto px-4 py-3">
                {(view?.transcript ?? []).map((line, i) => (
                  <p key={i} className="mb-2 text-sm leading-relaxed">
                    <span
                      className={
                        line.role === "interviewer"
                          ? "font-semibold text-sky-400"
                          : "font-semibold text-emerald-400"
                      }
                    >
                      {line.role === "interviewer" ? "Interviewer: " : "Candidate: "}
                    </span>
                    <span className="whitespace-pre-wrap text-slate-200">
                      {line.text}
                    </span>
                  </p>
                ))}
              </div>
            </div>

            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(answer);
              }}
              rows={4}
              disabled={pending || view?.finished}
              placeholder="Type an answer… (Ctrl+Enter to submit)"
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-600 disabled:opacity-50"
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => send(answer)}
                disabled={pending || answer.trim().length === 0 || view?.finished}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-40"
              >
                {pending ? "Running graph…" : "Submit"}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={pending}
                className="rounded border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-40"
              >
                Reset
              </button>
            </div>

            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                Presets — built for the question on the floor, sent through the graph
              </p>
              <div className="flex flex-wrap gap-2">
                {(view?.presets ?? []).map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    title={`${preset.note} — "${preset.text.slice(0, 60)}…"`}
                    onClick={() => send(preset.text)}
                    disabled={pending || view?.finished}
                    className="rounded border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800 disabled:opacity-40"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* ----------------------------------------------------- debug */}
          <aside className="flex flex-col gap-4">
            <div className="rounded border border-slate-800 bg-slate-900 p-4">
              <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">
                Agent debug
              </p>
              <dl className="space-y-1.5 font-mono text-xs">
                <Row label="Action" value={debug?.action ?? "—"} highlight />
                <Row
                  label="LLM proposed"
                  value={debug?.proposed ?? "—"}
                  warn={
                    !!debug?.action &&
                    !!debug?.proposed &&
                    debug.action !== debug.proposed
                  }
                />
                <Row label="Question" value={debug?.questionId ?? "—"} />
                <Row label="Follow-ups" value={debug?.followUps ?? "—"} />
                <Row label="Redirects" value={debug?.redirects ?? "—"} />
                <Row label="Repeats" value={debug?.repeats ?? "—"} />
                <Row label="Status" value={debug?.status ?? "—"} />
                <Row label="Evidence" value={String(debug?.evidenceCount ?? 0)} />
                <Row
                  label="Degraded"
                  value={debug?.degraded ? "yes (fallback)" : "no"}
                  warn={debug?.degraded}
                />
              </dl>
              {debug?.action &&
              debug.proposed &&
              debug.action !== debug.proposed ? (
                <p className="mt-3 rounded bg-amber-950/40 px-2 py-1.5 text-[11px] leading-snug text-amber-200">
                  Policy overrode the model: it asked for {debug.proposed}, the
                  interview did {debug.action}.
                </p>
              ) : null}
            </div>

            <div className="rounded border border-slate-800 bg-slate-900 p-4">
              <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">
                LangGraph nodes executed
              </p>
              <ul className="space-y-1 font-mono text-xs">
                {NODE_ORDER.map((node) => {
                  const ran = debug?.trace.includes(node) ?? false;
                  return (
                    <li
                      key={node}
                      className={ran ? "text-emerald-400" : "text-slate-600"}
                    >
                      {ran ? "✓" : "·"} {node}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-[11px] leading-snug text-slate-500">
                Reported by LangGraph&apos;s own update stream for the last turn —
                not hard-coded here.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={
          warn
            ? "text-amber-300"
            : highlight
              ? "font-semibold text-sky-300"
              : "text-slate-200"
        }
      >
        {value}
      </dd>
    </div>
  );
}
