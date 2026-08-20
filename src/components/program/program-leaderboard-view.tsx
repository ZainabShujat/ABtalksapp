"use client";

import type { ProgramLeaderboardRow } from "@/features/program/leaderboard";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
}

const PLACE_STYLES = {
  1: {
    avatar:
      "size-16 border-[3px] border-yellow-400 bg-[#5B4BDB] text-lg shadow-[0_0_22px_rgba(250,204,21,.45)] sm:size-[4.5rem]",
    badge: "size-7 bg-yellow-400 text-black",
    card: "min-h-[14rem] border-yellow-400/40 bg-gradient-to-b from-yellow-400/55 via-yellow-500/25 to-yellow-950/80 shadow-[0_12px_36px_rgba(250,204,21,.22)] sm:min-h-[16rem] lg:min-h-0 lg:flex-1",
    score: "text-2xl font-extrabold text-yellow-200 sm:text-3xl",
    name: "text-sm font-bold sm:text-base",
    emptyCard:
      "border-dashed border-yellow-400/25 bg-gradient-to-b from-yellow-400/15 via-yellow-500/5 to-transparent",
  },
  2: {
    avatar:
      "size-14 border-[3px] border-slate-300 bg-[#5B4BDB] text-base sm:size-16",
    badge: "size-6 bg-slate-200 text-slate-800",
    card: "min-h-[11rem] border-slate-300/35 bg-gradient-to-b from-slate-300/45 via-slate-500/20 to-slate-950/85 sm:min-h-[12.5rem] lg:min-h-0 lg:flex-[0.78]",
    score: "text-xl font-bold text-slate-100 sm:text-2xl",
    name: "text-xs font-semibold sm:text-sm",
    emptyCard:
      "border-dashed border-slate-400/25 bg-gradient-to-b from-slate-400/15 via-slate-500/5 to-transparent",
  },
  3: {
    avatar:
      "size-14 border-[3px] border-orange-400 bg-[#5B4BDB] text-base sm:size-16",
    badge: "size-6 bg-orange-400 text-black",
    card: "min-h-[9rem] border-orange-400/40 bg-gradient-to-b from-orange-400/50 via-orange-600/20 to-orange-950/85 sm:min-h-[10.5rem] lg:min-h-0 lg:flex-[0.62]",
    score: "text-xl font-bold text-orange-100 sm:text-2xl",
    name: "text-xs font-semibold sm:text-sm",
    emptyCard:
      "border-dashed border-orange-400/25 bg-gradient-to-b from-orange-400/15 via-orange-500/5 to-transparent",
  },
} as const;

function PodiumCard({
  row,
  place,
}: {
  row: ProgramLeaderboardRow | null;
  place: 1 | 2 | 3;
}) {
  const isFirst = place === 1;
  const filled = row !== null;
  const styles = PLACE_STYLES[place];

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-1 flex-col items-center justify-end",
        isFirst && "z-[1]",
      )}
    >
      <div className={cn("relative shrink-0", isFirst ? "mb-3" : "mb-2.5")}>
        {isFirst && (
          <div
            className={cn(
              "absolute -top-6 left-1/2 -translate-x-1/2 text-xl sm:text-2xl",
              !filled && "opacity-40 grayscale",
            )}
            aria-hidden
          >
            👑
          </div>
        )}

        <div
          className={cn(
            "flex items-center justify-center rounded-full font-bold text-white shadow-md transition-opacity",
            styles.avatar,
            !filled &&
              "border-dashed border-white/20 bg-[#1a2333] text-[#64748B] shadow-none",
          )}
        >
          {filled ? initials(row.fullName) : "—"}
        </div>

        <div
          className={cn(
            "absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-full text-xs font-bold shadow",
            styles.badge,
          )}
        >
          {place}
        </div>
      </div>

      <div
        className={cn(
          "flex w-full flex-col rounded-t-2xl border text-center",
          filled ? styles.card : cn(styles.card, styles.emptyCard, "opacity-90"),
        )}
      >
        <div className="flex flex-1 flex-col justify-start px-2.5 pt-4 pb-5 sm:px-3 sm:pt-5 sm:pb-6">
          <h3 className={cn("truncate text-white", styles.name)}>
            {filled ? row.fullName : "Awaiting challenger"}
          </h3>

          <p className="mt-1 truncate text-[10px] text-white/70 sm:text-xs">
            {filled ? `${row.company} · ${row.jobRole}` : "Open spot"}
          </p>

          <div className="mt-auto pt-6">
            <div
              className={cn(styles.score, !filled && "text-white/40")}
            >
              {filled ? row.totalScore.toLocaleString() : "—"}
            </div>
            <p className="mt-0.5 text-[10px] text-white/55 sm:text-xs">
              Total Score
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProgramLeaderboardView({
  rows,
}: {
  rows: ProgramLeaderboardRow[];
}) {
  const first = rows.find((r) => r.rank === 1) ?? null;
  const second = rows.find((r) => r.rank === 2) ?? null;
  const third = rows.find((r) => r.rank === 3) ?? null;
  const rest = rows.filter((r) => r.rank > 3);

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100svh-3.5rem)] flex-col overflow-hidden bg-[#040A12] px-6 py-6 text-white sm:px-8 md:px-10 lg:px-12">
      <header className="mb-5 shrink-0">
        <h1 className="font-display text-xl font-bold tracking-tight text-white md:text-2xl">
          Leaderboard
        </h1>
        <p className="mt-1 text-sm text-[#9CA3AF]">
          Sorted by total score, then projects, missions, enrollment date.
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden lg:flex-row lg:gap-8">
        {/* Top 3 — static */}
        <aside className="flex w-full shrink-0 flex-col overflow-hidden lg:h-full lg:w-[40%] lg:max-w-[40%]">
          <p className="mb-3 shrink-0 text-xs font-semibold tracking-wide text-[#64748B] uppercase">
            Top 3
          </p>
          <div className="relative flex min-h-[22rem] flex-1 flex-col overflow-hidden rounded-2xl border border-[#8365E3]/35 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(115,100,230,0.18),transparent_55%),linear-gradient(180deg,rgba(12,18,36,0.95)_0%,rgba(7,11,20,0.98)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:min-h-[26rem] sm:p-6 lg:min-h-0">
            <div
              className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#968BEC]/50 to-transparent"
              aria-hidden
            />
            <div className="flex h-full min-h-[18rem] flex-1 items-end justify-between gap-3 pt-8 sm:gap-4 sm:pt-10 lg:min-h-0">
              <PodiumCard row={second} place={2} />
              <PodiumCard row={first} place={1} />
              <PodiumCard row={third} place={3} />
            </div>
          </div>
        </aside>

        {/* Rankings — only this panel scrolls */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:w-[60%]">
          <p className="mb-3 shrink-0 text-xs font-semibold tracking-wide text-[#64748B] uppercase">
            Rankings
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto rounded-2xl border border-[#1E293B] bg-[#070B14]/80">
            {rows.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-[#9CA3AF]">
                No ranked members yet. Complete missions to appear on the board.
              </p>
            ) : (
              <>
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-[#0A0F1C]">
                    <tr className="border-b border-[#1E293B] text-xs font-semibold tracking-wide text-[#64748B] uppercase">
                      <th className="px-4 py-3">Rank</th>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Company</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3 text-center">Yrs</th>
                      <th className="px-4 py-3 text-center">M/C/P</th>
                      <th className="px-4 py-3 text-center">Clean%</th>
                      <th className="px-4 py-3 text-center">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rest.map((row) => (
                      <tr
                        key={row.memberId}
                        className={cn(
                          "border-b border-[#1E293B]/80 last:border-0",
                          row.isViewer && "bg-[#7364E6]/10",
                        )}
                      >
                        <td className="px-4 py-3 font-semibold text-white">
                          {row.rank}
                        </td>
                        <td className="px-4 py-3 text-white">{row.fullName}</td>
                        <td className="px-4 py-3 text-[#E2E8F0]">
                          {row.company}
                        </td>
                        <td className="px-4 py-3 text-[#E2E8F0]">
                          {row.jobRole}
                        </td>
                        <td className="px-4 py-3 text-center text-white">
                          {row.yearsExperience}
                        </td>
                        <td className="px-4 py-3 text-center text-[#94A3B8]">
                          {row.missionPoints}/{row.commitPoints}/
                          {row.projectPoints}
                        </td>
                        <td className="px-4 py-3 text-center text-[#94A3B8]">
                          {row.cleanPassPct}%
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-bold text-white">
                          {row.totalScore}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rest.length === 0 && (
                  <p className="px-4 py-8 text-center text-xs text-[#9CA3AF]">
                    Rank 4+ will show here as more members climb the board.
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
