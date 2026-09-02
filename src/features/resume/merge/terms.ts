/**
 * Semantic identity for technology and skill terms.
 *
 * "React" and "React.js" are the same thing; "React" and "React Native" are
 * not. That distinction is the whole job here, and it is why this is a curated
 * map plus two conservative rules rather than a fuzzy string distance — an edit
 * distance close enough to unify React/React.js also unifies Java/JavaScript
 * and Node/Nuxt, which silently deletes a skill the candidate actually has.
 *
 * The primary source of truth is NOT this file. The `Skill` table already
 * carries a curated `aliases` array, and the merge resolves against that first;
 * `canonicalTerm` is what makes a résumé's spelling findable there, and the
 * fallback for terms the catalogue has never heard of.
 *
 * Pure and dependency-free.
 */

/**
 * Variant spellings that mean one thing, keyed by the form they collapse to.
 * Deliberately short: every entry is a claim that two strings are the same
 * technology, and a wrong entry destroys information.
 */
const ALIASES: Record<string, readonly string[]> = {
  javascript: ["js", "javascript", "ecmascript"],
  typescript: ["ts", "typescript"],
  node: ["node", "nodejs"],
  react: ["react", "reactjs"],
  mongodb: ["mongo", "mongodb", "mongod"],
  postgresql: ["postgres", "postgresql", "psql", "postgre", "postgressql"],
  mysql: ["mysql"],
  csharp: ["c#", "csharp", "cs"],
  cplusplus: ["c++", "cpp", "cplusplus"],
  dotnet: [".net", "dotnet", "dotnetcore"],
  go: ["go", "golang"],
  kubernetes: ["k8s", "kubernetes"],
  aws: ["aws", "amazonwebservices"],
  gcp: ["gcp", "googlecloud", "googlecloudplatform"],
  azure: ["azure", "microsoftazure"],
  tailwindcss: ["tailwind", "tailwindcss"],
  scikitlearn: ["sklearn", "scikitlearn", "scikit"],
  postgis: ["postgis"],
  html: ["html", "html5"],
  css: ["css", "css3"],
  restapi: ["rest", "restapi", "restfulapi", "restful"],
  cicd: ["cicd", "ci/cd", "continuousintegration"],
  nextjs: ["next", "nextjs"],
  nestjs: ["nest", "nestjs"],
  vue: ["vue", "vuejs"],
  angular: ["angular", "angularjs"],
  express: ["express", "expressjs"],
};

/** Built once: variant → canonical. */
const CANONICAL_BY_VARIANT: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [canonical, variants] of Object.entries(ALIASES)) {
    for (const variant of variants) {
      map.set(stripPunctuation(variant), canonical);
    }
  }
  return map;
})();

/**
 * Everything but letters, digits, `+` and `#`. Those two survive because they
 * carry meaning: dropping them turns C++ and C# both into "c".
 */
function stripPunctuation(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#]/g, "");
}

/**
 * The comparison key for a term. Two terms are the same skill when their
 * canonical forms are equal — never on a similarity threshold.
 *
 * The trailing-`js` rule is applied only when a stem of three or more
 * characters remains, which covers reactjs/vuejs/nextjs/threejs without
 * touching a name that merely ends in those letters.
 */
export function canonicalTerm(raw: string | null | undefined): string {
  // Defensive on purpose. Callers pass values read out of the database and out
  // of model output, and a single missing field used to take down the whole
  // merge — which runs after the résumé row is already READY, so the candidate
  // saw an error for work that had actually succeeded.
  if (typeof raw !== "string") return "";
  const stripped = stripPunctuation(raw);
  if (stripped.length === 0) return "";

  const direct = CANONICAL_BY_VARIANT.get(stripped);
  if (direct) return direct;

  if (stripped.endsWith("js") && stripped.length >= 5) {
    const stem = stripped.slice(0, -2);
    return CANONICAL_BY_VARIANT.get(stem) ?? stem;
  }
  return stripped;
}

export function sameTerm(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalTerm(a);
  return ca.length > 0 && ca === canonicalTerm(b);
}

/**
 * Existing terms first, then any incoming term whose canonical form is new.
 *
 * The candidate's own wording always survives: if they wrote "React" and the
 * résumé says "React.js", the list keeps "React". Re-spelling what someone
 * typed is a change they did not ask for.
 */
export function mergeTermLists(
  existing: readonly (string | null | undefined)[],
  incoming: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set(existing.map(canonicalTerm).filter(Boolean));
  const out = existing.filter((t): t is string => typeof t === "string");
  for (const term of incoming) {
    const key = canonicalTerm(term);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(term!.trim());
  }
  return out;
}

/** Incoming terms that are genuinely new against `existing`. */
export function newTerms(
  existing: readonly (string | null | undefined)[],
  incoming: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set(existing.map(canonicalTerm).filter(Boolean));
  const out: string[] = [];
  for (const term of incoming) {
    const key = canonicalTerm(term);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    // A non-empty canonical form proves `term` was a usable string.
    out.push(term!.trim());
  }
  return out;
}
