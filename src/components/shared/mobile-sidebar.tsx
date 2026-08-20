"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  AlertCircle,
  Award,
  ChevronRight,
  Compass,
  Flame,
  LogOut,
  Menu,
  Moon,
  Star,
  Sun,
  User,
  Wrench,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { signOutAction } from "@/app/actions/auth-actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSynergy } from "@/components/shared/synergy-provider";
import type { AppHeaderUser } from "@/components/shared/app-header";
import { playClickSound } from "@/lib/sound-pref";
import { cn } from "@/lib/utils";

type Props = {
  user: AppHeaderUser;
  isMarketplace: boolean;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0] + parts[1]![0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

const ROW_CLASS =
  "focus-spark flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted";

export function MobileSidebar({ user, isMarketplace }: Props) {
  const [open, setOpen] = useState(false);
  const { points } = useSynergy();
  const { resolvedTheme, setTheme } = useTheme();

  const label = user.name?.trim() || user.email || "User";
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="focus-spark inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-card transition-colors hover:bg-muted"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open
        ? createPortal(
            <>
              <button
                type="button"
                className="fixed inset-0 z-[60] bg-black/40 animate-in fade-in-0 duration-200"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
              />
              <div className="fixed inset-y-0 right-0 z-[70] flex w-[85vw] max-w-xs flex-col overflow-y-auto border-l border-border/60 bg-card p-4 shadow-xl animate-in slide-in-from-right duration-200">
                <div className="mb-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close menu"
                    className="focus-spark inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Profile block */}
                <div className="mb-4 flex items-center gap-3">
                  <Avatar className="size-12 ring-2 ring-border/80">
                    {user.image ? <AvatarImage src={user.image} alt="" /> : null}
                    <AvatarFallback>{initials(label)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {label}
                      </span>
                      {user.isAdmin ? (
                        <span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          Admin
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </div>
                  </div>
                </div>

                {/* Synergy */}
                <div className="mb-3 space-y-2">
                  <div className="flex items-center gap-2 px-1 text-xs font-semibold text-muted-foreground">
                    <Star className="size-3.5 text-amber-500" aria-hidden />
                    Synergy
                  </div>
                  <Link
                    href="/marketplace"
                    onClick={() => setOpen(false)}
                    className="focus-spark flex items-center justify-between rounded-lg border border-primary/20 bg-linear-to-r from-primary/15 to-violet-500/15 px-3 py-2.5 text-sm font-semibold text-primary transition-colors hover:from-primary/25 hover:to-violet-500/25"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Flame className="size-4" aria-hidden />
                      <span className="tabular-nums">
                        {points ?? "…"} Points
                      </span>
                    </span>
                    <ChevronRight className="size-4 opacity-60" aria-hidden />
                  </Link>
                </div>

                {/* Menu rows */}
                <nav className="space-y-1">
                  {user.isAdmin ? (
                    <Link
                      href="/admin"
                      onClick={() => setOpen(false)}
                      className={ROW_CLASS}
                    >
                      <Wrench
                        className="size-4 text-muted-foreground"
                        aria-hidden
                      />
                      Admin Panel
                    </Link>
                  ) : null}
                  {!isMarketplace ? (
                    <button
                      type="button"
                      onClick={() => {
                        playClickSound();
                        setTheme(isDark ? "light" : "dark");
                      }}
                      className={cn(ROW_CLASS, "text-left")}
                    >
                      {isDark ? (
                        <Sun
                          className="size-4 text-muted-foreground"
                          aria-hidden
                        />
                      ) : (
                        <Moon
                          className="size-4 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                      {isDark ? "Light Mode" : "Dark Mode"}
                    </button>
                  ) : null}
                  <Link
                    href="/achievements"
                    onClick={() => setOpen(false)}
                    className={ROW_CLASS}
                  >
                    <Award
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                    Your Achievements
                  </Link>
                  <Link
                    href="/profile"
                    onClick={() => setOpen(false)}
                    className={ROW_CLASS}
                  >
                    <User className="size-4 text-muted-foreground" aria-hidden />
                    Profile
                  </Link>
                  <Link
                    href="/mission"
                    onClick={() => setOpen(false)}
                    className={ROW_CLASS}
                  >
                    <Compass
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                    Our mission
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href =
                        "mailto:team@abtalks.in?subject=ABTalks Issue Report&body=Please describe the issue you're experiencing:%0D%0A%0D%0A";
                    }}
                    className={cn(ROW_CLASS, "text-left")}
                  >
                    <AlertCircle
                      className="size-4 text-muted-foreground"
                      aria-hidden
                    />
                    Report an Issue
                  </button>
                </nav>

                {/* Logout pinned to bottom */}
                <div className="mt-auto border-t border-border/60 pt-3">
                  <form action={signOutAction}>
                    <button
                      type="submit"
                      className="focus-spark flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                    >
                      <LogOut className="size-4" aria-hidden />
                      Logout
                    </button>
                  </form>
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
