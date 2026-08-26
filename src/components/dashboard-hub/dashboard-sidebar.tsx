"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Award,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  LogOut,
  Presentation,
  Store,
  User,
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth-actions";
import { cn } from "@/lib/utils";
import {
  NAV_ITEMS,
  SIDEBAR_BRAND_ROW_CLASS,
  SIDEBAR_FOOTER_ROW_CLASS,
  SIDEBAR_WIDTH_CLASS,
  HUB_NAV_ACTIVE_CLASS,
  HUB_NAV_IDLE_CLASS,
  type NavIconKey,
} from "./nav-items";

const ICON_MAP: Record<
  NavIconKey,
  React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  grid: Grid3X3,
  presentation: Presentation,
  store: Store,
  briefcase: Briefcase,
  award: Award,
  user: User,
};

const SIDEBAR_COLLAPSED_WIDTH_CLASS = "w-[72px]";

type DashboardSidebarProps = {
  user: { name: string; email: string; image: string | null };
  mobileOpen: boolean;
  onNavigate: () => void;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0] + parts[1]![0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

export function DashboardSidebar({
  user,
  mobileOpen,
  onNavigate,
  collapsible = false,
  collapsed = false,
  onToggleCollapse,
}: DashboardSidebarProps) {
  const pathname = usePathname();
  const displayName = user.name.trim() || user.email || "User";
  const isCollapsed = collapsible && collapsed;

  function renderNav(compact: boolean) {
    return (
      <nav
        className={cn("flex-1 space-y-1 py-4", compact ? "px-2" : "px-3")}
        aria-label="Main"
      >
        {NAV_ITEMS.map(({ label, href, icon }) => {
          const Icon = ICON_MAP[icon];
          const active =
            href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              title={compact ? label : undefined}
              aria-label={compact ? label : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center rounded-lg text-sm font-medium transition-colors duration-200 ease-[var(--ease-spark)]",
                compact
                  ? "justify-center px-2 py-2.5"
                  : "gap-3 px-3 py-2.5",
                active ? HUB_NAV_ACTIVE_CLASS : HUB_NAV_IDLE_CLASS,
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className={cn(compact && "sr-only")}>{label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  function renderFooter(compact: boolean) {
    return (
      <div
        className={cn(
          "mt-auto",
          compact
            ? "flex shrink-0 flex-col items-center gap-3 border-t border-neutral-200 p-3"
            : SIDEBAR_FOOTER_ROW_CLASS,
        )}
      >
        <div
          className={cn(
            "flex items-center",
            compact ? "justify-center" : "gap-3",
          )}
        >
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt=""
              className="size-9 rounded-full object-cover"
            />
          ) : (
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-700"
              aria-hidden
            >
              {initials(displayName)}
            </span>
          )}
          {!compact ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-black">
                {displayName}
              </p>
              <p className="truncate text-xs text-[#555555]">{user.email}</p>
            </div>
          ) : null}
        </div>
        <form action={signOutAction} className={cn(!compact && "mt-3")}>
          <button
            type="submit"
            title={compact ? "Sign out" : undefined}
            aria-label={compact ? "Sign out" : undefined}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg border border-neutral-200 text-sm font-medium text-[#555555] transition-[border-color,background-color,color] duration-200 ease-[var(--ease-spark)] hover:border-[#e05226] hover:bg-[#e05226]/10 hover:text-[#e05226]",
              compact ? "size-9 p-0" : "w-full px-3 py-2",
            )}
          >
            <LogOut className="size-4" aria-hidden />
            <span className={cn(compact && "sr-only")}>Sign out</span>
          </button>
        </form>
      </div>
    );
  }

  const expandedContent = (
    <>
      <div className={SIDEBAR_BRAND_ROW_CLASS}>
        <Link href="/dashboard" onClick={onNavigate}>
          <Image
            src="/abtalks-logo.png"
            alt="ABTalks"
            width={120}
            height={32}
            className="h-8 w-auto brightness-0"
          />
        </Link>
      </div>
      {renderNav(false)}
      {collapsible && onToggleCollapse ? (
        <div className="border-t border-neutral-200 px-3 py-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!isCollapsed}
            aria-label="Collapse sidebar"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-[#555555] transition-colors duration-200 ease-[var(--ease-spark)] hover:border-[#e05226] hover:text-[#e05226]"
          >
            <ChevronLeft className="size-4" aria-hidden />
            <span>Collapse</span>
          </button>
        </div>
      ) : null}
      {renderFooter(false)}
    </>
  );

  const collapsedContent = (
    <>
      <div className="flex h-[72px] items-center justify-center border-b border-neutral-200">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          aria-label="ABTalks dashboard"
        >
          <Image
            src="/abtalks-logo.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 object-contain brightness-0"
          />
        </Link>
      </div>
      {renderNav(true)}
      {onToggleCollapse ? (
        <div className="border-t border-neutral-200 p-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={false}
            aria-label="Expand sidebar"
            className="flex w-full items-center justify-center rounded-lg border border-neutral-200 py-2 text-[#555555] transition-colors duration-200 ease-[var(--ease-spark)] hover:border-[#e05226] hover:text-[#e05226]"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
      {renderFooter(true)}
    </>
  );

  const desktopWidth = isCollapsed
    ? SIDEBAR_COLLAPSED_WIDTH_CLASS
    : SIDEBAR_WIDTH_CLASS;

  return (
    <>
      <aside
        className={cn(
          "sticky top-0 hidden h-svh shrink-0 flex-col overflow-y-auto border-r border-neutral-200 bg-[#FBF9F7] transition-[width] duration-200 ease-[var(--ease-spark)] md:flex",
          desktopWidth,
        )}
      >
        {isCollapsed ? collapsedContent : expandedContent}
      </aside>

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col overflow-y-auto border-r border-neutral-200 bg-[#FBF9F7] transition-transform duration-200 md:hidden",
          SIDEBAR_WIDTH_CLASS,
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {expandedContent}
      </aside>
    </>
  );
}
