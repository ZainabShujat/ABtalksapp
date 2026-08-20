"use client";

import Image from "next/image";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  Flame,
  FolderGit2,
  GitCommitHorizontal,
  History,
  Layers,
  Mic,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";
import {
  PROGRAM_COMMIT_UI_ENABLED,
  PROGRAM_MAX_COMMIT_POINTS,
  PROGRAM_MAX_MISSION_POINTS,
  PROGRAM_MAX_PROJECT_POINTS,
  PROGRAM_MAX_TOTAL_POINTS,
  PROGRAM_TOTAL_DAYS,
} from "@/features/program/constants";
import type { MemberDashboard } from "@/features/program/dashboard";
import type { InterviewDashboardCard } from "@/features/program/interview";
import { MissionHeatmap } from "@/components/program/mission-heatmap";
import { CohortInterviewCard } from "@/components/program/cohort-interview-card";
import type { CohortInterviewState } from "@/features/interview/cohort-eligibility";
import { cn } from "@/lib/utils";

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
  interviewCard: InterviewDashboardCard;
  cohortInterviewState: CohortInterviewState;
};

const AT_RISK_LABEL: Record<string, string> = {
  behind_pace: "Behind cohort pace",
  stuck_mission: "Stuck on current mission",
};

const figmaBtn =
  "inline-flex h-11 items-center justify-center rounded-[12px] border border-black bg-[#7364E6] px-6 text-sm font-semibold text-white shadow-[inset_3px_3px_3px_0_rgba(0,0,0,0.5)] transition-[background-color,box-shadow] duration-300 ease-out hover:bg-[#7364E6]/90 hover:shadow-[inset_3px_3px_3px_0_rgba(0,0,0,0.5),0_0_12px_rgba(115,100,230,0.2)]";

const cardClass =
  "rounded-[16px] border border-[rgba(46,57,75,0.69)] bg-[rgba(5,12,33,0.89)] p-4 transition-[border-color,box-shadow] duration-300 ease-out md:p-5 hover:border-[#8365E3]/55 hover:shadow-[0_4px_20px_rgba(115,100,230,0.08)]";

function SectionIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-[rgba(93,8,183,0.25)] text-[#968BEC] transition-colors duration-200 group-hover:bg-[rgba(115,100,230,0.35)] group-hover:text-[#B9B2F3] md:size-7"
      aria-hidden
    >
      <Icon className="size-3.5 md:size-4" strokeWidth={2.25} />
    </span>
  );
}

function SectionHeading({
  icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-2.5">
      <SectionIcon icon={icon} />
      <h2 className="text-base font-semibold text-[#968BEC] md:text-lg">
        {children}
      </h2>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  iconClass,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  iconClass: string;
}) {
  return (
    <div
      className="group relative overflow-hidden rounded-[12px] border border-[rgba(46,57,75,0.69)] px-3.5 py-6 transition-[border-color,box-shadow] duration-300 ease-out hover:border-[#968BEC]/40 hover:shadow-[0_4px_18px_rgba(115,100,230,0.1)] md:px-4 md:py-7"
      style={{
        background:
          "linear-gradient(180deg, rgba(5, 12, 33, 0.89) 0%, rgba(61, 26, 117, 0.89) 76%, rgba(80, 25, 140, 0.89) 100%)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white md:text-sm">{label}</p>
          <p className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-white md:text-[2rem] md:leading-none">
            {value}
          </p>
        </div>
        <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-[rgba(93,8,183,0.2)] transition-[background-color,transform] duration-300 ease-out group-hover:bg-[rgba(115,100,230,0.28)] group-hover:scale-[1.04] md:size-11">
          <Icon className={cn("size-5 md:size-6", iconClass)} />
        </div>
      </div>
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
    <div className="group/bar rounded-md px-1 py-0.5 transition-colors duration-200 hover:bg-white/[0.03]">
      <div className="mb-1.5 flex justify-between text-xs text-[#BCBCBC] md:text-sm">
        <span>{label}</span>
        <span>
          {value}/{max}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#1a2333]">
        <div
          className="h-full rounded-full bg-[#7364E6] transition-all duration-300 group-hover/bar:bg-[#968BEC]"
          style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }}
        />
      </div>
    </div>
  );
}

export function ProgramDashboardView({
  data,
  atRisk,
  projects,
  aiRec,
  interviewCard,
  cohortInterviewState,
}: Props) {
  return (
    <div className="-mx-4 -my-6 min-h-[calc(100svh-3.5rem)] bg-[#040A12] px-4 py-6 text-white md:px-6">
      {/* Header — title left, at-risk right (Figma) */}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3 md:mb-6">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-white md:text-2xl">
            Mission control
          </h1>
          <p className="mt-1 text-sm text-[#9CA3AF]">
            Day {data.memberDay}/{PROGRAM_TOTAL_DAYS}
            {data.behindBy > 0 ? ` · ${data.behindBy} behind cohort pace` : ""}
          </p>
        </div>

        {atRisk.atRisk && (
          <div className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-[10px] border-[1.5px] border-[#C9282B] bg-[rgba(121,58,59,0.69)] px-3 py-2 text-xs text-[#FACC15] md:text-sm">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>
              At risk:{" "}
              {atRisk.reasons.map((r) => AT_RISK_LABEL[r] ?? r).join(" · ")}
            </span>
          </div>
        )}
      </header>

      {/* Stats row */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 md:mb-6 lg:grid-cols-5">
        <StatCard
          label="Total score"
          value={String(data.totalScore)}
          icon={Trophy}
          iconClass="text-[#F0AA5B]"
        />
        <StatCard
          label="Rank"
          value={data.rank ? `#${data.rank}` : "—"}
          icon={Award}
          iconClass="text-[#968BEC]"
        />
        <StatCard
          label="Commit pts"
          value={`${data.scoreBreakdown.commitPoints}/${PROGRAM_MAX_COMMIT_POINTS}`}
          icon={GitCommitHorizontal}
          iconClass="text-[#6AE276]"
        />
        <StatCard
          label="Cohort day"
          value={`${data.cohortDay}/${PROGRAM_TOTAL_DAYS}`}
          icon={Target}
          iconClass="text-[#4C9EEB]"
        />
        <StatCard
          label="Clean passes"
          value={String(data.cleanPassCount)}
          icon={Flame}
          iconClass="text-[#F0AA5B]"
        />
      </div>

      {/* Commit + Mission / Interview — equal columns like Figma 844/844 */}
      <div className="mb-5 grid gap-4 md:mb-6 lg:grid-cols-2">
        <section className={cn(cardClass, "group relative md:min-h-[280px]")}>
          <SectionHeading icon={Activity}>Mission progress</SectionHeading>
          <p className="mb-4 text-xs text-[#E9E9E9] md:text-sm">
            Green means you passed that day&apos;s mission verification. Complete
            each day to unlock the next.
          </p>
          <MissionHeatmap cells={data.missionHeatmap} variant="dashboard" />
        </section>

        <div className="flex flex-col gap-4">
          <section
            className={cn(
              cardClass,
              "group flex flex-1 flex-col border-[2.5px] border-[#968BEC] md:min-h-[140px]",
            )}
          >
            <SectionHeading icon={Target}>Today&apos;s Mission</SectionHeading>
            {data.currentDay ? (
              <div className="mt-auto flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-[#FF7878]" />
                    <p className="text-sm font-semibold text-[#E9E9E9] md:text-base">
                      Day {data.currentDay.dayNumber}: {data.currentDay.title}
                    </p>
                  </div>
                  <span className="mt-2 ml-4 inline-flex rounded-[4px] border border-[#A5A5A5] bg-[#433F3F] px-2.5 py-1 text-[10px] font-medium tracking-wide text-[#BCBCBC] uppercase">
                    {data.currentDay.missionType.replace("_", " ")}
                  </span>
                </div>
                <Link
                  href={`/program/day/${data.currentDay.dayNumber}`}
                  className={figmaBtn}
                >
                  Start →
                </Link>
              </div>
            ) : (
              <p className="text-sm text-[#9CA3AF]">
                No active mission, check the curriculum for what&apos;s next.
              </p>
            )}
          </section>

          <section
            className={cn(
              cardClass,
              "group flex flex-1 flex-col md:min-h-[140px]",
            )}
          >
            <SectionHeading icon={Mic}>Voice Interview</SectionHeading>
            <div className="mt-auto flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[#E9E9E9] md:text-[15px]">
                  Scored separately, not part of your leaderboard total.
                </p>
                {interviewCard.state === "locked" ? (
                  <span className="mt-4 mb-4 inline-flex rounded-[4px] border border-[#6B78F0] bg-[rgba(93,8,183,0.2)] px-3 py-1 text-xs text-[#B9B2F3] transition-colors duration-300 ease-out hover:border-[#968BEC]/80">
                    Locked until program end
                  </span>
                ) : interviewCard.state !== "exhausted" ? (
                  <Link href="/program/interview" className={cn(figmaBtn, "mt-3")}>
                    {interviewCard.state === "completed"
                      ? "View results"
                      : "Open →"}
                  </Link>
                ) : (
                  <p className="mt-2.5 text-xs text-[#9CA3AF]">{interviewCard.label}</p>
                )}
              </div>
              <div className="relative size-[72px] shrink-0 transition-opacity duration-300 ease-out group-hover:opacity-95 sm:size-[88px]">
                <Image
                  src="/program/interview-key.png"
                  alt=""
                  fill
                  className="object-contain"
                  sizes="88px"
                />
              </div>
            </div>
          </section>

          <CohortInterviewCard state={cohortInterviewState} />
        </div>
      </div>

      {/* Score breakdown */}
      <section className={cn(cardClass, "group mb-5 md:mb-6")}>
        <SectionHeading icon={BarChart3}>Score breakdown</SectionHeading>
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
        <p className="mt-3 text-xs text-[#8F8F8F]">
          Max {PROGRAM_MAX_TOTAL_POINTS} pts across all components
        </p>
      </section>

      {/* Module progress */}
      <section className="mb-5 space-y-3 md:mb-6">
        <div className="group flex items-center gap-2.5">
          <SectionIcon icon={Layers} />
          <h2 className="text-base font-semibold text-[#968BEC] md:text-lg">
            Module progress
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.moduleProgress.map((mod) => (
            <div key={mod.number} className={cn(cardClass, "group")}>
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <span
                  className="size-2.5 shrink-0 rounded-full transition-transform duration-300 ease-out group-hover:scale-110"
                  style={{ backgroundColor: mod.color }}
                />
                {mod.title}
              </div>
              <p className="mt-1 text-xs text-[#9CA3AF]">
                {mod.passed}/{mod.total} missions passed
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#1a2333]">
                <div
                  className="h-full rounded-full transition-[filter] duration-300 ease-out group-hover:brightness-105"
                  style={{
                    width: `${mod.total ? (mod.passed / mod.total) * 100 : 0}%`,
                    backgroundColor: mod.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {aiRec.recommendation && (
        <section
          className={cn(cardClass, "group mb-5 border-[#8365E3]/40 md:mb-6")}
        >
          <SectionHeading icon={Sparkles}>Your AI mentor note</SectionHeading>
          <p className="text-sm leading-relaxed text-[#BCBCBC]">
            {aiRec.recommendation}
          </p>
          {aiRec.generatedAt && (
            <p className="mt-2 text-xs text-[#8F8F8F]">
              Updated{" "}
              {new Date(aiRec.generatedAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          )}
        </section>
      )}

      {projects.length > 0 && (
        <section className={cn(cardClass, "group mb-5 md:mb-6")}>
          <SectionHeading icon={FolderGit2}>Boss Build projects</SectionHeading>
          <ul className="space-y-2">
            {projects.map((p) => {
              const score = p.adminScore ?? p.aiScore;
              return (
                <li
                  key={p.moduleNumber}
                  className="rounded-[10px] border border-[#8365E3]/30 bg-[#110528] px-3 py-2.5 text-sm transition-[border-color,background-color] duration-300 ease-out hover:border-[#968BEC]/45 hover:bg-[#140830]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-white">
                      Module {p.moduleNumber}
                    </span>
                    {p.status === "GRADED" && score !== null ? (
                      <span className="font-display font-bold text-[#968BEC]">
                        {score}/100
                      </span>
                    ) : (
                      <span className="text-xs text-[#8F8F8F]">
                        Awaiting grading
                      </span>
                    )}
                  </div>
                  {p.aiFeedback && (
                    <p className="mt-1.5 line-clamp-2 text-xs text-[#9CA3AF]">
                      {p.aiFeedback}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {data.recentVerdicts.length > 0 && (
        <section className="space-y-3">
          <div className="group flex items-center gap-2.5">
            <SectionIcon icon={History} />
            <h2 className="text-base font-semibold text-[#968BEC]">
              Recent runs
            </h2>
          </div>
          <ul className="space-y-2 text-sm">
            {data.recentVerdicts.map((v, i) => (
              <li
                key={i}
                className="rounded-[10px] border border-[rgba(46,57,75,0.69)] bg-[rgba(5,12,33,0.89)] px-3 py-2.5 transition-[border-color,box-shadow] duration-300 ease-out hover:border-[#8365E3]/55 hover:shadow-[0_2px_12px_rgba(115,100,230,0.08)]"
              >
                <span className="font-medium text-white">Day {v.dayNumber}</span>{" "}
                <span
                  className={v.passed ? "text-[#6AE276]" : "text-[#FF7878]"}
                >
                  {v.passed ? "passed" : "failed"}
                </span>
                <span className="text-[#8F8F8F]">
                  {" "}
                  · {v.checks.filter((c) => c.passed).length}/{v.checks.length}{" "}
                  checks
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
