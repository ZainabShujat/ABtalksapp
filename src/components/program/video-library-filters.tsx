"use client";

import { useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { LiteYoutube } from "@/components/shared/lite-youtube";
import { cn } from "@/lib/utils";

type VideoItem = {
  id: string;
  dayNumber: number;
  moduleNumber: number;
  title: string;
  youtubeId: string;
  durationMin: number | null;
  locked: boolean;
};

type ModuleItem = {
  number: number;
  title: string;
  color: string;
};

export function VideoLibraryFilters({
  modules,
  videos,
}: {
  modules: ModuleItem[];
  videos: VideoItem[];
}) {
  const [moduleFilter, setModuleFilter] = useState<number | "ALL">("ALL");

  const filtered = useMemo(
    () =>
      moduleFilter === "ALL"
        ? videos
        : videos.filter((v) => v.moduleNumber === moduleFilter),
    [videos, moduleFilter],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setModuleFilter("ALL")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium",
            moduleFilter === "ALL"
              ? "border-primary bg-primary/10 text-primary"
              : "text-muted-foreground",
          )}
        >
          All modules
        </button>
        {modules.map((m) => (
          <button
            key={m.number}
            type="button"
            onClick={() => setModuleFilter(m.number)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              moduleFilter === m.number
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground",
            )}
          >
            Module {m.number}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((video) => (
          <div key={video.id} className="space-y-2">
            {video.locked ? (
              <div className="flex aspect-video items-center justify-center rounded-xl border bg-muted/40 text-sm text-muted-foreground">
                <Lock className="mr-2 size-4" />
                Day {video.dayNumber} (locked)
              </div>
            ) : (
              <LiteYoutube youtubeId={video.youtubeId} title={video.title} />
            )}
            <div>
              <p className="text-sm font-medium">{video.title}</p>
              <p className="text-xs text-muted-foreground">
                Day {video.dayNumber}
                {video.durationMin ? ` · ${video.durationMin} min` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
