import { z } from "zod";
import { knownIconNames } from "@/components/workshop/events-data";

/**
 * Admin workshop boundaries. Plan 163 phase 2.
 *
 * Shared by `admin-workshop-actions.ts` and the form, so both agree on the
 * rules and the form cannot promise something the action refuses.
 *
 * No server imports here beyond the icon-name list, which is a plain array of
 * strings — the form is a Client Component.
 */

/** `YYYY-MM-DD`, and a real calendar day. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    const probe = new Date(Date.UTC(y, m - 1, d));
    return (
      probe.getUTCFullYear() === y &&
      probe.getUTCMonth() === m - 1 &&
      probe.getUTCDate() === d
    );
  }, "That date does not exist");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

export const WORKSHOP_TRACKS = [
  "WORKSHOP",
  "HACKATHON",
  "COHORT",
  "CHALLENGE",
] as const;

export const workshopResourceSchema = z.object({
  label: z.string().trim().min(1).max(120),
  href: z.string().trim().url().max(2048),
  kind: z.enum(["youtube", "link"]),
});

export const workshopEventSchema = z.object({
  date: isoDate,
  timeLabel: z.string().trim().min(1, "Add a time").max(60),
  title: z.string().trim().min(1, "Add a title").max(200),
  description: z.string().trim().min(1, "Add a description").max(2000),
  host: z.string().trim().min(1, "Add a host").max(120),
  location: z.string().trim().min(1, "Add a location").max(160),
  tag: z.string().trim().min(1, "Add a tag").max(60),
  accent: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #03535F"),
  /**
   * Checked against the client-side map, not free text. A name the map does
   * not know renders a blank card with no error, which is exactly the failure
   * the port's icon assertion exists to prevent — so it is blocked at the
   * boundary rather than discovered on the page.
   */
  iconName: z
    .string()
    .trim()
    .refine((v) => knownIconNames().includes(v), "Unknown icon"),
  track: z.enum(WORKSHOP_TRACKS),
  /**
   * Independent of lifecycle. A published event with this false is legal — the
   * public eligibility rule then keeps it out of the registration experience —
   * and the UI says so rather than looking like publishing failed.
   */
  registrationOpen: z.boolean(),
  register: z.boolean(),
  externalHref: optionalText(2048).refine(
    (v) => v === null || /^https?:\/\//.test(v),
    "Use a full http(s) URL",
  ),
  ctaLabel: optionalText(60),
  youtubeId: optionalText(40),
  duration: optionalText(20),
  durationMinutes: z.number().int().min(1).max(600).nullable().optional(),
  titleAccents: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  takeaways: z.array(z.string().trim().min(1).max(400)).max(12).default([]),
  topics: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  resources: z.array(workshopResourceSchema).max(12).default([]),
});

export type WorkshopEventInput = z.infer<typeof workshopEventSchema>;

export const createWorkshopSchema = workshopEventSchema;
export const updateWorkshopSchema = workshopEventSchema.extend({
  id: z.string().trim().min(1).max(120),
});

export const workshopIdSchema = z.object({
  id: z.string().trim().min(1).max(120),
});

export const workshopReasonSchema = workshopIdSchema.extend({
  reason: z.string().trim().min(8, "Give a reason of at least 8 characters").max(500),
});

/**
 * The event id, derived from the creation date ONCE and immutable afterwards.
 *
 * Built from the `YYYY-MM-DD` string exactly as the admin typed it. Never from
 * a `Date`: converting to a local `Date` and back is what turns a chosen 10th
 * into a stored 9th or 11th, and the id is the roster key — 366 registrations
 * point at these strings.
 *
 * **Only ever called on create.** Editing a workshop's date moves the `date`
 * column and leaves the id alone, so a session pushed back a week keeps its
 * registrations.
 */
export function deriveWorkshopId(isoDateString: string): string {
  return `workshop-${isoDateString}`;
}
