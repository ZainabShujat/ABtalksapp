"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  BookOpen,
  Briefcase,
  Code2,
  FileText,
  Gift,
  GraduationCap,
  LayoutDashboard,
  Link2,
  Megaphone,
  Menu,
  Package,
  ShieldCheck,
  Presentation,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type IconName =
  | "overview"
  | "notifications"
  | "students"
  | "submissions"
  | "jobs"
  | "content"
  | "analytics"
  | "ambassadors"
  | "referrals"
  | "hackathonLinks"
  | "redemptions"
  | "dataRequests"
  | "program"
  | "cohort"
  | "hackathon"
  | "workshop";

const iconMap = {
  overview: LayoutDashboard,
  notifications: Bell,
  students: Users,
  submissions: FileText,
  jobs: Briefcase,
  content: BookOpen,
  analytics: BarChart3,
  ambassadors: Megaphone,
  referrals: Gift,
  hackathonLinks: Link2,
  redemptions: Package,
  dataRequests: ShieldCheck,
  program: GraduationCap,
  cohort: GraduationCap,
  hackathon: Code2,
  workshop: Presentation,
} as const;

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
};

interface AdminMobileNavProps {
  navItems: NavItem[];
}

function isNavActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminMobileNav({ navItems }: AdminMobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="mb-2 flex items-center gap-2 md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-card"
        aria-label="Open admin menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/40"
            aria-label="Close admin menu"
            onClick={() => setOpen(false)}
          />
          <div
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card p-4 shadow-xl transition-transform duration-200",
              open ? "translate-x-0" : "-translate-x-full",
            )}
          >
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-1">
              {navItems.map((item) => {
                const Icon = iconMap[item.icon];
                const isActive = isNavActive(pathname, item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                      isActive
                        ? "bg-gradient-to-r from-primary to-violet-500 text-primary-foreground shadow-[var(--shadow-card)]"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto border-t border-border pt-4">
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="text-xs text-primary hover:underline"
              >
                ← Back to student portal
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
