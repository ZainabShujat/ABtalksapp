/**
 * Pure parsers for the fields of a job spec.
 *
 * Lifted out of `scout-conversation.ts` so both it and `scout-tools.ts` can use
 * them without a cycle (`scout-conversation` → `scout-agent` → `scout-tools`
 * would otherwise close a loop back to this code).
 *
 * These are the deterministic half of the agent. The model never computes a
 * figure or decides whether a phrase is a job title — it quotes the recruiter and
 * these functions rule. Keeping them pure is what makes them testable without a
 * model, a database or a graph.
 */
import type { JobSpec } from "@/lib/validations/hire";

/** The evidence dimensions the ranker actually weights. */
export const EVIDENCE_KEYS: ReadonlySet<string> = new Set([
  "missions",
  "clean_pass",
  "projects",
  "consistency",
  "interview",
  "stack",
  "data",
  "ai_prompting",
  "communication",
  "ship_speed",
]);

/**
 * Is this a role paid by the month rather than the year?
 *
 * An intern saying "20k" means twenty thousand a month. Read as an annual figure
 * it became ₹20,000 a year — a twelfth of the intent, and silent, because
 * nothing echoed the number back.
 */
export function isMonthlyContext(spec: JobSpec): boolean {
  return spec.seniority === "INTERN" || spec.employmentType === "INTERNSHIP";
}

/**
 * Free-text money → annual rupees, plus the period it was written in.
 *
 * Annual rupees is the canonical unit everywhere: CandidatePreference stores
 * expectations with no period of its own, so the budget has to be comparable to
 * them. `period` is kept only so the requirement can be read back in the units
 * the recruiter used.
 */
/**
 * The clause that is actually about money.
 *
 * "3 years experience, 12-18 lakhs" used to parse as ₹3L–₹18L: the 3 from "3
 * years" became the floor of the budget, silently, and the search then filtered
 * on a band nobody asked for. So when the text names a money unit, only the
 * clause carrying it is read, and clauses that are plainly about duration are
 * dropped.
 */
function moneyClause(lower: string): string {
  const UNIT = /\b\d+(?:\.\d+)?\s*(k|l|lac|lakh|lakhs|lpa|cr|crore|crores)\b|₹|rs\.?\b/;
  if (!UNIT.test(lower)) return lower;
  const clauses = lower.split(/\s*(?:,|;|\band\b|\bwith\b)\s*/);
  const withUnit = clauses.filter((c) => UNIT.test(c));
  return withUnit.length ? withUnit.join(" ") : lower;
}

export function parseMoney(
  msg: string,
  monthlyDefault: boolean,
): { min: number; max: number; period: "ANNUAL" | "MONTHLY" } | null {
  const lower = moneyClause(msg.toLowerCase());

  // Duration is not money. "3 years" in a budget sentence is the single most
  // common way a stray number reached the salary field.
  const cleaned = lower.replace(
    /\b\d+(?:\.\d+)?\s*\+?\s*(years?|yrs?|yr|months?|mos?|days?)\b/g,
    " ",
  );

  // "20k" / "1.5k" — the k was previously dropped, so 20k parsed as 20.
  // "cr" / "crore" — absent entirely, so "1.2 crore" parsed as ₹1,20,000: a
  // hundredfold error on the largest budgets anyone types.
  const matches = [
    ...cleaned.matchAll(
      /(\d+(?:\.\d+)?)\s*(k|lpa|lakhs|lakh|lac|crores|crore|cr|l)?/g,
    ),
  ].filter((m) => m[1] !== undefined && m[0].trim() !== "");
  if (matches.length === 0) return null;

  const full = msg.toLowerCase();
  const saysAnnual = /lpa|per annum|annual|\/\s*(yr|year)|a year|crore|\bcr\b/.test(full);
  const saysMonthly = /month|\/\s*mo\b|\bpm\b|stipend/.test(full);
  const period: "ANNUAL" | "MONTHLY" = saysAnnual
    ? "ANNUAL"
    : saysMonthly || monthlyDefault
      ? "MONTHLY"
      : "ANNUAL";

  // A range carries its unit on the last figure — "12-18 lakhs" marks only the
  // 18 — so an unmarked number inherits the unit the phrase does name.
  const namedUnit = matches.map((m) => m[2]).filter(Boolean).at(-1);

  const scale = (unit: string | undefined, n: number): number => {
    if (unit === "k") return n * 1_000;
    if (unit === "cr" || unit === "crore" || unit === "crores") {
      return n * 10_000_000;
    }
    if (unit) return n * 100_000; // l / lac / lakh / lakhs / lpa
    return n;
  };

  const values = matches.map((m) => {
    const n = Number(m[1]);
    const unit = m[2];
    if (unit) return scale(unit, n);
    if (namedUnit) return scale(namedUnit, n);
    // A bare number in an annual context is already rupees unless it is small
    // enough that nobody means it literally ("12" in "12-18" means lakhs).
    if (period === "ANNUAL" && n < 100) return n * 100_000;
    return n;
  });

  const annual = values.map((v) => (period === "MONTHLY" ? v * 12 : v));
  const min = Math.min(...annual);
  const max = Math.max(...annual);
  if (!Number.isFinite(min) || min < 0) return null;
  return {
    min: Math.round(min),
    max: Math.round(Math.min(max, 100_000_000)),
    period,
  };
}

/**
 * A job title, or nothing.
 *
 * Strips the way people actually phrase a request — "I want a…", "we're looking
 * for…" — and then refuses anything still shaped like a sentence rather than a
 * role. Taking free text verbatim is how a 90-character requirement ended up as
 * the job title and followed the recruiter through every later question.
 */
export function asRoleTitle(raw: string): string | null {
  let s = raw.trim().replace(/\s+/g, " ");

  s = s
    .replace(/^(hi|hey|hello)[,!.\s]+/i, "")
    .replace(
      /^(i\s*(want|need|am looking for|'m looking for)|we\s*(want|need|are looking for|'re looking for)|looking for|show me|give me|find me|get me|hire|hiring for|need)\b\s*/i,
      "",
    )
    .replace(/^(a|an|the|some|few|couple of)\b\s*/i, "")
    .replace(/[.?!]+$/, "")
    .trim();

  if (!s) return null;
  // Sentence-shaped, not role-shaped.
  if (s.length > 60) return null;
  if (s.split(" ").length > 7) return null;
  if (
    /\b(who|whose|which|that has|that have|with at least|atleast|at least)\b/i.test(
      s,
    )
  ) {
    return null;
  }
  return s.slice(0, 200);
}

/**
 * Unambiguous seniority / work-mode words in the recruiter's own message.
 *
 * Used as a seed before the model (same idea as `extractPoolBrief`) and as the
 * safety net when Groq 429s: "mid, work mode will be remote" must not vanish
 * just because the hop ran out of tokens. Negation and long essays are left
 * alone — those belong to the model.
 */
const STACK_STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "in",
  "on",
  "of",
  "for",
  "with",
  "to",
  "who",
  "that",
  "this",
  "only",
  "also",
  "just",
  "should",
  "be",
  "is",
  "am",
  "are",
  "was",
  "know",
  "knows",
  "known",
  "expert",
  "expertise",
  "candidate",
  "candidates",
  "developer",
  "developers",
  "engineer",
  "engineers",
  "person",
  "people",
  "profile",
  "profiles",
  "stack",
  "nothing",
  "else",
  "anything",
  "anyone",
  "someone",
  "something",
  "them",
  "they",
  "their",
  "my",
  "our",
  "me",
  "i",
  "want",
  "need",
  "looking",
  "hire",
  "hiring",
  "skilled",
  "experience",
  "experienced",
  "years",
  "year",
  "mid",
  "senior",
  "junior",
  "intern",
  "level",
  "full",
  "must",
  "have",
  "has",
  "had",
  "please",
  "give",
  "show",
  "list",
  "from",
  "using",
  "use",
  "used",
  "like",
  "really",
  "very",
  "highly",
  "strong",
  "good",
  "great",
  "able",
  "work",
  "working",
]);

/**
 * Stack tokens the recruiter actually named — "know langchain", "in mern stack",
 * "expert in python only". Stopwords and bare numbers are dropped so
 * "only 3 candidates" does not become a skill.
 */
export function extractStatedStack(text: string): string[] {
  const found: string[] = [];
  const push = (raw: string) => {
    const parts = raw
      .trim()
      .toLowerCase()
      .replace(/[,.]+$/g, "")
      .split(/\s+/);
    for (const part of parts) {
      if (part.length < 2 || part.length > 40) continue;
      if (STACK_STOP.has(part)) continue;
      if (/^\d+$/.test(part)) continue;
      if (!found.includes(part)) found.push(part);
    }
  };
  const patterns = [
    /\bknows?\s+(?:only\s+)?([a-z][a-z0-9.+#\-]*(?:\s+[a-z][a-z0-9.+#\-]*)?)/gi,
    /\bexpert(?:ise)?\s+in\s+(?:only\s+)?([a-z][a-z0-9.+#\-]*)/gi,
    /\bin\s+([a-z][a-z0-9.+#\-]{2,24})\s+stack\b/gi,
    /\bonly\s+([a-z][a-z0-9.+#\-]{2,40})\b/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null = re.exec(text);
    while (m) {
      if (m[1]) push(m[1]);
      m = re.exec(text);
    }
  }
  return found.slice(0, 6);
}

/**
 * The brief as recruiters actually type it, rewritten into the forms the
 * parsers below and in `pool-brief.ts` recognise.
 *
 * Every parser here used to look for one spelling: "2 years" but not "two
 * years", "bangalore" but not "blr", "node" but not "node js". A recruiter who
 * typed the other one got no experience band, no city or a missing skill — and
 * the search ran vaguer than they asked, silently. Rewriting the spelling once,
 * before any parser runs, fixes every parser at the same time, and the /hire
 * checklist ticks read the same text so they light up for exactly what the
 * search will use.
 *
 * Pure and browser-safe: `scout-chat.tsx` runs it on every keystroke.
 */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
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
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
};

/** Only a number word that is about to be a count of years — "one of the
 *  best" and "five candidates" are left alone. */
const NUMBER_WORD_BEFORE_YEARS = new RegExp(
  `\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b(?=\\s*(?:\\+|plus\\b|-|–|to\\b|or\\b|years?\\b|yrs?\\b|yoe\\b))`,
  "gi",
);

const BRIEF_REWRITES: [RegExp, string][] = [
  // Years, however written: "3yrs", "3 yr.", "3y exp", "yoe", "a year".
  [/\b(\d{1,2})\s*(?:yrs?|years?|y)\b\.?/gi, "$1 years"],
  [/\byrs?\b\.?/gi, "years"],
  [/\byoe\b/gi, "years experience"],
  [/\bexp\b\.?/gi, "experience"],
  [/\b(?:a\s+)?couple\s+of\s+years\b/gi, "2 years"],
  [/\b(?:a|an)\s+year\b/gi, "1 year"],
  [/\b(\d{1,2})\s*(?:\+|plus\b)/gi, "$1+"],
  [/\batleast\b/gi, "at least"],
  [/\bmin(?:imum)?\.?\s+(?=\d)/gi, "at least "],
  // Skills written as two words or with a suffix.
  [/\bnode\s*\.?\s*js\b/gi, "node"],
  [/\breact\s*\.?\s*js\b/gi, "react"],
  [/\bnext\s*\.?\s*js\b/gi, "next.js"],
  [/\bexpress\s*\.?\s*js\b/gi, "express"],
  [/\bvue\s*\.?\s*js\b/gi, "vue"],
  [/\bangular\s*\.?\s*js\b/gi, "angular"],
  [/\bmongo(?:\s*db)?\b/gi, "mongodb"],
  [/\bpostgre(?:s|\s*sql)\b/gi, "postgresql"],
  [/\btype\s+script\b/gi, "typescript"],
  [/\bjava\s+script\b/gi, "javascript"],
  [/\bc\s*plus\s*plus\b|\bcpp\b/gi, "c++"],
  [/\bk8s\b/gi, "kubernetes"],
  // Role shorthand.
  [/\b(?:sde|swe)(?:\s*-?\s*(?:iii|ii|i|[123]))?\b/gi, "software engineer"],
  [/\bdevs?\b/gi, "developer"],
  // Degrees: "b tech", "b. tech", "btech" all mean the same thing.
  [/\bb\s*\.?\s*tech\b/gi, "b.tech"],
  [/\bm\s*\.?\s*tech\b/gi, "m.tech"],
  // City nicknames and misspellings (same aliases the ranker folds, see
  // `CITY_ALIASES` in score-candidate.ts).
  [/\b(?:blr|banglore|bangaluru|bengluru)\b/gi, "bangalore"],
  [/\bbombay\b/gi, "mumbai"],
  [/\bnew\s+delhi\b/gi, "delhi"],
  [/\b(?:hyd|hydrabad)\b/gi, "hyderabad"],
  [/\bmadras\b/gi, "chennai"],
  [/\bcalcutta\b/gi, "kolkata"],
  [/\bpoona\b/gi, "pune"],
  [/\bgurgaon\b/gi, "gurugram"],
  [/\bcochin\b/gi, "kochi"],
  [/\bmysore\b/gi, "mysuru"],
  [/\btrivandrum\b/gi, "thiruvananthapuram"],
  [/\bvizag\b/gi, "visakhapatnam"],
];

export function normalizeBrief(raw: string): string {
  let s = raw.replace(
    NUMBER_WORD_BEFORE_YEARS,
    (w) => String(NUMBER_WORDS[w.toLowerCase()]),
  );
  for (const [re, to] of BRIEF_REWRITES) s = s.replace(re, to);
  return s.replace(/\s+/g, " ").trim();
}

/** Cities the brief can name, as `normalizeBrief` leaves them. */
export const BRIEF_CITIES = [
  "delhi ncr",
  "bengaluru",
  "bangalore",
  "delhi",
  "ncr",
  "mumbai",
  "hyderabad",
  "chennai",
  "pune",
  "kolkata",
  "gurugram",
  "noida",
  "ahmedabad",
  "jaipur",
  "kochi",
  "indore",
  "chandigarh",
  "mohali",
  "coimbatore",
  "lucknow",
  "bhubaneswar",
  "nagpur",
  "mysuru",
  "thiruvananthapuram",
  "visakhapatnam",
  "surat",
  "vadodara",
  "bhopal",
  "patna",
  "goa",
] as const;

const BRIEF_CITY_RE = new RegExp(`\\b(${BRIEF_CITIES.join("|")})\\b`, "i");

/** The city named anywhere in the brief, as the requirement stores it. */
export function parseBriefCity(text: string): string | null {
  const hit = BRIEF_CITY_RE.exec(normalizeBrief(text));
  if (!hit?.[1]) return null;
  const city = hit[1].toLowerCase();
  if (city === "bangalore" || city === "bengaluru") return "Bengaluru";
  if (city === "ncr" || city === "delhi ncr") return "Delhi NCR";
  return city.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * An experience band in years: "2-3 years", "2 to 3 yrs", "at least two
 * years", "5+ years", "up to 4 years". Null when the brief states none.
 */
export function parseExperience(
  text: string,
): { min: number | null; max: number | null } | null {
  const t = normalizeBrief(text).toLowerCase();
  const range = /\b(\d{1,2})\s*(?:-|–|to|or)\s*(\d{1,2})\s*\+?\s*years?\b/.exec(t);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    if (hi >= lo && hi <= 50) return { min: lo, max: hi };
  }
  const upTo =
    /\b(?:up\s*to|upto|max(?:imum)?|less than|under|below)\s*(\d{1,2})\s*years?\b/.exec(t);
  if (upTo) return { min: null, max: Number(upTo[1]) };
  const floor = /\b(\d{1,2})\s*\+?\s*years?\b/.exec(t);
  if (floor) return { min: Number(floor[1]), max: null };
  return null;
}

/**
 * Role nouns a brief is built around. "developer for react" still names a
 * developer; the words either side are the constraints.
 */
const ROLE_NOUN =
  /\b(engineer|developer|designer|manager|analyst|architect|scientist|tester)s?\b/i;

/** Words that describe a constraint, never the role — stripped from a title. */
const TITLE_NOISE = new RegExp(
  [
    `\\b(?:${BRIEF_CITIES.join("|")})\\b`,
    "\\b\\d{1,2}\\s*\\+?\\s*(?:-\\s*\\d{1,2}\\s*)?years?\\b",
    "\\b(?:fresher|freshers|entry[\\s-]?level|experienced?|remote|hybrid|on[\\s-]?site|full[\\s-]?time|part[\\s-]?time|b\\.tech|m\\.tech|bca|mca|graduate)\\b",
    "\\b(?:someone|somebody|a guy|a girl|a person|people|candidates?)\\b",
    "\\b(?:one of the|best|good|great|strong|top|skilled|talented|solid|decent|some|few)\\b",
  ].join("|"),
  "gi",
);

/**
 * A role title from a sentence-shaped brief, or null.
 *
 * Takes the phrase ending in the role noun ("fresher java developer chennai" →
 * "java developer"), after cutting the clauses that carry constraints.
 */
export function parseBriefRole(text: string): string | null {
  const seed = normalizeBrief(text)
    .replace(/\b(?:with|having|who|that|which|based|from|in|for)\b[\s\S]*$/i, "")
    .replace(TITLE_NOISE, " ")
    .replace(/[,.;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = /((?:[a-z][a-z0-9.+#/-]*\s+){0,3}?(?:engineer|developer|designer|manager|analyst|architect|scientist|tester)s?)\b/i.exec(
    seed,
  );
  if (!m?.[1]) return null;
  // One developer is the role; "react developers" is how people ask for it.
  const role = asRoleTitle(m[1].replace(/s$/i, ""));
  return role && ROLE_NOUN.test(role) ? role : null;
}

export function applyObviousAnswers(spec: JobSpec, msg: string): JobSpec {
  const raw = msg.trim();
  if (!raw || raw.length > 400) return spec;

  // A negated clause belongs to the model ("not in delhi", "don't need a
  // degree"). It used to drop the WHOLE message, so "backend, 2 years, doesn't
  // matter where" lost the role and the years too. Only the negated clause is
  // set aside now; the rest is read as usual.
  const NEGATION = /\b(not|don't|dont|doesn't|doesnt|except|no need)\b/i;
  const text = normalizeBrief(
    raw
      .split(/\s*(?:[,;.]|\bbut\b)\s*/i)
      .filter((clause) => !NEGATION.test(clause))
      .join(", "),
  );
  if (!text) return spec;

  const next: JobSpec = { ...spec };

  if (next.seniority == null) {
    const seniority = firstHit(text, [
      [/\bintern(?:ship)?\b/i, "INTERN"],
      [/\bjunior\b|\bjr\.?\b|\bfreshers?\b|\bentry[\s-]?level\b/i, "JUNIOR"],
      [/\bmid(?:[\s-]?level)?\b/i, "MID"],
      [/\bsenior\b|\bsr\.?\b/i, "SENIOR"],
      [/\blead\b/i, "LEAD"],
    ] as const);
    if (seniority) next.seniority = seniority;
  }

  if (next.workMode == null) {
    const workMode = firstHit(text, [
      [/\bremote\b/i, "REMOTE"],
      [/\bhybrid\b/i, "HYBRID"],
      [/\bon[\s-]?site\b/i, "ONSITE"],
    ] as const);
    if (workMode) next.workMode = workMode;
  }

  if (!next.title?.trim()) {
    if (/\bfull[\s-]?stack\b/i.test(text)) next.title = "Full-stack developer";
    else if (/\bfront[\s-]?end\b/i.test(text)) next.title = "Frontend engineer";
    else if (/\bback[\s-]?end\b/i.test(text)) next.title = "Backend engineer";
    else if (/\bai\s*engineer\b/i.test(text)) next.title = "AI engineer";
    else if (/\breact\s+(?:developer|engineer|dev)\b/i.test(text)) {
      next.title = "React developer";
    } else {
      // "fresher java developer chennai" is a java developer; the city and
      // the seniority are constraints, not part of the role.
      const role = parseBriefRole(text);
      if (role) next.title = role;
    }
  }

  if (!next.locationCity) {
    // A named city counts wherever it sits — "blr based", "mumbai", "in pune".
    // "Remote" as a location still needs the preposition, as before; bare
    // "remote" is the work mode above.
    const city =
      parseBriefCity(text) ??
      (/\b(?:in|only|from)\s+remote\b|^remote\s*[.!,]*$/i.test(text)
        ? "Remote"
        : null);
    if (city) next.locationCity = city;
  }

  if (next.employmentType == null) {
    const employment = firstHit(text, [
      [/\bfull[\s-]?time\b/i, "FULL_TIME"],
      [/\bpart[\s-]?time\b/i, "PART_TIME"],
      [/\bintern(?:ship)?\b/i, "INTERNSHIP"],
      [/\bcontract\b/i, "CONTRACT"],
      [/\bfreelance\b/i, "FREELANCE"],
    ] as const);
    if (employment) next.employmentType = employment;
  }

  const statedStack = extractStatedStack(text);
  const replaceStack =
    statedStack.length > 0 &&
    (!(next.mustHaveStack?.length) || /\bonly\b|\binstead\b/i.test(text));
  if (replaceStack) {
    const exclusive = /\bonly\b/i.test(text);
    const word =
      statedStack.find((s) => s === "langchain") ??
      statedStack.find((s) => s === "langgraph") ??
      statedStack[0]!;
    next.mustHaveStack = exclusive ? [word] : statedStack;
    if (exclusive) {
      next.title = `${word.charAt(0).toUpperCase()}${word.slice(1)} developer`;
    }
  } else if (!next.mustHaveStack?.length) {
    if (/\bmer?n\b/i.test(text)) next.mustHaveStack = ["mern"];
    else if (/\bmean\b/i.test(text)) next.mustHaveStack = ["mean"];
  } else if (/\bonly\b/i.test(text)) {
    // "only ai engineer" is a new role, not a new library. The previous
    // stack (MERN, etc.) must not ride along and rank the wrong people.
    const afterOnly = text.replace(/^.*?\bonly\b\s*/i, "").trim();
    const role = asRoleTitle(afterOnly);
    if (role && !/^\d/.test(role) && !/^(candidates?|people|profiles?)$/i.test(role)) {
      next.title = /ai\s*engineer/i.test(role) ? "AI engineer" : role;
      next.mustHaveStack = [];
    }
  }

  // "developer for react": the bare noun says nothing the stack does not, so
  // name the role after the first skill instead.
  if (
    /^(?:developer|engineer)$/i.test(next.title?.trim() ?? "") &&
    next.mustHaveStack?.[0]
  ) {
    const lead = next.mustHaveStack[0];
    next.title = `${lead.charAt(0).toUpperCase()}${lead.slice(1)} developer`;
  }

  if (next.minExperience == null && next.maxExperience == null) {
    const band = parseExperience(text);
    if (band?.min != null) next.minExperience = band.min;
    if (band?.max != null) next.maxExperience = band.max;
  }

  return next;
}

function firstHit<T extends string>(
  text: string,
  pairs: readonly (readonly [RegExp, T])[],
): T | null {
  let best: { index: number; value: T } | null = null;
  for (const [re, value] of pairs) {
    const m = re.exec(text);
    if (!m || m.index == null) continue;
    if (!best || m.index < best.index) best = { index: m.index, value };
  }
  return best?.value ?? null;
}

/** What landed this turn, for a one-line ack when the model did not speak. */
export function briefDelta(before: JobSpec, after: JobSpec): string[] {
  const bits: string[] = [];
  const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
  if (after.seniority && after.seniority !== before.seniority) {
    bits.push(label(after.seniority));
  }
  if (after.workMode && after.workMode !== before.workMode) {
    bits.push(label(after.workMode));
  }
  if (after.title && after.title !== before.title) bits.push(after.title);
  if (
    (after.mustHaveStack?.length ?? 0) > 0 &&
    JSON.stringify(after.mustHaveStack) !== JSON.stringify(before.mustHaveStack)
  ) {
    bits.push((after.mustHaveStack ?? []).join(" · "));
  }
  return bits;
}

/** Money as the recruiter wrote it, for reading back. */
export function formatSpecSalary(spec: JobSpec): string | null {
  const lo = spec.salaryMin;
  const hi = spec.salaryMax;
  if (lo == null && hi == null) return null;
  if (lo === 0 && hi === 0) return "not specified";

  const monthly = spec.salaryPeriod === "MONTHLY";
  const fmt = (annual: number) => {
    const v = monthly ? Math.round(annual / 12) : annual;
    return monthly
      ? `₹${v.toLocaleString("en-IN")}`
      : `₹${(v / 100_000) % 1 === 0 ? v / 100_000 : (v / 100_000).toFixed(1)} LPA`;
  };
  const suffix = monthly ? " a month" : "";
  const a = lo ?? hi!;
  const b = hi ?? lo!;
  return a === b ? `${fmt(a)}${suffix}` : `${fmt(a)}–${fmt(b)}${suffix}`;
}
