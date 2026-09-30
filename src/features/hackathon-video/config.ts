/**
 * VideoThon (video editors hackathon) — event config.
 *
 * Working name and dates are TODO(organizer). The whole flow scaffolds
 * end-to-end against the placeholders below; final values swap in without
 * touching component code (every string here has one home).
 *
 * Sibling to `src/components/hackathon/hackathon-config.ts` (code hackathon,
 * postponed). This one lives under `features/` because it's read by both
 * client and server code and belongs with the rest of the video-track
 * feature (`features/hackathon-video/*`).
 */

import { isHackathonPreviewEnabled } from "@/lib/feature-flags";

export const VIDEOTHON = {
  // TODO(organizer): finalize this slug before shipping the first row. It is
  // written to every HackathonVideoRegistration.eventId and cannot easily be
  // renamed once real rows exist. `videothon-1` is a safe default.
  eventId: "videothon-1",

  // TODO(organizer): rename if the event is called anything other than VideoThon.
  name: "VideoThon",
  tagline: "24 hours. One brief. Cut something worth watching.",

  // Manual kill switch (cutover / emergency). Time gate is registrationClosesUtc.
  registrationOpen: true,

  // Event window (changed 2026-09-28 to 24 hours): kickoff Fri 9 Oct
  // 8:00 PM IST, deadline Sat 10 Oct 8:00 PM IST. UTC = IST − 5:30.
  kickoffUtc: "2026-10-09T14:30:00Z", // Fri 9 Oct · 8:00 PM IST
  deadlineUtc: "2026-10-10T14:30:00Z", // Sat 10 Oct · 8:00 PM IST
  registrationClosesUtc: "2026-10-09T12:30:00Z", // Fri 9 Oct · 6:00 PM IST

  kickoffLabel: "Friday, 9 Oct · 8:00 PM IST",
  deadlineLabel: "Saturday, 10 Oct · 8:00 PM IST",
  resultsLabel: "Winners announced: Friday, 16 Oct",
  registrationClosesLabel: "Registration closes Friday, 9 Oct · 6:00 PM IST",

  // Live WhatsApp group link (locked in 2026-09-25). The Coming Soon that
  // this replaces did not have a Discord — leaving that slot empty by
  // design. Add one if it comes back.
  whatsappLink: "https://chat.whatsapp.com/D4TiA9y16nl3JGjo7drtCo",
  discordLink: "" as string,

  // TODO(organizer): decide whether VideoThon is themeless or brief-picked.
  // The current build assumes ONE open prompt announced on WhatsApp; the
  // dashboard renders the string below directly, no picker. Wire in briefs
  // (like the code hackathon's HackathonProblem rows) as a follow-up.
  brief: "Create a video to demonstrate ABTalks.in website at your creativity and skills.",
  // TODO(organizer): sponsor slot. Set `enabled: false` to hide the panel.
  sponsor: {
    enabled: false as boolean,
    name: "" as string,
    kicker: "Sponsor" as string,
    headline: "" as string,
    blurb: "" as string,
    siteUrl: "" as string,
  },

  // TODO(organizer): fill prize tiers before kickoff. Empty ⇒ prizes section
  // renders the "revealed soon" state.
  prizes: [] as Array<{ place: string; reward: string }>,
} as const;

/** Open while the kill switch is on and now is before registrationClosesUtc. */
export function isVideothonRegistrationOpen(now: number = Date.now()): boolean {
  if (!VIDEOTHON.registrationOpen) return false;
  return now < new Date(VIDEOTHON.registrationClosesUtc).getTime();
}

export type VideothonSubmissionWindow = {
  unlocked: boolean;
  closed: boolean;
  editable: boolean;
};

/**
 * Window for the submission surface. Distinct from the registration gate.
 *
 * Local preview: `HACKATHON_PREVIEW=true` in `.env.local` unlocks the brief and
 * the submission form before kickoff — under `next dev` only, so the flag can
 * never open the window in production. It lifts the kickoff lock only; the
 * deadline still closes submissions.
 */
export function getVideothonSubmissionWindow(
  now: number = Date.now(),
): VideothonSubmissionWindow {
  const kickoff = new Date(VIDEOTHON.kickoffUtc).getTime();
  const deadline = new Date(VIDEOTHON.deadlineUtc).getTime();
  const preview =
    process.env.NODE_ENV === "development" && isHackathonPreviewEnabled();
  const unlocked = now >= kickoff || preview;
  const closed = now >= deadline;
  return { unlocked, closed, editable: unlocked && !closed };
}
