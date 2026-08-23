"use client";

import { AlertTriangle } from "lucide-react";
import {
  PROGRAM_COMMIT_UI_ENABLED,
  PROGRAM_MAX_COMMIT_POINTS,
  PROGRAM_MAX_MISSION_POINTS,
  PROGRAM_MAX_PROJECT_POINTS,
  PROGRAM_MAX_TOTAL_POINTS,
  PROGRAM_TOTAL_DAYS,
} from "@/features/program/constants";
import type { MemberDashboard } from "@/features/program/dashboard";

type ProjectRow = {
  moduleNumber: number;
  status: string;
  adminScore: number | null;
  aiScore: number | null;
  aiFeedback: string | null;
};

type Props = {
  data: MemberDashboard;
  atRisk: { atRisk: boolean; reasons: string[] };
  projects: ProjectRow[];
  aiRec: { recommendation: string | null; generatedAt: string | null };
};

const AT_RISK_LABEL: Record<string, string> = {
  behind_pace: "Behind cohort pace",
  stuck_mission: "Stuck on current mission",
};

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

export function ProgramStatsPanel({ data, atRisk, projects, aiRec }: Props) {
  return (
    <div className="space-y-6">
      {atRisk.atRisk && (
        <div className="flex w-fit max-w-full items-start gap-3 rounded-[20px] border border-[#E05226] bg-[#FFECE3] px-3 py-2 sm:px-4 sm:py-3">
          <AlertTriangle
            className="mt-0.5 size-5 shrink-0 text-[#E05226]"
            aria-hidden
          />
          <p className="text-[14px] leading-[21px] text-[#4B4B4B]">
            At risk:{" "}
            {atRisk.reasons.map((r) => AT_RISK_LABEL[r] ?? r).join(" · ")}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total score" value={String(data.totalScore)} />
        <StatCard label="Rank" value={data.rank ? `#${data.rank}` : "—"} />
        <StatCard
          label="Commit pts"
          value={`${data.scoreBreakdown.commitPoints}/${PROGRAM_MAX_COMMIT_POINTS}`}
        />
        <StatCard
          label="Cohort day"
          value={`${data.cohortDay}/${PROGRAM_TOTAL_DAYS}`}
        />
        <StatCard label="Clean passes" value={String(data.cleanPassCount)} />
      </div>

      <div className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <div className="space-y-3">
          <ScoreBar
            label="Missions"
            value={data.scoreBreakdown.missionPoints}
            max={PROGRAM_MAX_MISSION_POINTS}
          />
          {PROGRAM_COMMIT_UI_ENABLED && (
            <ScoreBar
              label="Commits"
              value={data.scoreBreakdown.commitPoints}
              max={PROGRAM_MAX_COMMIT_POINTS}
            />
          )}
          <ScoreBar
            label="Projects"
            value={data.scoreBreakdown.projectPoints}
            max={PROGRAM_MAX_PROJECT_POINTS}
          />
        </div>
        <p className="mt-3 text-[12px] leading-4 text-[#8F8F8F]">
          Max {PROGRAM_MAX_TOTAL_POINTS} pts
        </p>
      </div>

      {aiRec.recommendation && (
        <div className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <p className="text-[17px] leading-7 text-[#4B4B4B]">
            {aiRec.recommendation}
          </p>
          {aiRec.generatedAt && (
            <p className="mt-2 text-[12px] leading-4 text-[#8F8F8F]">
              Updated{" "}
              {new Date(aiRec.generatedAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          )}
        </div>
      )}

      {projects.length > 0 && (
        <div className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <ul className="space-y-2">
            {projects.map((p) => {
              const score = p.adminScore ?? p.aiScore;
              return (
                <li key={p.moduleNumber} className="py-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[17px] leading-7 text-[#111111]">
                      Module {p.moduleNumber}
                    </span>
                    {p.status === "GRADED" && score !== null ? (
                      <span className="font-heading font-bold text-[#E05226]">
                        {score}/100
                      </span>
                    ) : (
                      <span className="text-[12px] leading-4 text-[#8F8F8F]">
                        Awaiting grading
                      </span>
                    )}
                  </div>
                  {p.aiFeedback && (
                    <p className="mt-1.5 line-clamp-2 text-[14px] leading-[21px] text-[#4B4B4B]">
                      {p.aiFeedback}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {data.recentVerdicts.length > 0 && (
        <ul className="space-y-2">
          {data.recentVerdicts.map((v, i) => (
            <li
              key={i}
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
