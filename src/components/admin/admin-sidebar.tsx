"use client";

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
  Package,
  ShieldCheck,
  Presentation,
  Users,
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

interface AdminSidebarProps {
  navItems: NavItem[];
}

function isNavActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebar({ navItems }: AdminSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full flex-col">
      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const Icon = iconMap[item.icon];
          const isActive = isNavActive(pathname, item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
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
          className="text-xs text-primary hover:underline"
        >
          ← Back to student portal
        </Link>
      </div>
    </aside>
  );
}
