/**
 * The Gemini candidate summary for View Details (and the report opened from
 * it). Called once when a recruiter opens the panel, never for cards.
 *
 * A POST Route Handler rather than a Server Action for the same reason as
 * `/api/hire/brief`: Server Action calls are serialized by the Next.js client
 * router, and a model call of a few seconds would queue in front of the
 * recruiter's own unlock, shortlist and next-candidate loads. POST, not GET,
 * so the fact inputs never land in a URL or an access log.
 *
 * `{ ok: false }` always means "keep the deterministic summary": no key, not a
 * recruiter, rate limited, ineligible ref, model timeout or an unusable reply.
 * The message is the same for all of them and never names the vendor.
 *
 * The model sees card facts the client already holds (bounded by
 * `summaryRequestSchema`) plus profile facts read here through the
 * recruiter-safe identity and work-history reads. No contact, unlock state or
 * rationale is loaded or sent.
 */
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { assertRateLimit } from "@/lib/rate-limit";
import { decodeCandidateRef } from "@/features/hire/candidate-ref";
import { resolveInspectorCandidate } from "@/features/hire/pool-policy";
import { requireRecruiterWorkspace } from "@/features/recruiter-workspace/workspace";
import {
  buildSummaryFacts,
  summaryRequestKey,
  summaryRequestSchema,
} from "@/features/hire/candidate-summary-ai";
import {
  isCandidateSummaryConfigured,
  summarizeCandidate,
} from "@/features/hire/gemini-candidate-summary";
import { listPublicWorkHistory } from "@/repositories/candidate-detail";
import { loadRecruiterIdentities } from "@/repositories/talent";

const NO_STORE = { "Cache-Control": "private, no-store" };

function unavailable(status = 200) {
  return NextResponse.json(
    { ok: false as const, message: "Summary unavailable." },
    { status, headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return unavailable(400);
  }
  const parsed = summaryRequestSchema.safeParse(body);
  if (!parsed.success) return unavailable(400);
  const req = parsed.data;
  if (
    req.candidateRef.startsWith("SAMPLE:") ||
    !decodeCandidateRef(req.candidateRef)
  ) {
    return unavailable();
  }
  // Before auth: an unconfigured deploy answers at once and touches nothing.
  if (!isCandidateSummaryConfigured()) return unavailable();

  try {
    const workspace = await requireRecruiterWorkspace();
    if (!workspace.ok) return unavailable();
    const recruiterId = workspace.data.userId;

    const result = await summarizeCandidate(
      `${recruiterId}:${summaryRequestKey(req)}`,
      async () => {
        // Spent only on a cache miss, under its own subject so opening
        // candidates can never use up this recruiter's searches.
        const limited = await assertRateLimit({
          bucket: "SEARCH",
          subjectId: `summary:user:${recruiterId}`,
        });
        if (!limited.ok) return null;

        const eligible = await resolveInspectorCandidate(req.candidateRef);
        if (!eligible) return null;

        const [identities, history] = await Promise.all([
          loadRecruiterIdentities([eligible.userId]),
          listPublicWorkHistory(eligible.userId),
        ]);
        const identity = identities.get(eligible.userId) ?? null;
        // Ordered current first, then most recent start.
        const recent = history.rows[0] ?? null;

        return buildSummaryFacts({
          card: req.card,
          search: req.search,
          profile: identity
            ? {
                degree: identity.education,
                school: identity.university,
                skills: identity.skills,
              }
            : null,
          recentJob: recent
            ? { title: recent.title, companyName: recent.companyName }
            : null,
        });
      },
    );

    if (!result.ok) {
      logger.info("[hire-summary] fell back", { reason: result.reason });
      return unavailable();
    }
    return NextResponse.json(
      { ok: true as const, data: { summary: result.summary } },
      { headers: NO_STORE },
    );
  } catch (error) {
    logger.error("[hire-summary] route failed", { error: String(error) });
    return unavailable();
  }
}
