import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { HACKATHON } from "@/components/hackathon/hackathon-config";
import { EVENTS } from "@/components/workshop/events-data";
import { IST, addCalendarDaysToKey } from "@/lib/date-utils";
import type { AppNotification } from "./types";

/**
 * Automated notifications are DERIVED, never stored.
 *
 * Every item here is a pure function of `now` plus data the caller already has,
 * so there is no cron, no backfill and no row to go stale. An item exists only
 * while `now` sits inside its window; outside it the item is simply not
 * produced, which is what makes expiry free.
 *
 * NOTE: `EVENTS` entries carry an `Icon: LucideIcon`. Never copy it (or spread a
 * whole event) into a notification — Lucide components cannot cross the
 * Server→Client boundary. The client picks an icon from `category`.
 */

export type DerivedNotification = Omit<AppNotification, "isRead">;

type EnrollingCohort = {
  id: string;
  name: string;
  startsAt: Date;
};

export type DeriveEventNotificationsInput = {
  now: Date;
  enrollingCohorts: EnrollingCohort[];
  programEnabled: boolean;
  /** `WorkshopRegistration.eventId`s this user already holds — those workshops stay silent. */
  registeredWorkshopEventIds: Set<string>;
  /** True when the user already has a HackathonParticipant row. */
  isHackathonRegistered: boolean;
  /** `ProgramMember.cohortId`s this user already belongs to (any status). */
  joinedCohortIds: Set<string>;
};

/** How many days before a workshop its notification starts showing. */
const WORKSHOP_LEAD_DAYS = 7;
/** How many days before kickoff the hackathon reminder starts showing. */
const HACKATHON_KICKOFF_LEAD_DAYS = 3;
/** How many hours before the deadline the submission reminder starts showing. */
const HACKATHON_DEADLINE_LEAD_HOURS = 12;

const HOUR_MS = 60 * 60 * 1000;

/** UTC instant of IST midnight opening the given `yyyy-MM-dd` calendar day. */
function istMidnightInstant(key: string): Date {
  return fromZonedTime(`${key}T00:00:00`, IST);
}

export function deriveEventNotifications(
  input: DeriveEventNotificationsInput,
): DerivedNotification[] {
  const {
    now,
    enrollingCohorts,
    programEnabled,
    registeredWorkshopEventIds,
    isHackathonRegistered,
    joinedCohortIds,
  } = input;
  const items: DerivedNotification[] = [];
  const todayKey = formatInTimeZone(now, IST, "yyyy-MM-dd");

  // ---- Workshops -----------------------------------------------------------
  // Visible from 7 IST days before the event until the end of the event's own
  // IST day. Keys are `yyyy-MM-dd`, which sorts chronologically as plain
  // strings — the same comparison `isPastEvent` uses in events-data.ts.
  for (const ev of EVENTS) {
    if (!ev.register || !ev.registrationOpen) continue;
    // Already signed up for this exact workshop → nothing to tell them.
    if (registeredWorkshopEventIds.has(ev.id)) continue;

    const opensKey = addCalendarDaysToKey(ev.date, -WORKSHOP_LEAD_DAYS);
    if (todayKey < opensKey || todayKey > ev.date) continue;

    items.push({
      key: `workshop:${ev.id}`,
      title: `Live workshop: ${ev.title}`,
      body: `${ev.time} · ${ev.location}`,
      href: "/ai-workshop",
      category: "WORKSHOP",
      publishedAt: istMidnightInstant(opensKey).toISOString(),
    });
  }

  // ---- Hackathon -----------------------------------------------------------
  const kickoff = new Date(HACKATHON.kickoffUtc);
  const deadline = new Date(HACKATHON.deadlineUtc);
  const registrationCloses = new Date(HACKATHON.registrationClosesUtc);

  // "Register now" is for people who have not registered. Kickoff and deadline
  // reminders are the opposite — only participants have anything to act on.
  if (
    !isHackathonRegistered &&
    HACKATHON.registrationOpen &&
    now < registrationCloses
  ) {
    items.push({
      key: "hackathon:registration",
      title: "Hackathon registration is open",
      body: HACKATHON.registrationClosesLabel,
      href: "/hackathon",
      category: "HACKATHON",
      publishedAt: new Date(
        registrationCloses.getTime() - 7 * 24 * HOUR_MS,
      ).toISOString(),
    });
  }

  const kickoffOpens = new Date(
    kickoff.getTime() - HACKATHON_KICKOFF_LEAD_DAYS * 24 * HOUR_MS,
  );
  if (isHackathonRegistered && now >= kickoffOpens && now < kickoff) {
    items.push({
      key: "hackathon:kickoff",
      title: "Hackathon kicks off soon",
      body: HACKATHON.kickoffLabel,
      href: "/hackathon",
      category: "HACKATHON",
      publishedAt: kickoffOpens.toISOString(),
    });
  }

  const deadlineOpens = new Date(
    deadline.getTime() - HACKATHON_DEADLINE_LEAD_HOURS * HOUR_MS,
  );
  if (isHackathonRegistered && now >= deadlineOpens && now < deadline) {
    items.push({
      key: "hackathon:deadline",
      title: "Hackathon submissions close soon",
      body: HACKATHON.deadlineLabel,
      href: "/hackathon/dashboard",
      category: "HACKATHON",
      publishedAt: deadlineOpens.toISOString(),
    });
  }

  // ---- Program cohort ------------------------------------------------------
  if (programEnabled) {
    for (const cohort of enrollingCohorts) {
      if (cohort.startsAt <= now) continue;
      // Already applied, waitlisted or enrolled → stop advertising it.
      if (joinedCohortIds.has(cohort.id)) continue;

      items.push({
        key: `cohort:${cohort.id}:enrolling`,
        title: `AI Cohort enrolling: ${cohort.name}`,
        body: `Starts ${formatInTimeZone(cohort.startsAt, IST, "d MMM yyyy")}`,
        href: "/program",
        category: "COHORT",
        publishedAt: new Date(
          Math.min(cohort.startsAt.getTime() - 14 * 24 * HOUR_MS, now.getTime()),
        ).toISOString(),
      });
    }
  }

  return items;
}
