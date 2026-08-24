import { redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { prisma } from "@/lib/db";
import { requireProgramMember } from "@/lib/program-auth";
import { getDayShell } from "@/features/program/days";
import { getMissionState } from "@/features/program/missions";
import { getMissionMentorFeedback } from "@/features/program/mentor";
import { getMemberDayStates } from "@/features/program/progression";
import { parseBriefMd } from "@/features/program/parse-brief";
import { PROGRAM_TOTAL_DAYS } from "@/features/program/constants";
import { LiteYoutube } from "@/components/shared/lite-youtube";
import { MissionPanel } from "@/components/program/mission-panel";
import { ProgramDayClient } from "@/components/program/program-day-client";
import { DayBuildSteps } from "@/components/program/day-build-steps";
import {
  DaySectionCard,
  ToolChip,
  dayMdClassName,
} from "@/components/program/day-section-card";
import { programMdComponents } from "@/components/program/markdown-code";
import { cn } from "@/lib/utils";
import { programMember } from "@/repositories/legacy/program-member";

type Props = { params: Promise<{ day: string }> };

export default async function ProgramDayPage({ params }: Props) {
  const { member } = await requireProgramMember();
  const { day: dayParam } = await params;
  const dayNumber = Number.parseInt(dayParam, 10);
  if (
    !Number.isFinite(dayNumber) ||
    dayNumber < 1 ||
    dayNumber > PROGRAM_TOTAL_DAYS
  ) {
    redirect("/program/curriculum");
  }

  const result = await getDayShell(member.id, dayNumber);
  if (!result || result.state === "LOCKED") {
    redirect("/program/curriculum");
  }

  const { day } = result;

  const [missionState, memberProfile, curriculum] = await Promise.all([
    getMissionState(member.id, dayNumber),
    programMember.findUnique({
      where: { id: member.id },
      select: { githubRepoUrl: true },
    }),
    getMemberDayStates(member.id),
  ]);

  if (!missionState || !memberProfile) redirect("/program/curriculum");

  const initialMentorFeedback =
    missionState.dayState === "PASSED"
      ? await getMissionMentorFeedback(member.id, dayNumber)
      : null;

  const brief = parseBriefMd(day.briefMd);
  const hasObjectives =
    day.objectives.length > 0 || day.tools.length > 0;

  return (
    <ProgramDayClient
      dayNumber={day.dayNumber}
      dayTitle={day.title}
      moduleNumber={day.module.number}
      moduleTitle={day.module.title}
      days={curriculum.days}
      modules={curriculum.modules}
      estimatedMin={day.estimatedMin}
      missionPoints={day.missionPoints}
    >
      <div
        className={cn(
          "grid min-w-0 gap-6",
          hasObjectives ? "md:grid-cols-2" : "grid-cols-1",
        )}
      >
        <DaySectionCard title="Mission" icon="mission" className="min-w-0">
          {(brief.missionTitle || day.title) && (
            <h3 className="mb-2 font-heading text-base font-semibold text-[#111111] md:text-lg">
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
                    <span className="text-[#E05226]">-</span>
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
              "min-w-0 overflow-x-auto rounded-[12px] border border-[#E0E0E0] bg-[#FBF9F7] p-5 [&_pre]:border-0 [&_pre]:bg-transparent [&_pre]:p-0",
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
                    className="inline-block size-0 shrink-0 border-y-[6px] border-l-[9px] border-y-transparent border-l-[#E05226]"
                    aria-hidden
                  />
                  <p className="text-sm font-medium text-[#111111]">
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

      <MissionPanel
        dayNumber={dayNumber}
        dayTitle={day.title}
        missionType={day.missionType}
        githubRepoUrl={memberProfile.githubRepoUrl}
        missionState={missionState}
        initialMentorFeedback={initialMentorFeedback}
        dataRoomQuestions={brief.submitQuestions}
        verifyIntro={brief.submitIntroMd ?? undefined}
      />
    </ProgramDayClient>
  );
}
