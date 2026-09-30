import type { AppNotification, NotificationCategoryKey } from "./types";
import type { DerivedNotification } from "./derive-event-notifications";

/**
 * T-249 recruiter-side feed filter.
 *
 * Pure. Separate from `get-notifications.ts` so the filter has a unit
 * test — the previous inline version had none, and a fix that missed
 * one branch would ship silently.
 *
 * Kept as one function returning the three arrays instead of three
 * exports so the recruiter/candidate switch is enforced once — a caller
 * cannot forget to apply one of the arms.
 */

/**
 * The eventTypes a recruiter should be told about in `/hire`. Anything else
 * on a `UserNotification` row is candidate-flavoured and stays off the
 * recruiter bell — a user who is both a recruiter and a candidate stops
 * seeing job.alert.match / profile.viewed / job.closed on the /hire bell.
 */
export const RECRUITER_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  "application.received",
  "application.status_changed",
  "assessment.completed",
  "outreach.reply_received",
  "outreach.message_received",
  "system.notice",
  "auth.password_reset",
]);

/**
 * `audience` is set only on admin broadcast rows (the `NotificationAudience`
 * the admin picked). It exists for the recruiter filter below and is stripped
 * before the feed crosses to the client.
 */
export type FeedInputRow = Omit<AppNotification, "isRead"> & {
  audience?: string;
};

/**
 * Admin audiences that explicitly include recruiters. A broadcast sent to
 * "Everyone" or "All recruiters" must reach /hire whatever its category —
 * the category is only an icon, not a targeting decision.
 */
const RECRUITER_ADDRESSED_AUDIENCES: ReadonlySet<string> = new Set<string>([
  "ALL",
  "RECRUITER",
]);

export type FilteredFeedParts = {
  adminItems: FeedInputRow[];
  derivedItems: DerivedNotification[];
  userItems: FeedInputRow[];
};

/**
 * Applies the T-249 recruiter-side filters:
 *
 * - `derivedItems` are removed entirely for a recruiter. Hackathon
 *   registration, workshop invites and cohort enrolment reminders are
 *   candidate-side platform prompts and do not belong on `/hire`.
 * - `adminItems` are kept for a recruiter when the admin addressed them
 *   to recruiters (audience ALL or RECRUITER, any category), or when the
 *   category is GENERAL. Track-audience broadcasts with a track category
 *   (e.g. a CHALLENGE notice to CHALLENGE students) stay off `/hire`.
 * - `userItems` are narrowed to the recruiter-facing eventTypes above,
 *   plus any row with no eventType (defensive — an unrecognised row
 *   would otherwise vanish silently).
 *
 * Candidate viewers are unchanged: filters only apply when `isRecruiter`
 * is `true`.
 */
export function filterFeedForView(
  input: FilteredFeedParts,
  isRecruiter: boolean,
): FilteredFeedParts {
  if (!isRecruiter) return input;

  return {
    adminItems: input.adminItems.filter(
      (item) =>
        (item.audience !== undefined &&
          RECRUITER_ADDRESSED_AUDIENCES.has(item.audience)) ||
        (item.category as NotificationCategoryKey) === "GENERAL",
    ),
    derivedItems: [],
    userItems: input.userItems.filter(
      (item) => !item.eventType || RECRUITER_EVENT_TYPES.has(item.eventType),
    ),
  };
}
