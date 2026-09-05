"use client";

import { useEffect, useState } from "react";
import type { EventCollector } from "@/features/interview/proctoring/collector";
import {
  labelOf,
  PROCTOR_EVENT_KINDS,
  type ProctorEvent,
  type ProctorEventKind,
} from "@/features/interview/proctoring/types";

/**
 * The development-only proctoring simulator.
 *
 * WHY IT EXISTS. Four of the thirteen event kinds come from detectors that do
 * not exist yet, and two more (a denied camera, a lost camera) are awkward to
 * reproduce by hand on demand. Without a way to inject them, the second half of
 * the pipeline — warning, collection, debounce, submission, storage, summary,
 * report — could not be exercised at all until a real detector arrived, which
 * is the wrong order to find out that the column stores the wrong shape.
 *
 * With it, every kind can be pushed through the REAL collector, on a REAL
 * attempt, and read back off the REAL report. Nothing here is a mock of the
 * pipeline; it is only a mock of the sensor.
 *
 * HOW IT IS GATED. Two conditions, both required: a non-production build AND
 * `?debug=proctor` in the URL. The second is what stops it appearing for a
 * developer who is doing something else; the first is what makes it impossible
 * to reach in production regardless of the URL, because the branch is dead code
 * under `NODE_ENV=production` and the bundler drops it.
 */

export function isProctorDebugEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "proctor";
}

export function DevProctorPanel({
  collector,
  cameraStatus,
}: {
  collector: EventCollector;
  cameraStatus: string;
}) {
  const [log, setLog] = useState<ProctorEvent[]>([]);
  const [buffered, setBuffered] = useState(0);
  const [open, setOpen] = useState(true);

  // Polled rather than subscribed. The collector's `onEvent` is already wired to
  // the session's warning toasts, and a second subscription channel added for a
  // dev panel would be a production seam existing only for development.
  useEffect(() => {
    const timer = setInterval(() => {
      setLog(collector.history().slice(-12).reverse());
      setBuffered(collector.size());
    }, 500);
    return () => clearInterval(timer);
  }, [collector]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-50 rounded-[8px] bg-black/80 px-3 py-1.5 text-[11px] font-medium text-white"
      >
        proctor sim
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 max-h-[70vh] w-[290px] overflow-y-auto rounded-[12px] border border-black/20 bg-white/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#8F8F8F]">
          Proctor simulator
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-[#8F8F8F] underline"
        >
          hide
        </button>
      </div>

      <p className="mt-1.5 text-[11px] text-[#4B4B4B]">
        camera: <span className="font-mono">{cameraStatus}</span> · buffered:{" "}
        <span className="font-mono">{buffered}</span>
      </p>
      <p className="mt-1 text-[10px] leading-snug text-[#8F8F8F]">
        Simulated events go through the real collector and are saved with your
        next answer. Vision and audio kinds have no detector behind them yet.
      </p>

      <div className="mt-2.5 grid grid-cols-2 gap-1">
        {PROCTOR_EVENT_KINDS.map((kind: ProctorEventKind) => (
          <button
            key={kind}
            type="button"
            onClick={() =>
              collector.push(kind, {
                confidence: 0.5,
                detail: "SimulatedEvent",
              })
            }
            title={labelOf(kind)}
            className="truncate rounded-[6px] border border-[#E0E0E0] px-1.5 py-1 text-left font-mono text-[10px] text-[#111111] transition-colors hover:bg-[#F5F5F5]"
          >
            {kind}
          </button>
        ))}
      </div>

      <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#8F8F8F]">
        Recent
      </p>
      <ul className="mt-1 space-y-0.5">
        {log.length === 0 ? (
          <li className="text-[11px] text-[#8F8F8F]">nothing yet</li>
        ) : (
          log.map((event, index) => (
            <li
              key={`${event.kind}-${event.at}-${index}`}
              className="font-mono text-[10px] text-[#4B4B4B]"
            >
              {new Date(event.at).toLocaleTimeString("en-GB")} {event.kind}
              {event.count > 1 ? ` x${event.count}` : ""} ({event.severity})
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
