import Link from "next/link";
import {
  Bolt,
  ChevronRight,
  Code2,
  Play,
  Sparkles,
} from "lucide-react";

export type TrackIcon = "code" | "sparkles" | "bolt" | "play";

type Props = {
  href: string;
  title: string;
  support: string;
  icon: TrackIcon;
  badge?: {
    label: string;
    tone: "success" | "neutral";
  };
};

export function TrackRow({ href, title, support, icon, badge }: Props) {
  const iconMap = {
    code: Code2,
    sparkles: Sparkles,
    bolt: Bolt,
    play: Play,
  } as const;
  const toneClasses = {
    success:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
    neutral: "bg-muted text-muted-foreground",
  } as const;
  const Icon = iconMap[icon];

  return (
    <Link
      href={href}
      className="focus-spark flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 shadow-sm transition-colors hover:border-primary/30 hover:bg-muted/30"
    >
      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {support}
        </span>
      </span>
      {badge ? (
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${toneClasses[badge.tone]}`}
        >
          {badge.label}
        </span>
      ) : (
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
    </Link>
  );
}
