import type { JobSpec } from "@/lib/validations/hire";
import {
  HIRE_SLOTS,
  isSlotFilled,
  skippedSlots,
  type HireSlot,
} from "@/lib/validations/hire";
import type { CandidateSource } from "@/features/hire/candidate-ref";
import {
  findTrack,
  isKnownTrack,
  matchTracks,
  trackLabels,
  tracksForGeo,
} from "@/features/hire/track-registry";

export type PoolGeo = "IN" | "US";

export type PoolBrief = {
  sources: CandidateSource[];
  geo: PoolGeo | null;
  minEvidenceDays: number | null;
  resultLimit: number | null;
  title: string | null;
  mustHaveStack: string[];
};

const EMPTY: PoolBrief = {
  sources: [],
  geo: null,
  minEvidenceDays: null,
  resultLimit: null,
  title: null,
  mustHaveStack: [],
};

/**
 * Pull a searchable brief out of free text. No model.
 *
 * Geography is a *track*, not GPS. This platform's challenge / hackathon
 * people are Indian students; the /program cohort is the US professional
 * track. We do not pretend anyone filled in a city.
 */
export function extractPoolBrief(raw: string): PoolBrief {
  const msg = raw.trim().toLowerCase();
  if (!msg) return EMPTY;

  // Track names come from the registry, not from regexes kept here. A new track
  // is a descriptor in `track-registry.ts` and needs no change in this file.
  const sources: CandidateSource[] = matchTracks(msg).map(
    (t) => t.slug as CandidateSource,
  );

  let geo: PoolGeo | null = null;
  const wantsIndia = /\b(india|indian|bharat)\b/.test(msg);
  const wantsUs = /\b(usa|u\.s\.a|united states|\bus\b|america|american)\b/.test(
    msg,
  );
  if (wantsIndia && !wantsUs) geo = "IN";
  if (wantsUs && !wantsIndia) geo = "US";

  let minEvidenceDays: number | null = parseDays(msg);
  if (
    minEvidenceDays == null &&
    /\b(completed?|finished|certified|certificate)\b/.test(msg) &&
    (sources.includes("CLAUDE") ||
      sources.includes("CHALLENGE_60") ||
      /\bchallenge\b/.test(msg))
  ) {
    minEvidenceDays = 60;
  }

  const resultLimit = parseResultLimit(msg);

  const roleStack = extractRoleStack(msg);

  return { sources, geo, minEvidenceDays, resultLimit, ...roleStack };
}

/**
 * An evidence-day floor stated in words, or null.
 *
 * "60-day challenge" is a track name, not a floor. Prefer "at least N", then
 * "N+ days", then a bare "N days" only after stripping the track phrase.
 *
 * Exported because it is half of the two-key rule in `confirmPoolBrief`: the
 * model may propose a day floor, but it is only applied if this function can
 * find the same number in what the recruiter actually wrote.
 */
export function parseDays(raw: string): number | null {
  const msg = raw.trim().toLowerCase();
  if (!msg) return null;
  const prefixed = msg.match(
    /(?:at\s*least|atleast|minimum|min(?:\.|imum)?|over|more than|>=)\s*(\d{1,2})\s*days?/,
  );
  const plus = prefixed
    ? null
    : msg.match(/(\d{1,2})\s*\+\s*days?|(\d{1,2})\s*days?\s*\+/);
  const bare =
    prefixed || plus
      ? null
      : msg.replace(/\b60[-\s]?days?\b/g, " ").match(/(\d{1,2})\s*days?/);
  const n = prefixed
    ? Number(prefixed[1])
    : plus
      ? Number(plus[1] ?? plus[2])
      : bare
        ? Number(bare[1])
        : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 60 ? n : null;
}

const COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fifteen: 15,
  twenty: 20,
};

/** Same ceiling as an unscoped search — they can ask for 20, not 200. */
const RESULT_LIMIT_MAX = 25;

function parseCountToken(raw: string): number | null {
  const w = raw.toLowerCase();
  if (COUNT_WORDS[w] != null) return COUNT_WORDS[w]!;
  // "fivce" / "fivve" — the typo that left Scout repeating the standing prompt.
  if (/^fiv/.test(w)) return 5;
  if (/^twen/.test(w)) return 20;
  const n = Number(w);
  if (Number.isFinite(n) && n >= 1 && n <= RESULT_LIMIT_MAX) return n;
  return null;
}

const COUNT_TOKEN = "\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|fiv\\w*|twen\\w*";

/** Exported for the same two-key reason as `parseDays`. */
export function parseResultLimit(msg: string): number | null {
  const prefixed = msg.match(
    new RegExp(
      `(?:only|just|top|first|give\\s+me|list(?:\\s+of)?|show(?:\\s+me)?)\\s+(${COUNT_TOKEN})(?:\\s*(?:candidates?|people|profiles?|students?))?`,
    ),
  );
  // "20 student from claude" / "5 from cohort" — a count, not "60 day".
  const counted = prefixed
    ? null
    : msg.match(
        new RegExp(
          `\\b(${COUNT_TOKEN})\\s+(?:candidates?|students?|people|profiles?)\\b`,
        ),
      );
  const from = prefixed || counted
    ? null
    : msg.match(new RegExp(`\\b(${COUNT_TOKEN})\\s+from\\b`));
  const token = prefixed?.[1] ?? counted?.[1] ?? from?.[1];
  return token ? parseCountToken(token) : null;
}

const ROLE_HINTS: { re: RegExp; title: string }[] = [
  { re: /\bfull[-\s]?stack\b/, title: "Full-stack engineer" },
  { re: /\bback[-\s]?end\b/, title: "Backend engineer" },
  { re: /\bfront[-\s]?end\b/, title: "Frontend engineer" },
  { re: /\bdata\s*\/?\s*ml\b|\bdata engineer|\bml engineer\b/, title: "Data / ML engineer" },
  { re: /\bai engineer\b/, title: "AI engineer" },
];

const STACK_HINTS = [
  "python",
  "java",
  "javascript",
  "typescript",
  "react",
  "node",
  "nodejs",
  "sql",
  "golang",
  "go",
  "rust",
  "kotlin",
  "swift",
  "c++",
  "django",
  "flask",
  "spring",
  "fastapi",
];

function extractRoleStack(msg: string): {
  title: string | null;
  mustHaveStack: string[];
} {
  let title: string | null = null;
  for (const hint of ROLE_HINTS) {
    if (hint.re.test(msg)) {
      title = hint.title;
      break;
    }
  }
  const mustHaveStack: string[] = [];
  for (const token of STACK_HINTS) {
    const re =
      token === "go"
        ? /\bgo\b(?!lang)/
        : new RegExp(`\\b${token.replace(/\+/g, "\\+")}\\b`, "i");
    if (re.test(msg)) {
      mustHaveStack.push(token === "nodejs" ? "node" : token);
    }
  }
  return { title, mustHaveStack: dedupeStack(mustHaveStack) };
}

function dedupeStack(tokens: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Does this brief actually restrict anything?
 *
 * Geo is deliberately NOT enough on its own. It used to be, and that is the
 * whole reported bug: "who is prime minister of india" matched the India regex,
 * `briefTouched` went true on geo alone, `resolveSources` invented three tracks
 * from it, and Scout ran a search on a trivia question. A geography modifies a
 * brief — it is never a brief by itself.
 *
 * This guard is independent of the model, so the bug stays fixed even when the
 * agent misreads a message.
 */
export function briefTouched(brief: PoolBrief): boolean {
  return (
    brief.sources.length > 0 ||
    brief.minEvidenceDays !== null ||
    brief.resultLimit !== null
  );
}

/**
 * India → student tracks. US → the professional cohort.
 * An explicit source always wins over the geo default.
 */
export function resolveSources(brief: PoolBrief): CandidateSource[] {
  if (brief.sources.length > 0) return [...new Set(brief.sources)];
  // Geo alone never reaches here through `briefTouched` any more, but a geo
  // stated alongside a day floor or a result cap still selects the tracks. The
  // mapping is the registry's, so a new India track joins it automatically.
  if (brief.geo) {
    return tracksForGeo(brief.geo).map((t) => t.slug as CandidateSource);
  }
  return [];
}

/**
 * Keep only what the recruiter's own words support.
 *
 * The two-key rule, and the reason the reported bug cannot come back in a new
 * form. The agent proposes a filter; this decides whether it applies. A filter
 * needs BOTH keys:
 *
 *   - the model asked for it (it is in `proposed`), and
 *   - the raw message says so (`matchTracks` / `parseDays` / `parseResultLimit`
 *     can point at the words)
 *
 * So the model cannot invent a filter out of context, and a stray keyword
 * cannot act without the model having read the message as a brief. Rejections
 * are returned rather than dropped: the tool hands them back to the model, which
 * must tell the recruiter what was not applied and why.
 */
export function confirmPoolBrief(
  raw: string,
  proposed: {
    trackSlugs?: string[] | null;
    geo?: PoolGeo | null;
    minEvidenceDays?: number | null;
    resultLimit?: number | null;
  },
  /** This turn's message. Falls back to `raw` when a caller has only one. */
  currentMessage = "",
): {
  brief: PoolBrief;
  rejected: { field: string; value: string; reason: string }[];
} {
  const rejected: { field: string; value: string; reason: string }[] = [];

  // THE RECRUITER'S WORDS ARE THE AUTHORITY, not the model's guess.
  //
  // Told "5 student from cohort challnege" the model proposed the Claude
  // challenge — "cohort CHALLENGE" contains both track names — and the guard
  // simply refused it without saying what was actually named. The model had no
  // way back, so it asked which track; the recruiter answered; it asked again.
  // Five times, and no search ever ran.
  //
  // The engine never had that problem: `matchTracks` resolves "cohort challnege"
  // to the AI Cohort every time. So the words decide, the model's proposal only
  // signals that filtering is intended, and a disagreement is reported as a
  // correction rather than a dead end.
  //
  // Current message first, conversation second: a recruiter who says "actually
  // the hackathon" must not keep the track they named three messages ago, while
  // one who says "nothing just give me the 5" must keep it.
  const namedNow = matchTracks(currentMessage || raw);
  const named = namedNow.length > 0 ? namedNow : matchTracks(raw);
  const namedSlugs = new Set(named.map((t) => t.slug));

  const sources: CandidateSource[] = named.map((t) => t.slug as CandidateSource);

  for (const slug of proposed.trackSlugs ?? []) {
    const track = findTrack(slug);
    if (!track) {
      rejected.push({
        field: "trackSlugs",
        value: slug,
        // Naming what does exist is what lets the model recover on the next hop
        // instead of repeating itself.
        reason: `There is no track "${slug}".`,
      });
      continue;
    }
    if (!namedSlugs.has(track.slug)) {
      rejected.push({
        field: "trackSlugs",
        value: slug,
        reason: named.length
          ? `The recruiter said ${named.map((t) => t.label).join(" and ")}, not the ${track.label}. I applied what they said — do not ask them again.`
          : `The recruiter did not name the ${track.label}. Ask before filtering on it.`,
      });
    }
  }

  // Geo is a modifier: it only survives alongside a confirmed track, and only
  // if the recruiter actually said it. This is the reported bug's second lock.
  const geoWord = /\b(india|indian|bharat)\b/i.test(raw)
    ? "IN"
    : /\b(usa|u\.s\.a|united states|\bus\b|america|american)\b/i.test(raw)
      ? "US"
      : null;
  let geo: PoolGeo | null = null;
  if (proposed.geo) {
    if (proposed.geo !== geoWord) {
      rejected.push({
        field: "geo",
        value: proposed.geo,
        reason: "The recruiter did not state that geography.",
      });
    } else if (sources.length === 0) {
      rejected.push({
        field: "geo",
        value: proposed.geo,
        reason:
          "A geography on its own is not a search. Name a track, or ask what tracks exist.",
      });
    } else {
      geo = proposed.geo;
    }
  }

  // Same authority rule as the track: the number the recruiter wrote wins.
  // Current message first so "make it 10 days instead" replaces an older floor.
  const days = parseDays(currentMessage) ?? parseDays(raw);
  let minEvidenceDays: number | null = null;
  if (proposed.minEvidenceDays != null || days != null) {
    const track = named.find((t) => t.supportsEvidenceDays);
    if (days == null) {
      rejected.push({
        field: "minEvidenceDays",
        value: String(proposed.minEvidenceDays),
        reason: "The recruiter did not state that many days.",
      });
    } else if (sources.length > 0 && !track) {
      // A day floor on a one-weekend track silently empties the result, which
      // reads as "nobody qualifies" rather than "that filter means nothing here".
      rejected.push({
        field: "minEvidenceDays",
        value: String(proposed.minEvidenceDays),
        reason: `${trackLabels(sources).join(" and ")} does not record evidence per day, so a day floor cannot apply.`,
      });
    } else {
      if (proposed.minEvidenceDays != null && proposed.minEvidenceDays !== days) {
        rejected.push({
          field: "minEvidenceDays",
          value: String(proposed.minEvidenceDays),
          reason: `The recruiter said ${days} days. I applied ${days} — say ${days}, not ${proposed.minEvidenceDays}.`,
        });
      }
      minEvidenceDays = days;
    }
  }

  // "5 student from cohort challnege" states a cap whether or not the model
  // thinks to pass one along. It is what they asked for.
  const limit =
    parseResultLimit(currentMessage.toLowerCase()) ??
    parseResultLimit(raw.toLowerCase());
  let resultLimit: number | null = null;
  if (proposed.resultLimit != null || limit != null) {
    if (limit == null) {
      rejected.push({
        field: "resultLimit",
        value: String(proposed.resultLimit),
        reason: "The recruiter did not ask for that many.",
      });
    } else {
      // Applied from their words, but the model must be told it was wrong or it
      // will announce its own number to the recruiter.
      if (proposed.resultLimit != null && proposed.resultLimit !== limit) {
        rejected.push({
          field: "resultLimit",
          value: String(proposed.resultLimit),
          reason: `The recruiter asked for ${limit}. I applied ${limit} — say ${limit}, not ${proposed.resultLimit}.`,
        });
      }
      resultLimit = limit;
    }
  }

  return {
    brief: { ...EMPTY, sources, geo, minEvidenceDays, resultLimit },
    rejected,
  };
}

export function applyPoolBrief(spec: JobSpec, brief: PoolBrief): JobSpec {
  const hasRole = Boolean(brief.title) || brief.mustHaveStack.length > 0;
  if (!briefTouched(brief) && !hasRole) return spec;
  const prior = (spec.extra ?? {}) as Record<string, unknown>;
  const sources = resolveSources(brief);
  return {
    ...spec,
    ...(brief.title ? { title: brief.title } : {}),
    ...(brief.mustHaveStack.length
      ? { mustHaveStack: brief.mustHaveStack }
      : brief.sources.length > 0
        ? { mustHaveStack: [] }
        : {}),
    extra: briefTouched(brief)
      ? {
          ...prior,
          ...(sources.length > 0 ? { poolSources: sources } : {}),
          ...(brief.geo ? { poolGeo: brief.geo } : {}),
          ...(brief.minEvidenceDays != null
            ? { minEvidenceDays: brief.minEvidenceDays }
            : {}),
          ...(brief.resultLimit != null
            ? { resultLimit: brief.resultLimit }
            : {}),
        }
      : spec.extra,
  };
}

export function isSearchableBrief(spec: JobSpec): boolean {
  const extra = (spec.extra ?? {}) as Record<string, unknown>;
  const sources = extra.poolSources;
  return (
    (Array.isArray(sources) && sources.length > 0) ||
    typeof extra.minEvidenceDays === "number" ||
    typeof extra.resultLimit === "number"
  );
}

/** Mark every unanswered intake slot skipped so Scout does not restart the form. */
export function skipUnfilledIntake(spec: JobSpec): JobSpec {
  const already = skippedSlots(spec);
  const add: HireSlot[] = [];
  for (const slot of HIRE_SLOTS) {
    if (!already.has(slot) && !isSlotFilled(spec, slot)) add.push(slot);
  }
  if (add.length === 0) return spec;
  const prior = (spec.extra ?? {}) as Record<string, unknown>;
  const skipped = [...already, ...add];
  return { ...spec, extra: { ...prior, skipped } };
}

export function briefAck(brief: PoolBrief): string {
  const bits: string[] = [];
  const sources = resolveSources(brief);
  if (sources.includes("CLAUDE")) bits.push("Claude challenge");
  if (sources.includes("CHALLENGE_60")) bits.push("60-day submissions");
  if (sources.includes("HACKATHON")) bits.push("hackathon");
  if (sources.includes("PROGRAM")) bits.push("the professional cohort");
  if (brief.geo === "IN") bits.push("India track");
  if (brief.geo === "US" && !sources.includes("CLAUDE")) bits.push("US cohort");
  if (brief.minEvidenceDays != null) {
    bits.push(`${brief.minEvidenceDays}+ verified days`);
  }
  if (brief.resultLimit != null) bits.push(`top ${brief.resultLimit}`);
  const roleBits: string[] = [];
  if (brief.title) roleBits.push(brief.title);
  if (brief.mustHaveStack.length) roleBits.push(brief.mustHaveStack.join(" / "));
  if (bits.length === 0 && roleBits.length === 0) {
    return "Searching the verified pool.";
  }
  if (bits.length === 0) return `Re-ranking on ${roleBits.join(", ")}.`;
  const head = `Searching ${bits.join(", ")}`;
  return roleBits.length ? `${head} · ${roleBits.join(", ")}.` : `${head}.`;
}

/** US + Claude is a mixed ask: Claude is the India-student track. */
export function mixedTrackNotice(brief: PoolBrief): string | null {
  const sources = resolveSources(brief);
  if (brief.geo === "US" && sources.includes("CLAUDE")) {
    return "Claude is an India-student track. I'll search it anyway — US here is the professional cohort.";
  }
  return null;
}

export function readPoolExtra(spec: JobSpec): {
  sources: CandidateSource[];
  geo: PoolGeo | null;
  minEvidenceDays: number | null;
  resultLimit: number | null;
} {
  const extra = (spec.extra ?? {}) as Record<string, unknown>;
  const raw = extra.poolSources;
  // Validated against the registry, not a literal list. Hardcoding the four
  // slugs here silently stripped any newer track when the spec was read back:
  // the agent could set the filter, and this dropped it on the way out — the
  // same closed-world bug as the old `CandidateSource` union, one layer down.
  const sources = Array.isArray(raw)
    ? raw.filter(
        (s): s is CandidateSource =>
          typeof s === "string" && isKnownTrack(s),
      )
    : [];
  const min =
    typeof extra.minEvidenceDays === "number" ? extra.minEvidenceDays : null;
  const limit =
    typeof extra.resultLimit === "number" ? extra.resultLimit : null;
  // `applyPoolBrief` writes poolGeo, but this reader never returned it, so
  // `labelGuestSearch` read undefined and every geo-only guest search was
  // labelled "Search" instead of "India". It also broke the build.
  const geo = extra.poolGeo === "IN" || extra.poolGeo === "US"
    ? extra.poolGeo
    : null;
  return { sources, geo, minEvidenceDays: min, resultLimit: limit };
}
