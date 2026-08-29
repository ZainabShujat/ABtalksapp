"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { NotificationBellButton } from "@/components/shared/notification-bell-button";
import { HUB_BUTTON_CLASS } from "@/components/dashboard-hub/nav-items";
import { cn } from "@/lib/utils";

export type HeaderSectionNavItem = {
  href: string;
  label: string;
};

type DashboardHeaderProps = {
  isAdmin: boolean;
  menuOpen: boolean;
  onMenuClick: () => void;
  /** Hub page section anchors. Default true. Ignored when sectionNavItems is set. */
  showSectionNav?: boolean;
  /** Custom header links (Claude). Desktop only (`md+`), same as hub section nav. */
  sectionNavItems?: HeaderSectionNavItem[];
};

const HUB_SECTION_NAV: HeaderSectionNavItem[] = [
  { href: "#your-challenge", label: "Your Challenges" },
  { href: "#prep-kit", label: "Prep Kit" },
  { href: "#domains", label: "Domains" },
  { href: "#events", label: "Events" },
];

const bellClassName =
  "inline-flex size-9 items-center justify-center rounded-md border border-neutral-200 text-neutral-900 transition-[border-color,background-color,color,transform] duration-200 ease-[var(--ease-spark)] hover:border-[#e05226] hover:bg-[#e05226]/10 hover:text-[#e05226] motion-safe:hover:scale-[1.04]";

const navLinkClass =
  "text-sm font-medium text-[#555555] transition-colors duration-200 ease-[var(--ease-spark)] hover:text-[#e05226]";

export function DashboardHeader({
  isAdmin,
  menuOpen,
  onMenuClick,
  showSectionNav = true,
  sectionNavItems,
}: DashboardHeaderProps) {
  const customNav = sectionNavItems && sectionNavItems.length > 0;
  const hubNav = !customNav && showSectionNav;

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-[#FBF9F7]">
      <div className="flex h-[72px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-900 transition-[border-color,color,transform] duration-200 ease-[var(--ease-spark)] hover:border-[#e05226] hover:text-[#e05226] motion-safe:hover:scale-[1.04] md:hidden"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={onMenuClick}
          >
            <Menu className="size-5" aria-hidden />
          </button>

          {customNav ? (
            <nav
              className="hidden min-w-0 items-center gap-x-8 md:flex"
              aria-label="Page sections"
            >
              {sectionNavItems.map((item) => (
                <a key={item.href} href={item.href} className={navLinkClass}>
                  {item.label}
                </a>
              ))}
            </nav>
          ) : null}

          {hubNav ? (
            <nav
              className="hidden items-center gap-6 md:flex"
              aria-label="Page sections"
            >
              {HUB_SECTION_NAV.map((item) => (
                <a key={item.href} href={item.href} className={navLinkClass}>
                  {item.label}
                </a>
              ))}
            </nav>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <NotificationBellButton className={bellClassName} />
          {isAdmin ? (
            <Link
              href="/admin"
              className={cn(HUB_BUTTON_CLASS, "h-9 px-4 text-xs")}
            >
              Admin
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
