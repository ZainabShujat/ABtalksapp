"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { NotificationBellButton } from "@/components/shared/notification-bell-button";

type DashboardHeaderProps = {
  isAdmin: boolean;
  menuOpen: boolean;
  onMenuClick: () => void;
};

const bellClassName =
  "inline-flex size-9 items-center justify-center rounded-md border border-neutral-200 text-neutral-900 transition-[border-color,background-color,color,transform] duration-200 ease-[var(--ease-spark)] hover:border-[#e05226] hover:bg-[#e05226]/10 hover:text-[#e05226] motion-safe:hover:scale-[1.04]";

export function DashboardHeader({
  isAdmin,
  menuOpen,
  onMenuClick,
}: DashboardHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-[#FBF9F7]">
      <div className="flex h-[72px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-md border border-neutral-200 text-neutral-900 transition-[border-color,color,transform] duration-200 ease-[var(--ease-spark)] hover:border-[#e05226] hover:text-[#e05226] motion-safe:hover:scale-[1.04] md:hidden"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            onClick={onMenuClick}
          >
            <Menu className="size-5" aria-hidden />
          </button>

          <nav
            className="hidden items-center gap-6 md:flex"
            aria-label="Page sections"
          >
            <a
              href="#events"
              className="text-sm font-medium text-[#555555] transition-colors duration-200 ease-[var(--ease-spark)] hover:text-[#e05226]"
            >
              Events
            </a>
            <a
              href="#faq"
              className="text-sm font-medium text-[#555555] transition-colors duration-200 ease-[var(--ease-spark)] hover:text-[#e05226]"
            >
              FAQs
            </a>
            <a
              href="#testimonials"
              className="text-sm font-medium text-[#555555] transition-colors duration-200 ease-[var(--ease-spark)] hover:text-[#e05226]"
            >
              Testimonials
            </a>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <NotificationBellButton className={bellClassName} />
          {isAdmin ? (
            <Link
              href="/admin"
              className="rounded-full border border-[#E05226] bg-[#E05226] px-4 py-1.5 text-xs font-semibold text-white transition-colors duration-200 ease-[var(--ease-spark)] hover:bg-[#C9411C]"
            >
              Admin
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
