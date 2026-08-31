"use client";

import type { DatabricksDashboard } from "@/features/databricks/dashboard";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-[#E0E0E0] bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <p className="text-[13px] leading-[18px] font-semibold uppercase text-[#8F8F8F]">
        {label}
      </p>
      <p className="mt-1 font-inter text-[32px] leading-9 font-bold text-[#111111]">
        {value}
      </p>
    </div>
  );
}

function ScoreBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[14px] leading-[21px] text-[#4B4B4B]">
        <span>{label}</span>
        <span>
          {value}/{max}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#E0E0E0]">
        <div
          className="h-full rounded-full bg-[#E05226]"
          style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }}
        />
      </div>
    </div>
  );
}

export function DatabricksStatsPanel({ data }: { data: DatabricksDashboard }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="Mission pts"
          value={`${data.missionPoints}/${data.maxMissionPoints}`}
        />
        <StatCard
          label="Days cleared"
          value={`${data.clearedCount}/${data.totalDays}`}
        />
        <StatCard label="Streak" value={String(data.currentStreak)} />
        <StatCard label="Days behind" value={String(data.behindBy)} />
        <StatCard label="Late days" value={String(data.lateDayCount)} />
      </div>

      <div className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <ScoreBar
          label="Missions"
          value={data.missionPoints}
          max={data.maxMissionPoints}
        />
        <p className="mt-3 text-[12px] leading-4 text-[#8F8F8F]">
          Max {data.maxMissionPoints} pts
        </p>
      </div>

      {data.recentVerdicts.length > 0 && (
        <ul className="space-y-2">
          {data.recentVerdicts.map((v, i) => (
            <li
              key={`${v.dayNumber}-${v.createdAt}-${i}`}
              className="rounded-[12px] border border-[#E0E0E0] bg-white px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
            >
              <span className="text-[14px] leading-[21px] font-medium text-[#111111]">
                Day {v.dayNumber}
              </span>{" "}
              <span
                className={
                  v.passed
                    ? "text-[14px] leading-[21px] text-[#2E7D32]"
                    : "text-[14px] leading-[21px] text-[#C9411C]"
                }
              >
                {v.passed ? "passed" : "failed"}
              </span>
              <span className="text-[14px] leading-[21px] text-[#8F8F8F]">
                {" "}
                · {v.checks.filter((c) => c.passed).length}/{v.checks.length}{" "}
                checks
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
