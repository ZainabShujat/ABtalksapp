export type NotificationCategoryKey =
  | "GENERAL"
  | "WORKSHOP"
  | "HACKATHON"
  | "COHORT"
  | "CHALLENGE";

export type AppNotification = {
  /**
   * Stable, unique, never reused. Admin rows use "admin:<id>"; derived event
   * notifications use their own namespace ("workshop:<eventId>",
   * "hackathon:kickoff", "cohort:<id>:enrolling"). This is what
   * `NotificationRead.notificationKey` stores, which is why it must never
   * change for an item that has already been shown.
   */
  key: string;
  title: string;
  body: string | null;
  href: string | null;
  category: NotificationCategoryKey;
  /** ISO string — already serialised so the feed crosses the Server→Client boundary as-is. */
  publishedAt: string;
  isRead: boolean;
};

export type NotificationFeed = {
  signedIn: boolean;
  items: AppNotification[];
  unreadCount: number;
};

export const EMPTY_FEED: NotificationFeed = {
  signedIn: false,
  items: [],
  unreadCount: 0,
};
