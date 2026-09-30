import { redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { auth } from "@/auth";
import { LangchainMissionPanel } from "@/components/langchain/langchain-mission-panel";
import { DayBuildSteps } from "@/components/program/day-build-steps";
import {
  DaySectionCard,
  ToolChip,
  dayMdClassName,
} from "@/components/program/day-section-card";
import { programMdComponents } from "@/components/program/markdown-code";
import { ProgramDayClient } from "@/components/program/program-day-client";
import { LiteYoutube } from "@/components/shared/lite-youtube";
import { LANGCHAIN_BASE, LANGCHAIN_TOTAL_DAYS } from "@/features/langchain/constants";
import { getLangchainDashboard } from "@/features/langchain/dashboard";
import { getLangchainDayShell } from "@/features/langchain/days";
import { getLangchainMissionState } from "@/features/langchain/missions";
import { parseBriefMd } from "@/features/program/parse-brief";
import { cn } from "@/lib/utils";
import { findLangchainEnrollment } from "@/repositories/langchain";

type Props = { params: Promise<{ day: string }> };

export default async function LangchainDayPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?from=${LANGCHAIN_BASE}`);
  }

  const enrollment = await findLangchainEnrollment(session.user.id);
  if (!enrollment) redirect(LANGCHAIN_BASE);

  const { day: dayParam } = await params;
  const dayNumber = Number.parseInt(dayParam, 10);
  if (
    !Number.isFinite(dayNumber) ||
    dayNumber < 1 ||
    dayNumber > LANGCHAIN_TOTAL_DAYS
  ) {
    redirect(LANGCHAIN_BASE);
  }

  const result = await getLangchainDayShell(enrollment, dayNumber);
  if (!result || result.state === "LOCKED") {
    redirect(LANGCHAIN_BASE);
  }

  const { day } = result;
  const [missionState, dashboard] = await Promise.all([
    getLangchainMissionState(enrollment, dayNumber),
    getLangchainDashboard(enrollment),
  ]);
  if (!missionState) redirect(LANGCHAIN_BASE);

  const brief = parseBriefMd(day.briefMd);
  const hasObjectives = day.objectives.length > 0 || day.tools.length > 0;

  return (
    <ProgramDayClient
      dayNumber={day.dayNumber}
      dayTitle={day.title}
      moduleNumber={day.module.number}
      moduleTitle={day.module.title}
      days={dashboard.days}
      modules={dashboard.modules}
      estimatedMin={day.estimatedMin}
      missionPoints={day.missionPoints}
      basePath="/program/langchain"
    >
      <div
        className={cn(
          "grid min-w-0 gap-6",
          hasObjectives ? "md:grid-cols-2" : "grid-cols-1",
        )}
      >
        <DaySectionCard title="Mission" icon="mission" className="min-w-0">
          {(brief.missionTitle || day.title) && (
            <h3 className="mb-2 font-heading text-base font-semibold text-[#000000] md:text-lg">
              {brief.missionTitle ?? day.title}
            </h3>
          )}
          <div className={dayMdClassName}>
            <ReactMarkdown components={programMdComponents}>
              {brief.missionBodyMd}
            </ReactMarkdown>
          </div>
        </DaySectionCard>

        {hasObjectives && (
          <DaySectionCard title="Objectives" icon="objectives" className="min-w-0">
            {day.objectives.length > 0 && (
              <ul className={cn(dayMdClassName, "mb-4 space-y-1.5")}>
                {day.objectives.map((o, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[#03535F]">-</span>
                    <span>{o}</span>
                  </li>
                ))}
              </ul>
            )}
            {day.tools.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {day.tools.map((t) => (
                  <ToolChip key={t} label={t} />
                ))}
              </div>
            )}
          </DaySectionCard>
        )}
      </div>

      {brief.repoLayoutMd && (
        <DaySectionCard title="Your Repo Layout (set this up first!)" icon="repo">
          <div
            className={cn(
              dayMdClassName,
              "min-w-0 overflow-x-auto rounded-[12px] border border-[#E0E0E0] bg-[#F4F4F4] p-5 [&_pre]:border-0 [&_pre]:bg-transparent [&_pre]:p-0",
            )}
          >
            <ReactMarkdown components={programMdComponents}>
              {brief.repoLayoutMd}
            </ReactMarkdown>
          </div>
        </DaySectionCard>
      )}

      {brief.buildSteps.length > 0 && (
        <DayBuildSteps steps={brief.buildSteps} />
      )}

      {day.videos.length > 0 && (
        <DaySectionCard title="Reference Resources" icon="resources">
          <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
            {day.videos.map((video) => (
              <div key={video.id} className="max-w-md space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block size-0 shrink-0 border-y-[6px] border-l-[9px] border-y-transparent border-l-[#03535F]"
                    aria-hidden
                  />
                  <p className="text-sm font-medium text-[#000000]">
                    {video.title}
                  </p>
                </div>
                <LiteYoutube
                  youtubeId={video.youtubeId}
                  title={video.title}
                  compact
                  className="border-[#E0E0E0]"
                />
              </div>
            ))}
          </div>
        </DaySectionCard>
      )}

      <LangchainMissionPanel
        dayNumber={dayNumber}
        missionType={day.missionType}
        githubRepoUrl={enrollment.githubRepoUrl ?? ""}
        missionState={missionState}
        dataRoomQuestions={brief.submitQuestions}
        verifyIntro={brief.submitIntroMd ?? undefined}
      />
    </ProgramDayClient>
  );
}
