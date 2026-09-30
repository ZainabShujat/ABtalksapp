import { requireProgramMember } from "@/lib/program-auth";
import { getMemberCalendarDay } from "@/features/program/progression";
import { VideoLibraryFilters } from "@/components/program/video-library-filters";
import { listProgramVideos, listProgramModules } from "@/repositories/learning";

export default async function ProgramVideosPage() {
  const { member } = await requireProgramMember();
  const memberDay = getMemberCalendarDay(member);

  const [catalog, modules] = await Promise.all([
    listProgramVideos(),
    listProgramModules(),
  ]);
  const videos = catalog.map((v) => ({
    ...v,
    locked: v.dayNumber > memberDay,
  }));

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#000000] px-4 py-6 text-white md:px-6">
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold tracking-tight">Videos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Content unlocks one day at a time from your start date (day{" "}
            {memberDay}/31).
          </p>
        </header>

        <VideoLibraryFilters modules={modules} videos={videos} />
      </div>
    </div>
  );
}
