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

/**
 * Attempts allowed per domain, per candidate.
 *
 * Finite rather than unlimited: every attempt is a live model conversation plus
 * speech-to-text and speech synthesis, so an unbounded retake loop is an
 * unbounded bill. Three is enough to practise properly — a first run to see
 * the shape of it, and two to actually improve — without the interview
 * becoming something to grind until the score comes out right.
 *
 * Reports are unaffected: every attempt keeps its own, and they all stay
 * readable from the practice history after the cap is reached.
 */
const ATTEMPT_LIMIT = 3;

const DOMAINS: readonly InterviewDomain[] = [
  {
    slug: "ai-fluency",
    label: "AI Fluency",
    blurb:
      "How well you understand and work with AI tools day to day. For any role, not just engineering.",
    purpose:
      "A practical interview about working with AI tools. It asks what you understand about how these tools behave, what you have actually used them for, and how you decide when to trust the output. It is not a coding interview and does not assume an engineering background.",
    family: "AI",
    status: "LIVE",
    rubricId: "ai-fluency-v1",
    strategy: "AUTHORED_PACK",
    packRef: { packId: "ai-fluency", version: 1 },
    durationSec: 900,
    capabilities: ["VOICE"],
    reportProfile: FULL_REPORT,
    resumable: false,
    maxAttempts: ATTEMPT_LIMIT,
  },
  {
    // Capabilities are VOICE only, though this is the domain that will one day
    // want CODE_SANDBOX. Pack v1 does not need one: what separates people who
    // build well with an agent from people who merely build fast with one is
    // what they hand over, what they check and whether they can still explain
    // what shipped — all of which is spoken. Declaring a capability the room
    // cannot mount would break the interview to advertise a roadmap.
    slug: "agentic-coding",
    label: "Vibe Coding",
    blurb:
      "Building with an AI coding agent: what you hand over, what you check, and whether you could still explain what shipped.",
    purpose:
      "A practical interview about working with AI coding agents. It asks what you have actually built with one, how you set it up, how you establish that what it wrote is correct, and where you draw the line. It is spoken — you will not be asked to write code — and it takes no position on whether heavy delegation is good, only on whether you stay responsible for what ships.",
    family: "AI",
    status: "LIVE",
    rubricId: "agentic-coding-v1",
    strategy: "AUTHORED_PACK",
    packRef: { packId: "agentic-coding", version: 1 },
    durationSec: 900,
    capabilities: ["VOICE"],
    reportProfile: FULL_REPORT,
    resumable: false,
    maxAttempts: ATTEMPT_LIMIT,
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
    maxAttempts: ATTEMPT_LIMIT,
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
    maxAttempts: ATTEMPT_LIMIT,
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
    maxAttempts: ATTEMPT_LIMIT,
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
    maxAttempts: ATTEMPT_LIMIT,
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
    maxAttempts: ATTEMPT_LIMIT,
  },
  {
    // The SLUG stays `behavioral` while the label changes. The slug is identity,
    // not copy: it is persisted on every attempt row, pinned by the pack, and
    // baked into report URLs. Renaming a display name is a copy change; renaming
    // an identity key is a migration, and the two should never ride together.
    slug: "behavioral",
    label: "Workplace Situations",
    blurb:
      "The people side of working: how you handle pressure, disagreement, ownership and change, told through real examples.",
    purpose:
      "A professional and people-situations interview. It asks about real situations you have been in and listens for communication, ownership, decision-making, adaptability, problem-solving and self-awareness. There is nothing technical in it and nothing about AI — it is deliberately separate from AI Fluency, and the two assess different things. Take this one to practise the round where you are asked to talk about yourself and your work rather than about a technology.",
    family: "General",
    status: "LIVE",
    rubricId: "behavioral-v1",
    strategy: "AUTHORED_PACK",
    packRef: { packId: "behavioral", version: 1 },
    durationSec: 900,
    capabilities: ["VOICE"],
    reportProfile: FULL_REPORT,
    resumable: false,
    maxAttempts: ATTEMPT_LIMIT,
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
