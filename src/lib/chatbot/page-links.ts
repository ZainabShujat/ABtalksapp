import type { Chunk } from "@/lib/chatbot/chunking";
import type { ScoredChunk } from "@/lib/chatbot/engine";

/**
 * Which public page an answer came from, so the reply can end with a link to
 * it (issue #576: picking "4. Workshops" should also give abtalks.in/workshop).
 *
 * The link is chosen HERE, from the retrieved chunks, never by the model. A
 * model asked to "add a link" will eventually write a plausible URL that does
 * not exist; a lookup can only return a page on the list below.
 *
 * Pure and fence-free, so the retrieval test scripts can import it.
 */

/** Shown in the link text. The href stays relative, so it works on previews. */
export const SITE_HOST = "abtalks.in";

/**
 * Pages the assistant may link to. Public routes only — every one must be
 * absent from `protectedPaths` in middleware.ts, or a signed-out visitor
 * following the link lands on a login screen.
 */
export const PUBLIC_PAGES: ReadonlySet<string> = new Set([
  "/",
  "/challenges",
  "/claude-signup",
  "/workshop",
  "/workshop/events",
  "/program/ai-cohort",
  "/ai-cohort-register",
  "/ai-cohort-india",
  "/hackathon",
  "/hire",
  "/contact",
  "/terms",
  "/privacy",
  "/cookies",
]);

/**
 * Retired paths and where they live now. Mirrors the redirects in
 * next.config.ts; site snapshots taken before a rename still carry the old
 * route in their front matter.
 */
const MOVED: Record<string, string> = {
  "/ai-workshop": "/workshop",
  "/ai-workshop/events": "/workshop/events",
  "/program": "/program/ai-cohort",
};

/**
 * Curated files and the page each one describes. Files about no single page
 * (FAQs, testimonials, the founder) are absent on purpose: an answer drawn
 * from them gets no link rather than a loosely related one. So are two that
 * looked mappable and were not: `programs.md` spans every program, so it sent
 * a workshop question to /challenges; and `hiring-and-recruiters.md` is read
 * mostly by students asking who sees their profile, for whom /hire is the
 * recruiter's search page. The menu's "Hiring & Recruiters" still links /hire.
 */
const CURATED_PAGE: Record<string, string> = {
  "abtalks.md": "/",
  "homepage.md": "/",
  "coding-challenge.md": "/challenges",
  "claude-challenge.md": "/claude-signup",
  "ai-cohort.md": "/program/ai-cohort",
  "workshops.md": "/workshop",
  "events.md": "/workshop/events",
  "hackathon.md": "/hackathon",
  "vicodathon.md": "/hackathon",
  "socials-and-contact.md": "/contact",
  "legal-and-privacy.md": "/privacy",
};

/** A route on the public list, after following renames. Null otherwise. */
export function publicPage(route: string | null | undefined): string | null {
  if (!route) return null;
  const clean = route.trim().replace(/[?#].*$/, "").replace(/(.)\/+$/, "$1");
  const moved = MOVED[clean] ?? clean;
  return PUBLIC_PAGES.has(moved) ? moved : null;
}

/** The page a chunk describes, or null. */
export function pageForChunk(
  chunk: Pick<Chunk, "origin" | "source" | "route">,
): string | null {
  if (chunk.route) return publicPage(chunk.route);
  return publicPage(CURATED_PAGE[chunk.source]);
}

/**
 * The page to link under an answer.
 *
 * A menu pick names its page up front (`hint`), which wins when it is public.
 * Otherwise the link follows the source the answer was mostly built from: the
 * file carrying the largest share of the retrieved score. If that file has no
 * public page, there is no link. Taking the first chunk that happened to map
 * to a page found a page for everything — "how do I get my certificate", built
 * from five certificates.md chunks, was linked to /privacy on the strength of
 * one legal chunk — and a wrong link is worse than none.
 */
export function learnMorePage(
  results: ScoredChunk[],
  hint?: string | null,
): string | null {
  const fromHint = publicPage(hint);
  if (fromHint) return fromHint;
  const weight = new Map<string, { score: number; chunk: ScoredChunk["chunk"] }>();
  for (const r of results) {
    const entry = weight.get(r.chunk.source);
    if (entry) entry.score += r.score;
    else weight.set(r.chunk.source, { score: r.score, chunk: r.chunk });
  }
  let best: { score: number; chunk: ScoredChunk["chunk"] } | null = null;
  for (const entry of weight.values()) {
    if (!best || entry.score > best.score) best = entry;
  }
  return best ? pageForChunk(best.chunk) : null;
}

/** "abtalks.in/workshop" for display; the homepage is just the host. */
export function pageLabel(route: string): string {
  return route === "/" ? SITE_HOST : `${SITE_HOST}${route}`;
}

/** The closing line appended to an answer, as a markdown link. */
export function learnMoreLine(route: string): string {
  return `\n\nLearn more: [${pageLabel(route)}](${route})`;
}
