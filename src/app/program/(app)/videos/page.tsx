import { prisma } from "@/lib/db";
import { requireProgramMember } from "@/lib/program-auth";
import { getCohortCalendarDay } from "@/features/program/progression";
import { VideoLibraryFilters } from "@/components/program/video-library-filters";

export default async function ProgramVideosPage() {
  const { cohort } = await requireProgramMember();
  const cohortDay = getCohortCalendarDay(cohort);

  const modules = await prisma.programModule.findMany({
    orderBy: { number: "asc" },
    select: { number: true, title: true, color: true },
  });

  const days = await prisma.programDay.findMany({
    orderBy: { dayNumber: "asc" },
    select: {
      dayNumber: true,
      module: { select: { number: true } },
      videos: {
        select: {
          id: true,
          title: true,
          youtubeId: true,
          durationMin: true,
          order: true,
        },
        orderBy: { order: "asc" },
      },
    },
  });

  const videos = days.flatMap((d) =>
    d.videos.map((v) => ({
      id: v.id,
      dayNumber: d.dayNumber,
      moduleNumber: d.module.number,
      title: v.title,
      youtubeId: v.youtubeId,
      durationMin: v.durationMin,
      locked: d.dayNumber > cohortDay,
    })),
  );

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#040A12] px-4 py-6 text-white md:px-6">
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold tracking-tight">Videos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Content unlocks with the cohort calendar (day {cohortDay}/31).
          </p>
        </header>

        <VideoLibraryFilters modules={modules} videos={videos} />
      </div>
    </div>
  );
}
