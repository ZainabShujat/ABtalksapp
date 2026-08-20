"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Bell,
  Code2,
  GraduationCap,
  Megaphone,
  Presentation,
  Trophy,
} from "lucide-react";
import {
  getMyNotificationsAction,
  markNotificationsReadAction,
} from "@/app/actions/notification-actions";
import type {
  AppNotification,
  NotificationCategoryKey,
  NotificationFeed,
} from "@/features/notification/types";
import { cn } from "@/lib/utils";

type Ctx = {
  feed: NotificationFeed | null;
  open: boolean;
  /** Called by a bell trigger on mount — the provider never fetches on its own. */
  ensureLoaded: () => void;
  /** The trigger registers its DOM node so the panel can be anchored under it. */
  setAnchor: (el: HTMLElement | null) => void;
  openPanel: () => void;
  closePanel: () => void;
};

const NotificationContext = createContext<Ctx | null>(null);
const KEY = "abtalks_notifications";
const TTL_MS = 60_000;

const NOOP_CTX: Ctx = {
  feed: null,
  open: false,
  ensureLoaded: () => {},
  setAnchor: () => {},
  openPanel: () => {},
  closePanel: () => {},
};

/** Where the panel should hang from, measured off the bell. */
type AnchorRect = { bottom: number; left: number };

/** Must match the panel's `md:w-96`, used to keep it on screen. */
const PANEL_WIDTH = 384;
const VIEWPORT_GUTTER = 8;

function readCache(): { feed: NotificationFeed; t: number } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as { feed: NotificationFeed; t: number }) : null;
  } catch {
    return null;
  }
}

export function NotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  const loadingRef = useRef(false);
  const loadedRef = useRef(false);
  const anchorRef = useRef<HTMLElement | null>(null);

  const setAnchor = useCallback((el: HTMLElement | null) => {
    anchorRef.current = el;
  }, []);

  const measureAnchor = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setAnchorRect({ bottom: box.bottom, left: box.left });
  }, []);

  const writeCache = useCallback((next: NotificationFeed) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ feed: next, t: Date.now() }));
    } catch {}
  }, []);

  const fetchFeed = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    void getMyNotificationsAction()
      .then((res) => {
        if (res.ok) {
          setFeed(res.data);
          writeCache(res.data);
        }
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, [writeCache]);

  /**
   * This provider sits in the root layout, which renders on the public landing
   * page too. Fetching on mount would hit a Server Action for every anonymous
   * visitor, so loading is driven by the bell trigger instead — the feed is
   * only ever fetched where a bell actually renders.
   */
  const ensureLoaded = useCallback(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    const cached = readCache();
    if (cached) setFeed(cached.feed);
    if (!cached || Date.now() - cached.t > TTL_MS) fetchFeed();
  }, [fetchFeed]);

  const closePanel = useCallback(() => setOpen(false), []);

  const openPanel = useCallback(() => {
    measureAnchor();
    setOpen(true);

    // Opening the bell counts as seeing everything in it. Optimistic: the badge
    // clears instantly and the write is fire-and-forget.
    setFeed((prev) => {
      if (!prev) return prev;
      const unreadKeys = prev.items.filter((i) => !i.isRead).map((i) => i.key);
      if (unreadKeys.length === 0) return prev;

      const next: NotificationFeed = {
        ...prev,
        items: prev.items.map((i) => ({ ...i, isRead: true })),
        unreadCount: 0,
      };
      writeCache(next);
      void markNotificationsReadAction(unreadKeys);
      return next;
    });
  }, [writeCache, measureAnchor]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", measureAnchor);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", measureAnchor);
    };
  }, [open, measureAnchor]);

  return (
    <NotificationContext.Provider
      value={{ feed, open, ensureLoaded, setAnchor, openPanel, closePanel }}
    >
      {children}
      {open && feed?.signedIn ? (
        <NotificationPanel
          items={feed.items}
          anchorRect={anchorRect}
          onClose={closePanel}
        />
      ) : null}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): Ctx {
  return useContext(NotificationContext) ?? NOOP_CTX;
}

const categoryIcon: Record<NotificationCategoryKey, typeof Bell> = {
  GENERAL: Megaphone,
  WORKSHOP: Presentation,
  HACKATHON: Trophy,
  COHORT: GraduationCap,
  CHALLENGE: Code2,
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  if (diff < 0) return "soon";

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function NotificationPanel({
  items,
  anchorRect,
  onClose,
}: {
  items: AppNotification[];
  anchorRect: AnchorRect | null;
  onClose: () => void;
}) {
  // Below md the panel is a full-width sheet, so the anchor is ignored. From md
  // up it hangs directly under the bell, wherever the header happens to put it.
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (typeof document === "undefined") return null;

  // Left edge on the bell, opening rightward — clamped so a bell sitting near
  // the right edge of the window can't push the panel off screen.
  const anchored =
    isDesktop && anchorRect
      ? {
          top: anchorRect.bottom + VIEWPORT_GUTTER,
          left: Math.max(
            VIEWPORT_GUTTER,
            Math.min(
              anchorRect.left,
              window.innerWidth - PANEL_WIDTH - VIEWPORT_GUTTER,
            ),
          ),
        }
      : undefined;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Close notifications"
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-black/20 animate-in fade-in-0 duration-150"
      />
      <div
        role="dialog"
        aria-label="Notifications"
        style={anchored}
        className={cn(
          "fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-xl animate-in fade-in-0 zoom-in-95 duration-150",
          // Mobile: drops from under the sticky header, full width.
          "inset-x-3 top-16 max-h-[70vh]",
          // Desktop: width only — `anchored` supplies top/right so the panel
          // lines up with the bell instead of the viewport edge.
          "md:inset-x-auto md:w-96",
        )}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <span className="font-display text-sm font-semibold">
            Notifications
          </span>
          <span className="text-xs text-muted-foreground">
            {items.length > 0 ? "Latest updates" : null}
          </span>
        </div>

        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            You&rsquo;re all caught up.
          </p>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
            {items.map((item) => {
              const Icon = categoryIcon[item.category] ?? Megaphone;
              const inner = (
                <div className="flex gap-3 px-4 py-3">
                  <span
                    className={cn(
                      "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border",
                      item.isRead
                        ? "border-border/60 text-muted-foreground"
                        : "border-primary/30 bg-primary/10 text-primary",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">
                      {item.title}
                    </p>
                    {item.body ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.body}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {relativeTime(item.publishedAt)}
                    </p>
                  </div>
                </div>
              );

              const linkClass =
                "focus-spark block transition-colors hover:bg-muted/60";

              return (
                <li key={item.key}>
                  {item.href?.startsWith("https://") ? (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={onClose}
                      className={linkClass}
                    >
                      {inner}
                    </a>
                  ) : item.href ? (
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={linkClass}
                    >
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>,
    document.body,
  );
}
