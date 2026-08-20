"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface ChallengeSwitcherEnrollment {
  id: string;
  domain: string;
  challengeTitle: string;
  daysCompleted: number;
}

interface Props {
  enrollments: ChallengeSwitcherEnrollment[];
  activeEnrollmentId: string;
  isHackathonRegistered: boolean;
}

const DOMAIN_LABELS: Record<string, string> = {
  SE: "Software Engineering",
  DS: "Data Science",
  AI: "Artificial Intelligence",
  CLAUDE: "Claude AI Mastery",
};

const DOMAIN_COLORS: Record<string, string> = {
  SE: "border-domains-se/50 bg-domains-se-bg text-domains-se",
  DS: "border-domains-ds/50 bg-domains-ds-bg text-domains-ds",
  AI: "border-domains-ai/50 bg-domains-ai-bg text-domains-ai",
  CLAUDE:
    "border-violet-500/50 bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200",
};

const HACK_BADGE_COLOR =
  "border-amber-500/50 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200";

const BADGE_BASE =
  "inline-flex h-6 w-16 shrink-0 items-center justify-center rounded-md border px-1.5 text-[10px] font-bold leading-none tracking-wide";

export function ChallengeSwitcher({
  enrollments,
  activeEnrollmentId,
  isHackathonRegistered,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (enrollments.length < 1) return null;

  const active =
    enrollments.find((e) => e.id === activeEnrollmentId) ?? enrollments[0];

  function handleSwitch(enrollmentId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("challenge", enrollmentId);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    router.refresh();
  }

  function handleHackathon() {
    router.push(
      isHackathonRegistered
        ? "/hackathon/dashboard"
        : "/hackathon/register?s=shr",
    );
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "inline-flex h-8 min-w-0 shrink-0 items-center gap-1.5 px-2 max-w-[120px] md:h-9 md:max-w-[200px] md:gap-2",
        )}
        aria-label={`Switch challenge: ${DOMAIN_LABELS[active.domain] ?? active.domain}`}
      >
        <span
          className={cn(
            BADGE_BASE,
            DOMAIN_COLORS[active.domain] ?? "bg-muted text-muted-foreground",
          )}
        >
          {active.domain}
        </span>
        <span className="hidden min-w-0 flex-1 truncate text-sm md:inline">
          {DOMAIN_LABELS[active.domain] ?? active.domain}
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="flex w-80 flex-col gap-1.5 p-2"
      >
        <div className="px-2 pb-1.5 pt-0.5 text-xs font-semibold text-muted-foreground">
          Your enrollments
        </div>
        {enrollments.map((enrollment) => {
          const isActive = enrollment.id === activeEnrollmentId;
          const progressPct = Math.min(
            100,
            Math.round((enrollment.daysCompleted / 60) * 100),
          );
          return (
            <DropdownMenuItem
              key={enrollment.id}
              onClick={() => handleSwitch(enrollment.id)}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border border-transparent px-3 py-3",
                "transition-colors hover:bg-accent/60 focus:bg-accent/60",
                isActive && "border-border/60 bg-accent/40",
              )}
            >
              <span
                className={cn(
                  BADGE_BASE,
                  DOMAIN_COLORS[enrollment.domain] ??
                    "bg-muted text-muted-foreground",
                )}
              >
                {enrollment.domain}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="truncate text-sm font-semibold leading-snug tracking-tight">
                  {DOMAIN_LABELS[enrollment.domain] ?? enrollment.domain}
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-medium tabular-nums text-muted-foreground">
                    Day {enrollment.daysCompleted} / 60
                  </div>
                  <div
                    className="h-1 w-full overflow-hidden rounded-full bg-muted"
                    aria-hidden
                  >
                    <div
                      className="h-full rounded-full bg-primary/70 transition-[width]"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
                <div className="truncate text-[11px] font-normal text-muted-foreground/70">
                  {enrollment.challengeTitle}
                </div>
              </div>
              {isActive ? (
                <span
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10"
                  aria-hidden
                >
                  <Check className="size-3 text-primary" />
                </span>
              ) : (
                <span className="size-5 shrink-0" aria-hidden />
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuItem
          onClick={handleHackathon}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border border-transparent px-3 py-3",
            "transition-colors hover:bg-accent/60 focus:bg-accent/60",
          )}
        >
          <span className={cn(BADGE_BASE, HACK_BADGE_COLOR)}>HACK</span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="truncate text-sm font-semibold leading-snug tracking-tight">
              ViCODATHON
            </div>
            <div className="truncate text-[11px] font-medium text-muted-foreground">
              48 hours Vibe-Coding Hackathon
            </div>
          </div>
          <span className="size-5 shrink-0" aria-hidden />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
