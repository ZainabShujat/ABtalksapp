import { candidatePublicId } from "@/features/hire/public-id";
import { isKnownTrack } from "@/features/hire/track-registry";

/**
 * Where a candidate's evidence comes from.
 *
 * Two pools rank on the same rubric but not on the same rows: a program member
 * has a `ProgramMember` record, a challenge participant has an `Enrollment` and
 * a pile of daily submissions. They are different people in different tables,
 * and the only thing the hiring surface needs from either is a handle it can
 * carry to the browser and back.
 *
 * A track slug from `track-registry.ts`, not a closed union. It was
 * `"PROGRAM" | "CLAUDE" | "CHALLENGE_60" | "HACKATHON"`, which made a track added
 * later unaddressable: `decodeCandidateRef` rejected its refs, so its card could
 * render while the shortlist button behind it could never work. The registry is
 * the validator now — see `decodeCandidateRef`.
 */
export type CandidateSource = string;

export type CandidateRef = { source: CandidateSource; id: string };

/**
 * The single handle a card, a cart and a request all address a candidate by.
 *
 * `programMemberId` used to be that handle, which worked exactly as long as
 * every candidate was a program member. Widening the pool meant either lying
 * with the field name or naming the thing honestly; this is the honest one.
 *
 * The id inside is the *internal* id — a `ProgramMember.id` or a `User.id`. It
 * is never the `AB-####` label, which is a display string and must not address
 * a row. And it is never accepted from a client without re-checking eligibility
 * against the source's own table: this is a name for a candidate, not a
 * capability to reach one.
 *
 * No `import "server-only"` — the card renders it into a button.
 */
export function encodeCandidateRef(
  source: CandidateSource,
  id: string,
): string {
  return `${source}:${id}`;
}

export function decodeCandidateRef(raw: string): CandidateRef | null {
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  const source = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  if (!id) return null;
  // The registry decides what a real track is, so a track added later addresses
  // its candidates without this file changing. Still a whitelist: an arbitrary
  // prefix from a client is rejected exactly as before.
  if (!isKnownTrack(source)) return null;
  return { source, id };
}

/**
 * The label shown instead of a name.
 *
 * Hashed from the internal id, so the two pools share one format and neither
 * reveals which table a candidate came from — a recruiter comparing `AB-4021`
 * with `AB-7734` learns nothing about either.
 */
export function refPublicId(raw: string): string {
  const ref = decodeCandidateRef(raw);
  return ref ? candidatePublicId(ref.id) : "AB-????";
}
