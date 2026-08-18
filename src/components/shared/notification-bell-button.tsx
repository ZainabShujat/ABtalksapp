"use client";

import { useEffect } from "react";
import { Bell } from "lucide-react";
import { useNotifications } from "@/components/shared/notification-provider";
import { cn } from "@/lib/utils";

type Props = {
  /** All positioning/sizing comes from the caller. */
  className?: string;
};

export function NotificationBellButton({ className }: Props) {
  const { feed, open, ensureLoaded, setAnchor, openPanel } = useNotifications();

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  // Signed-out viewers (e.g. the public /students/[id] page) get no bell.
  if (feed && !feed.signedIn) return null;

  const unread = feed?.unreadCount ?? 0;

  return (
    <button
      type="button"
      ref={setAnchor}
      onClick={openPanel}
      aria-label={
        unread > 0 ? `Notifications (${unread} unread)` : "Notifications"
      }
      aria-expanded={open}
      className={cn("focus-spark relative", className)}
    >
      <span className="relative">
        <Bell className="size-4" aria-hidden />
        {unread > 0 ? (
          <span
            aria-hidden
            className="absolute -right-1.5 -top-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </span>
    </button>
  );
}
