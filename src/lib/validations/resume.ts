import { z } from "zod";

/**
 * Zod at the résumé action boundary.
 *
 * The uploaded file itself is NOT validated here — a Zod schema can only see
 * the browser-supplied name and type, both of which are attacker-controlled.
 * Acceptance is decided server-side from the actual bytes, in
 * `features/resume/ingest.ts`.
 */

export const resumeLinkSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Paste a link to your résumé")
    .max(500, "That link is too long")
    .url("Must be a valid URL"),
});

export type ResumeLinkInput = z.infer<typeof resumeLinkSchema>;
