"use client";

import { Suspense, useEffect, useState } from "react";
import { Domain } from "@prisma/client";
import { AlertCircle, Briefcase } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { signOutAction } from "@/app/actions/auth-actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SynergyChip } from "@/components/shared/synergy-chip";
import { NotificationBellButton } from "@/components/shared/notification-bell-button";
import {
  ChallengeSwitcher,
  type ChallengeSwitcherEnrollment,
} from "@/components/shared/challenge-switcher";
import { MobileSidebar } from "@/components/shared/mobile-sidebar";
import { cn } from "@/lib/utils";

export type AppHeaderUser = {
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  isAdmin?: boolean;
};

type Props = {
  user: AppHeaderUser;
  domain?: Domain | null;
  headerDomain?: Domain | null;
  userEnrollments?: ChallengeSwitcherEnrollment[];
  activeEnrollmentId?: string;
  isHackathonRegistered?: boolean;
};

function displayLabel(user: AppHeaderUser): string {
  return user.name?.trim() || user.email || "User";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0] + parts[1]![0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

export function AppHeader({
  user,
  userEnrollments,
  activeEnrollmentId,
  isHackathonRegistered = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const jobsActive = pathname.startsWith("/jobs");
  const label = displayLabel(user);
  const showChallengeSwitcher =
    (userEnrollments?.length ?? 0) >= 1 &&
    !!activeEnrollmentId &&
    (userEnrollments?.some((e) => e.id === activeEnrollmentId) ?? false);

  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        setCollapsed((prev) => {
          if (!prev && y > 24) return true;
          if (prev && y < 8) return false;
          return prev;
        });
        ticking = false;
      });
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-card/95 shadow-sm backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            data-collapsed={collapsed}
            className="logo-link focus-spark shrink-0"
          >
            <Image
              src="/abtalks-logo.png"
              alt="ABTalks"
              width={300}
              height={84}
              priority
              className="logo-image"
            />
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {showChallengeSwitcher ? (
            <Suspense fallback={null}>
              <ChallengeSwitcher
                enrollments={userEnrollments!}
                activeEnrollmentId={activeEnrollmentId!}
                isHackathonRegistered={isHackathonRegistered}
              />
            </Suspense>
          ) : null}
          <Link
            href="/jobs"
            className={cn(
              "focus-spark group hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium transition-colors md:inline-flex",
              jobsActive
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-transparent text-muted-foreground hover:border-border/60 hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Briefcase
              className="size-3.5 transition-transform group-hover:scale-110"
              aria-hidden
            />
            Jobs
          </Link>
          {user.isAdmin ? (
            <Link
              href="/admin"
              className="focus-spark hidden shrink-0 items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 md:inline-flex"
            >
              Admin
            </Link>
          ) : null}
          {/* All breakpoints. On mobile this lands between the challenge
              switcher and the hamburger, which are the only other visible items. */}
          <NotificationBellButton className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-card text-foreground transition-colors hover:border-[#E05226] hover:bg-[#E05226]/10 hover:text-[#E05226]" />
          <div className="hidden md:block">
            <SynergyChip />
          </div>
          <span className="hidden h-6 w-px shrink-0 bg-border md:block" aria-hidden />
          <div className="hidden md:block">
            <DropdownMenu>
              <DropdownMenuTrigger
                type="button"
                aria-label="Open profile menu"
                className={cn(
                  "focus-spark inline-flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm outline-none transition-colors sm:gap-3 sm:px-2",
                  "hover:bg-muted aria-expanded:bg-muted",
                )}
              >
                <Avatar className="size-8 ring-2 ring-border/80 sm:size-9">
                  {user.image ? (
                    <AvatarImage src={user.image} alt="" />
                  ) : null}
                  <AvatarFallback>{initials(label)}</AvatarFallback>
                </Avatar>
                <span className="hidden min-w-0 flex-col items-start text-left md:flex">
                  <span className="max-w-[140px] truncate font-medium lg:max-w-[160px]">
                    {label}
                  </span>
                  <span className="max-w-[180px] truncate text-xs text-muted-foreground lg:max-w-[200px]">
                    {user.email}
                  </span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{label}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="hidden md:flex"
                  onClick={() => router.push("/profile")}
                >
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="hidden md:flex"
                  onClick={() => router.push("/mission")}
                >
                  Our Mission
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    window.location.href =
                      "mailto:team@abtalks.in?subject=ABTalks Issue Report&body=Please describe the issue you're experiencing:%0D%0A%0D%0A";
                  }}
                >
                  <AlertCircle className="mr-2 h-4 w-4" />
                  Report an Issue
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <form action={signOutAction} className="p-1">
                  <button
                    type="submit"
                    className="focus-spark flex w-full rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                  >
                    Logout
                  </button>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <MobileSidebar user={user} />
        </div>
      </div>
    </header>
  );
}
