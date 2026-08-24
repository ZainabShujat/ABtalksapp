/**
 * Every candidate track the platform can search, as data.
 *
 * This replaces a hardcoded union. `CandidateSource` was
 * `"PROGRAM" | "CLAUDE" | "CHALLENGE_60" | "HACKATHON"`, `pool-brief` carried a
 * regex per track, `resolveSources` mapped a geo to three of them by hand, and
 * `searchCandidates` branched on four booleans. A fifth track — a Java
 * challenge, a sales cohort — cost a change in six files, so Scout could not
 * answer "java candidates who finished the training" for a track that had not
 * been hardcoded yet.
 *
 * A track is now one descriptor. Scout reads this list at runtime through the
 * `list_tracks` tool, so the model is never asked to remember which tracks
 * exist, and the tool that filters takes slugs as free strings rather than an
 * enum — an enum in a tool schema is precisely what makes tomorrow's track
 * unspeakable.
 *
 * DELIBERATELY PURE. No Prisma, no `server-only`: `pool-brief.ts` imports this
 * for aliases and is itself reachable from the client through
 * `guest-matches-store`. Row loading lives in `track-loaders.ts`, which is
 * server-only. Keep that split — importing a dossier builder here would drag
 * Prisma into the browser bundle.
 */
import { hireChallengePool } from "@/lib/feature-flags";

/** India runs the student tracks; the US cohort is the professional one. */
export type TrackGeo = "IN" | "US";

export type TrackDescriptor = {
  /**
   * Stable identifier, and the wire format.
   *
   * These four values are LEGACY and must not be renamed: `encodeCandidateRef`
   * writes `"CLAUDE:<id>"` into guest carts (localStorage) and onto stored match
   * rows, so a rename orphans data a recruiter already has. New tracks are free
   * to use a readable slug like `"java-challenge"`.
   */
  slug: string;
  /** What Scout calls it to a recruiter. */
  label: string;
  /**
   * What a recruiter might type. Matched case-insensitively as whole words.
   *
   * Typo tolerance is deliberate and was learned the hard way: "cllaude" used to
   * silently drop the whole search.
   */
  aliases: RegExp[];
  /**
   * The proof this track actually produces, in the recruiter's words.
   *
   * Scout reads these out when asked what evidence exists. They are descriptive
   * today — the scorer still has fixed dimensions, so a track whose evidence is
   * not in that fixed set can be filtered and listed but not yet ranked on its
   * own terms. Generalising the scorer is plan 081.
   */
  evidenceKinds: string[];
  /** Which geography this track's people are, when that is knowable at all. */
  geo: TrackGeo | null;
  /**
   * Whether a day floor means anything here.
   *
   * The challenge tracks record a submission per day, so "30+ days" is a real
   * filter. The hackathon is one weekend — a day floor on it is meaningless and
   * must not silently empty the result.
   */
  supportsEvidenceDays: boolean;
  /**
   * Who wins when one person is in two tracks. Higher wins.
   *
   * Somebody who did the challenge and then joined the cohort has evidence in
   * both tables; the program record is richer (graded project, interview), so it
   * is the card that should show. This encodes the rule that
   * `searchCandidates` previously spelled out with a `programUserIds` set.
   */
  dedupePriority: number;
  /** Absent means always on. */
  enabled?: () => boolean;
};

export const TRACKS: readonly TrackDescriptor[] = [
  {
    slug: "PROGRAM",
    label: "AI Cohort",
    aliases: [/\bcohort\b/i, /\bprogram\b/i, /\bb2b\b/i, /\bworking professionals?\b/i, /\bprofessionals?\b/i],
    evidenceKinds: ["missions passed", "first-attempt passes", "commit days", "graded projects", "recorded interview"],
    geo: "US",
    supportsEvidenceDays: false,
    dedupePriority: 100,
  },
  {
    slug: "CLAUDE",
    label: "Claude challenge",
    // cllaude / clauude — the typo that otherwise drops the search silently.
    aliases: [/\bcl+au+de\b/i],
    evidenceKinds: ["missions passed", "first-attempt passes", "commit days"],
    geo: "IN",
    supportsEvidenceDays: true,
    dedupePriority: 50,
    enabled: () => hireChallengePool().enabled,
  },
  {
    slug: "CHALLENGE_60",
    label: "60-day challenge",
    aliases: [/\b60[-\s]?day\b/i, /\bsixty[-\s]?day\b/i, /\bse track\b/i, /\bds track\b/i, /\bai track\b/i, /\bsubmissions?\b/i],
    evidenceKinds: ["daily submissions", "missions passed", "commit days"],
    geo: "IN",
    supportsEvidenceDays: true,
    dedupePriority: 40,
    enabled: () => hireChallengePool().enabled,
  },
  {
    slug: "HACKATHON",
    label: "Hackathon",
    aliases: [/\bhackathons?\b/i, /\bhackathoners?\b/i, /\bvibe code\b/i],
    evidenceKinds: ["shipped projects"],
    geo: "IN",
    supportsEvidenceDays: false,
    dedupePriority: 30,
  },
];

export function enabledTracks(): TrackDescriptor[] {
  return TRACKS.filter((t) => t.enabled?.() ?? true);
}

export function findTrack(slug: string): TrackDescriptor | null {
  const want = slug.trim().toUpperCase();
  return (
    TRACKS.find((t) => t.slug.toUpperCase() === want) ??
    // Tolerate a readable form of a legacy slug ("challenge-60" for
    // CHALLENGE_60), because the model will reasonably produce one.
    TRACKS.find((t) => t.slug.toUpperCase().replace(/[-_]/g, "") === want.replace(/[-_]/g, "")) ??
    null
  );
}

export function isKnownTrack(slug: string): boolean {
  return findTrack(slug) !== null;
}

/**
 * Tracks a recruiter's own words name, in registry order.
 *
 * This is the corroboration half of the two-key rule: the model may propose a
 * filter, but it only applies if the recruiter's text actually says so. A stray
 * keyword cannot act on its own either, because the model has to have proposed
 * it. Neither side can move the brief alone.
 */
export function matchTracks(rawText: string): TrackDescriptor[] {
  const text = rawText.trim();
  if (!text) return [];
  // Matches against ALL tracks, not just enabled ones, on purpose. Reading a
  // recruiter's words is separate from deciding what is searchable: the feature
  // flag is enforced once, at search time. Filtering here instead would make
  // "claude challenge" parse to nothing whenever the flag is off, which is a
  // silently different brief rather than an honest refusal.
  return TRACKS.filter((t) => t.aliases.some((re) => re.test(text)));
}

/** Tracks implied by a stated geography, when no track was named outright. */
export function tracksForGeo(geo: TrackGeo): TrackDescriptor[] {
  return TRACKS.filter((t) => t.geo === geo);
}

/** What `list_tracks` hands the model. Shape is the contract — keep it small. */
export function describeTracks(): {
  slug: string;
  label: string;
  evidenceKinds: string[];
  geo: TrackGeo | null;
  supportsEvidenceDays: boolean;
}[] {
  return enabledTracks().map((t) => ({
    slug: t.slug,
    label: t.label,
    evidenceKinds: t.evidenceKinds,
    geo: t.geo,
    supportsEvidenceDays: t.supportsEvidenceDays,
  }));
}

/**
 * Rewrite any slug that leaked into recruiter-facing prose into its label.
 *
 * The prompt has told the model not to say slugs since the first version, and it
 * said them anyway — "Do you mean the AI Cohort (PROGRAM) or the Claude
 * challenge?" went to a real recruiter. A rule the model can forget is not a
 * guarantee; this is the harness enforcing it after the fact, which is where an
 * invariant belongs.
 */
export function delugSlugs(text: string): string {
  let out = text;
  for (const t of TRACKS) {
    // Parenthesised first — "(PROGRAM)" should vanish, not become "(AI Cohort)"
    // beside the label it is already glossing.
    out = out.replace(
      new RegExp(`\\s*\\(\\s*${t.slug}\\s*\\)`, "g"),
      "",
    );
    out = out.replace(new RegExp(`\\b${t.slug}\\b`, "g"), t.label);
  }
  return out;
}

/** Human-readable track names, for a notice or an acknowledgement. */
export function trackLabels(slugs: string[]): string[] {
  return slugs
    .map((s) => findTrack(s)?.label)
    .filter((l): l is string => Boolean(l));
}
