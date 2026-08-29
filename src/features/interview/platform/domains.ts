import { hasRubric } from "@/features/interview/platform/rubrics";
import { getPack, hasPack } from "@/features/interview/platform/packs";
import {
  SERVEABLE_CAPABILITIES,
  type DomainSummary,
  type InterviewDomain,
  type ReportProfile,
} from "@/features/interview/platform/types";

/**
 * The interview catalogue.
 *
 * One entry per interview a candidate can be offered. This registry is what
 * replaces `blueprint` as the thing the rest of the platform switches on — and
 * unlike `blueprint` it does not conflate identity with scope, question source,
 * rubric, retake policy or report shape. Adding an interview is an entry here
 * plus an authored pack.
 *
 * CODE, not a table, for the same reason the packs are: a domain that points at
 * a missing pack or an unknown rubric should fail to import, not fail in front
 * of a candidate who has already started.
 *
 * Pure module. No `server-only`, no Prisma — the catalogue page reads it from a
 * Server Component, and the verifier scripts read it from plain `tsx`.
 */

/** The default report shape. Domains override only what differs. */
const FULL_REPORT: ReportProfile = {
  sections: true,
  competencies: true,
  skills: true,
  transcriptExcerpts: true,
  agentInsights: true,
};

const DOMAINS: readonly InterviewDomain[] = [
  {
    slug: "ai-fluency",
    label: "AI Fluency",
    blurb:
      "How well you understand and work with AI tools day to day. For any role, not just engineering.",
    family: "AI",
    status: "LIVE",
    rubricId: "ai-fluency-v1",
    strategy: "AUTHORED_PACK",
    packRef: { packId: "ai-fluency", version: 1 },
    durationSec: 900,
    capabilities: ["VOICE"],
    reportProfile: FULL_REPORT,
    resumable: false,
    maxAttempts: null,
  },
  {
    slug: "behavioral",
    label: "Behavioral",
    blurb:
      "Real examples from your own work: what you did, how you handled it, what you would change.",
    family: "General",
    status: "LIVE",
    rubricId: "behavioral-v1",
    strategy: "AUTHORED_PACK",
    packRef: { packId: "behavioral", version: 1 },
    durationSec: 900,
    capabilities: ["VOICE"],
    reportProfile: FULL_REPORT,
    resumable: false,
    maxAttempts: null,
  },

  /* ------------------------------------------------------------------------
   * COMING_SOON. Registered so the catalogue is honest about the roadmap and
   * so the config layer is exercised by more than the two live entries.
   *
   * `rubricId: null` and `packRef: null` are LOAD-BEARING, not placeholders.
   * These domains have not been authored yet, and neither field has a correct
   * value. An earlier revision pointed each at whichever live rubric happened
   * to type-check, which compiled but asserted something false: the next person
   * to open this file would reasonably read those pairings as decisions and
   * build on them. A null says the thing that is actually true.
   *
   * `getStartableDomain` rejects them, and `assertDomainIntegrity` requires
   * both fields for LIVE, so a domain cannot be promoted without authoring the
   * rubric and pack it names. The two with non-VOICE capabilities additionally
   * need the workspace that serves them, which Phase 1 does not build.
   * ---------------------------------------------------------------------- */
  {
    slug: "ai-engineering",
    label: "AI Engineering",
    blurb:
      "Building with LLMs: retrieval, evaluation, cost and latency, and what breaks in production.",
    family: "AI",
    status: "COMING_SOON",
    rubricId: null,
    strategy: "AUTHORED_PACK",
    packRef: null,
    durationSec: 1200,
    capabilities: ["VOICE"],
    reportProfile: FULL_REPORT,
    resumable: false,
    maxAttempts: null,
  },
  {
    slug: "technical-screen",
    label: "Technical Screen",
    blurb:
      "A general first-round screen: your background, your recent work, and how you reason about it.",
    family: "General",
    status: "COMING_SOON",
    rubricId: null,
    strategy: "AUTHORED_PACK",
    packRef: null,
    durationSec: 900,
    capabilities: ["VOICE"],
    reportProfile: FULL_REPORT,
    resumable: false,
    maxAttempts: null,
  },
  {
    slug: "ai-system-design",
    label: "AI System Design",
    blurb:
      "Designing an AI-backed system end to end, with the trade-offs made explicit.",
    family: "AI",
    status: "COMING_SOON",
    rubricId: null,
    strategy: "AUTHORED_PACK",
    packRef: null,
    durationSec: 1800,
    capabilities: ["VOICE", "WHITEBOARD"],
    reportProfile: FULL_REPORT,
    resumable: false,
    maxAttempts: null,
  },
  {
    slug: "agentic-coding",
    label: "Agentic / AI-assisted Coding",
    blurb:
      "Working with an AI coding agent: what you delegate, what you verify, and how you stay in control.",
    family: "AI",
    status: "COMING_SOON",
    rubricId: null,
    strategy: "AUTHORED_PACK",
    packRef: null,
    durationSec: 1800,
    capabilities: ["VOICE", "CODE_SANDBOX"],
    reportProfile: FULL_REPORT,
    resumable: false,
    maxAttempts: null,
  },
  {
    slug: "coding-dsa",
    label: "Coding / DSA",
    blurb:
      "Data structures and algorithms, talked through out loud while you write the code.",
    family: "General",
    status: "COMING_SOON",
    rubricId: null,
    strategy: "AUTHORED_PACK",
    packRef: null,
    durationSec: 2700,
    capabilities: ["VOICE", "CODE_SANDBOX"],
    reportProfile: FULL_REPORT,
    resumable: false,
    maxAttempts: null,
  },
  {
    slug: "forward-deployed-ai-engineer",
    label: "Forward Deployed AI Engineer",
    blurb:
      "A customer scenario that unfolds as you work it: ambiguous requirements, real constraints, a decision at the end.",
    family: "AI",
    status: "COMING_SOON",
    rubricId: null,
    strategy: "SCENARIO",
    packRef: null,
    durationSec: 2700,
    capabilities: ["VOICE"],
    reportProfile: FULL_REPORT,
    resumable: false,
    maxAttempts: null,
  },
];

/**
 * Load-time integrity.
 *
 * The LIVE checks are the load-bearing ones: a LIVE domain is startable, so an
 * unresolvable pack or rubric there is a candidate-facing failure. COMING_SOON
 * entries are checked more loosely on purpose — they exist precisely because
 * their pack has not been authored yet.
 */
function assertDomainIntegrity(domain: InterviewDomain): void {
  const where = domain.slug;

  if (!/^[a-z0-9-]+$/.test(domain.slug)) {
    throw new Error(
      `[platform-domains] "${where}" is not a valid URL slug (lowercase, ` +
        `digits and hyphens only).`,
    );
  }
  if (domain.rubricId !== null && !hasRubric(domain.rubricId)) {
    throw new Error(
      `[platform-domains] ${where} references unknown rubric ` +
        `"${domain.rubricId}".`,
    );
  }
  if (domain.durationSec <= 0) {
    throw new Error(`[platform-domains] ${where} has a non-positive duration.`);
  }
  if (domain.maxAttempts !== null && domain.maxAttempts < 1) {
    throw new Error(
      `[platform-domains] ${where} maxAttempts must be null or at least 1.`,
    );
  }
  if (!domain.capabilities.includes("VOICE")) {
    throw new Error(
      `[platform-domains] ${where} must declare VOICE; every interview on this ` +
        `platform is spoken.`,
    );
  }

  if (domain.status !== "LIVE") return;

  if (!domain.rubricId) {
    throw new Error(
      `[platform-domains] ${where} is LIVE but declares no rubricId, so its ` +
        `answers could not be scored.`,
    );
  }
  if (!domain.packRef) {
    throw new Error(
      `[platform-domains] ${where} is LIVE but declares no packRef, so it ` +
        `could not be started.`,
    );
  }
  if (!hasPack(domain.packRef)) {
    throw new Error(
      `[platform-domains] ${where} is LIVE but pack ` +
        `"${domain.packRef.packId}@${domain.packRef.version}" is not registered.`,
    );
  }

  const pack = getPack(domain.packRef);
  if (pack.rubricId !== domain.rubricId) {
    throw new Error(
      `[platform-domains] ${where} scores against rubric "${domain.rubricId}" ` +
        `but its pack was authored against "${pack.rubricId}".`,
    );
  }
  if (pack.domainSlug !== domain.slug) {
    throw new Error(
      `[platform-domains] ${where} pins a pack authored for domain ` +
        `"${pack.domainSlug}".`,
    );
  }

  // Phase 1 serves VOICE only. A LIVE domain asking for a workspace that does
  // not exist yet would render a room missing the thing the interview is about.
  for (const capability of domain.capabilities) {
    if (!SERVEABLE_CAPABILITIES.includes(capability)) {
      throw new Error(
        `[platform-domains] ${where} is LIVE and declares capability ` +
          `"${capability}", which is not served yet. Mark it COMING_SOON ` +
          `until the workspace exists.`,
      );
    }
  }
}

const BY_SLUG = new Map<string, InterviewDomain>();
for (const domain of DOMAINS) {
  if (BY_SLUG.has(domain.slug)) {
    throw new Error(`[platform-domains] duplicate slug "${domain.slug}".`);
  }
  assertDomainIntegrity(domain);
  BY_SLUG.set(domain.slug, domain);
}

/** Null for an unknown slug — a route param is client input. */
export function getDomain(slug: string): InterviewDomain | null {
  return BY_SLUG.get(slug) ?? null;
}

/**
 * The domain, only if it can actually be started right now.
 *
 * The single door to "may an attempt open for this slug". A COMING_SOON or
 * RETIRED domain resolves to null here even though `getDomain` returns it, so a
 * hand-crafted request cannot start an interview the catalogue does not offer.
 */
export function getStartableDomain(slug: string): InterviewDomain | null {
  const domain = BY_SLUG.get(slug);
  if (!domain || domain.status !== "LIVE" || !domain.packRef) return null;
  return domain;
}

export function listDomains(): readonly InterviewDomain[] {
  return DOMAINS;
}

export function listLiveDomains(): InterviewDomain[] {
  return DOMAINS.filter((d) => d.status === "LIVE");
}

/**
 * The plain-data projection a Client Component may receive.
 *
 * An `InterviewDomain` must never cross the server/client boundary directly:
 * it carries the rubric id and pack pin, which are server concerns, and future
 * strategy fields may not be serialisable at all.
 */
export function toDomainSummary(domain: InterviewDomain): DomainSummary {
  return {
    slug: domain.slug,
    label: domain.label,
    blurb: domain.blurb,
    family: domain.family,
    status: domain.status,
    durationSec: domain.durationSec,
    questionCount: domain.packRef ? getPack(domain.packRef).questions.length : 0,
    capabilities: [...domain.capabilities],
  };
}
