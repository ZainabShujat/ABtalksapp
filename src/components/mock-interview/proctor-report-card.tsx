import { Camera, ShieldCheck } from "lucide-react";
import type {
  ProctorSeverity,
  ProctorSummary,
} from "@/features/interview/proctoring/types";

/**
 * The proctoring section of a mock interview report.
 *
 * Server Component, like the rest of the report — there is nothing to interact
 * with here either.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not score, rank, flag, or conclude.
 * There is no integrity number, no threshold, and no sentence anywhere in this
 * file that tells the reader what the events mean, because v0.1 has browser
 * signals and nothing else: a hidden tab is a hidden tab. The heading says
 * "Session observations" rather than anything stronger for the same reason.
 *
 * Additive by construction: a report with no recorded events renders the clean
 * state, and a report from before proctoring existed renders exactly the same
 * thing, because "no events" and "no data" are the same summary.
 */

const CARD = "rounded-[16px] border border-[#E0E0E0] bg-white p-5";

/** Colour only. There is deliberately no severity WORDING in the report. */
const SEVERITY_DOT: Record<ProctorSeverity, string> = {
  info: "#8F8F8F",
  warning: "#E0A526",
  critical: "#C9282B",
};

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProctorReportCard({ summary }: { summary: ProctorSummary }) {
  const clean = summary.totalEvents === 0;

  return (
    <section className={CARD}>
      <div className="flex items-start gap-2.5">
        <ShieldCheck
          className="mt-0.5 size-4 shrink-0 text-[#8F8F8F]"
          strokeWidth={1.75}
        />
        <div>
          <h3 className="font-display text-[17px] font-bold tracking-tight text-[#111111]">
            Session observations
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[#8F8F8F]">
            Signals your browser reported during the interview. They are a
            record of what happened on the page, not a judgement, and they do
            not affect your score.
          </p>
        </div>
      </div>

      {clean ? (
        <p className="mt-4 text-[14px] text-[#4B4B4B]">
          Nothing was recorded during this interview.
        </p>
      ) : (
        <>
          {/* ----------------------------------------------------- roll-up */}
          <ul className="mt-4 space-y-2">
            {summary.byKind.map((tally) => (
              <li
                key={tally.kind}
                className="flex items-center justify-between gap-3 border-b border-[#F0F0F0] pb-2 last:border-0 last:pb-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: SEVERITY_DOT[tally.severity],
                    }}
                  />
                  <span className="truncate text-[14px] text-[#111111]">
                    {tally.label}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[13px] text-[#4B4B4B]">
                  {tally.count}
                </span>
              </li>
            ))}
          </ul>

          {/* ---------------------------------------------------- timeline */}
          {summary.timeline.length > 0 ? (
            <div className="mt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8F8F8F]">
                When
              </p>
              <ul className="mt-2 space-y-1.5">
                {summary.timeline.map((entry, index) => (
                  <li
                    key={`${entry.kind}-${entry.at}-${index}`}
                    className="flex items-baseline gap-2.5 text-[13px]"
                  >
                    <span className="shrink-0 font-mono text-[12px] text-[#8F8F8F]">
                      {timeOf(entry.at)}
                    </span>
                    <span className="text-[#4B4B4B]">
                      {entry.label}
                      {entry.count > 1 ? ` (${entry.count}x)` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      {/* ------------------------------------------------------ camera line */}
      <div className="mt-5 flex items-center gap-2 rounded-[10px] bg-[#FAFAFA] px-3 py-2">
        <Camera className="size-3.5 shrink-0 text-[#8F8F8F]" strokeWidth={1.75} />
        <p className="text-[12px] text-[#4B4B4B]">
          {summary.cameraEverActive
            ? `Camera ran for about ${Math.max(1, Math.round(summary.cameraActiveSeconds / 60))} min`
            : "Camera was not running"}
          {summary.cameraErrors > 0
            ? ` · ${summary.cameraErrors} camera issue${summary.cameraErrors === 1 ? "" : "s"}`
            : ""}
        </p>
      </div>
    </section>
  );
}
