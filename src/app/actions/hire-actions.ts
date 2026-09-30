"use server";

import { revalidatePath } from "next/cache";
import {
  Prisma,
  TalentMatchTier,
  TalentRequestStatus,
  type TalentEmploymentType,
  type TalentSeniority,
  type TalentWorkMode,
} from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  requireApprovedRecruiterAction,
  requireRegisteredRecruiterAction,
} from "@/lib/recruiter-gate";
import { assertRateLimit } from "@/lib/rate-limit";
import { upsertCandidateAvailability } from "@/repositories/candidate";
import {
  candidateAvailabilitySchema,
  jobSpecSchema,
  adoptGuestScoutSessionSchema,
  applyHireFiltersSchema,
  recordSampleDemandSchema,
  runMatchSchema,
  sendScoutMessageSchema,
  type JobSpec,
} from "@/lib/validations/hire";
import { runScoutTurn } from "@/features/hire/scout-conversation";
import {
  SEARCH_RESULT_LIMIT,
  searchCandidates,
} from "@/features/hire/search-candidates";
import { persistableSource } from "@/features/hire/track-loaders";
import {
  explainMatches,
  explainMatchesDeterministic,
} from "@/features/hire/explain-matches";
import { resolveEligibleCandidates } from "@/features/hire/pool-policy";
import { toPublicMatch } from "@/features/hire/to-public-match";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";
import {
  createSession,
  ensureLegacySession,
  getOwnedSession,
  pruneUndecidedOutsideSessions,
  recordSessionRun,
  specFromJson,
  specToJson,
} from "@/features/hire/search-sessions";

type ActionOk<T> = { ok: true; data: T };
type ActionErr = { ok: false; message: string };
type ActionResult<T> = ActionOk<T> | ActionErr;

/**
 * How deep the adoption re-run looks for the candidates a guest saw.
 *
 * The guest search itself used `limit: 20`. If the pool shifts between that
 * search and sign-in, a candidate the recruiter saw can fall past 20 and be
 * silently dropped, so adoption looks further. This narrows the window; it does
 * not close it, and the shortfall is logged rather than hidden.
 */
const ADOPTION_SEARCH_LIMIT = 100;

const requireApprovedRecruiter = requireApprovedRecruiterAction;
const requireRegisteredRecruiter = requireRegisteredRecruiterAction;

function specToDb(spec: JobSpec) {
  return {
    // Empty means "not asked yet" — never a placeholder. A non-empty default
    // here made the title slot look answered, so Scout skipped the role
    // question and mis-filed the recruiter's first reply as the stack.
    title: spec.title?.trim() ?? "",
    seniority: (spec.seniority ?? null) as TalentSeniority | null,
    openings: spec.openings ?? 1,
    mustHaveStack: spec.mustHaveStack ?? [],
    niceToHaveStack: spec.niceToHaveStack ?? [],
    evidencePriority: spec.evidencePriority ?? [],
    salaryMin: spec.salaryMin ?? null,
    salaryMax: spec.salaryMax ?? null,
    salaryCurrency: spec.salaryCurrency ?? "INR",
    salaryPeriod: spec.salaryPeriod ?? "ANNUAL",
    workMode: (spec.workMode ?? null) as TalentWorkMode | null,
    locationCity: spec.locationCity ?? null,
    employmentType: (spec.employmentType ?? null) as TalentEmploymentType | null,
    noticePeriodDays: spec.noticePeriodDays ?? null,
    minExperience: spec.minExperience ?? null,
    maxExperience: spec.maxExperience ?? null,
    requiresDegree: spec.requiresDegree ?? false,
    extra: (spec.extra ?? undefined) as Prisma.InputJsonValue | undefined,
  };
}

function dbToSpec(row: {
  title: string;
  seniority: TalentSeniority | null;
  openings: number;
  mustHaveStack: string[];
  niceToHaveStack: string[];
  evidencePriority: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  salaryPeriod: string;
  workMode: TalentWorkMode | null;
  locationCity: string | null;
  employmentType: TalentEmploymentType | null;
  noticePeriodDays: number | null;
  minExperience: number | null;
  maxExperience: number | null;
  requiresDegree: boolean;
  extra: unknown;
}): JobSpec {
  return jobSpecSchema.parse({
    // Empty stays empty so the role slot reads as unanswered (see specToDb).
    title: row.title.trim() || undefined,
    seniority: row.seniority,
    openings: row.openings,
    mustHaveStack: row.mustHaveStack,
    niceToHaveStack: row.niceToHaveStack,
    evidencePriority: row.evidencePriority,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    salaryCurrency: row.salaryCurrency,
    salaryPeriod: row.salaryPeriod === "MONTHLY" ? "MONTHLY" : "ANNUAL",
    workMode: row.workMode,
    locationCity: row.locationCity,
    employmentType: row.employmentType,
    noticePeriodDays: row.noticePeriodDays,
    minExperience: row.minExperience,
    maxExperience: row.maxExperience,
    requiresDegree: row.requiresDegree,
    extra:
      row.extra && typeof row.extra === "object"
        ? (row.extra as Record<string, unknown>)
        : null,
  });
}

export async function sendScoutMessageAction(
  input: unknown,
): Promise<
  ActionResult<{
    requestId: string;
    /** Plan 133: the search session this turn was written to. */
    sessionId: string;
    assistantMessage: string;
    options: { label: string; value: string }[];
    allowFreeText: boolean;
    readyToSearch: boolean;
    summary: string;
    spec: JobSpec;
    /** Engine instruction: run the search, or start a fresh brief. */
    action: "search" | "reset" | null;
  }>
> {
  const gate = await requireApprovedRecruiter();
  if (!gate.ok) return gate;
  const limited = await assertRateLimit({
    bucket: "SEARCH",
    subjectId: gate.data.userId,
  });
  if (!limited.ok) return limited;
  const parsed = sendScoutMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Invalid message." };
  }

  const {
    message,
    display,
    requestId: existingId,
    sessionId: existingSessionId,
  } = parsed.data;
  const userId = gate.data.userId;

  try {
    let requestId = existingId;
    let sessionId: string;
    // Plan 133: the brief and the history are the SESSION's, not the
    // project's. A new search starts from nothing and cannot rewrite an
    // earlier one.
    let priorSpec: JobSpec = {};

    if (requestId) {
      const existing = await prisma.talentRequest.findFirst({
        where: { id: requestId, recruiterUserId: userId },
        select: { id: true },
      });
      if (!existing) return { ok: false, message: "Request not found." };
      // A project from before sessions: its history becomes Session 1 first,
      // so a new session here never swallows it.
      await ensureLegacySession(requestId);

      if (existingSessionId) {
        const session = await getOwnedSession(userId, requestId, existingSessionId);
        if (!session) return { ok: false, message: "Search not found." };
        sessionId = session.id;
        priorSpec = specFromJson(session.spec);
      } else {
        sessionId = (await createSession({ requestId, title: display ?? message })).id;
      }
    } else {
      const created = await prisma.talentRequest.create({
        data: {
          recruiterUserId: userId,
          status: TalentRequestStatus.DRAFT,
          // Unset until the recruiter answers the role question.
          title: "",
        },
        select: { id: true },
      });
      requestId = created.id;
      sessionId = (await createSession({ requestId, title: display ?? message })).id;
    }

    const historyRows = await prisma.talentRequestMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
      take: 40,
    });

    await prisma.talentRequestMessage.create({
      data: {
        requestId,
        sessionId,
        role: "user",
        // What the recruiter saw on the chip, not the machine value behind it.
        // A bubble reading "30" under a button labelled "Within 30 days" is not
        // the conversation they had. The engine still parses `message`.
        content: display ?? message,
      },
    });

    const turn = await runScoutTurn({
      priorSpec,
      history: historyRows.map((r) => ({
        role: r.role === "assistant" ? "assistant" : "user",
        content: r.content,
      })),
      userMessage: message,
    });

    // The session owns its brief. The project's columns mirror the latest one
    // so the demand board, admin and hire alerts keep reading what they read.
    const dbFields = specToDb(turn.spec);
    await prisma.$transaction([
      prisma.talentSearchSession.update({
        where: { id: sessionId },
        data: { spec: specToJson(turn.spec) },
        select: { id: true },
      }),
      prisma.talentRequest.update({
        where: { id: requestId },
        data: {
          ...dbFields,
          extra: dbFields.extra ?? Prisma.JsonNull,
        },
        select: { id: true },
      }),
    ]);

    // What the recruiter sees live and what is replayed on reload must be the
    // same string. They were not: the stored copy prefixed the running summary,
    // so every reloaded bubble repeated it above the actual question.
    // A notice is Scout answering something or naming a limit; the question is
    // what comes next. Stored as one message so the reload replays exactly what
    // the recruiter saw.
    const assistantMessage = [turn.notice, turn.nextQuestion]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join("\n\n") ||
      "That's everything I need. Ready to search verified talent.";

    await prisma.talentRequestMessage.create({
      data: {
        requestId,
        sessionId,
        role: "assistant",
        content: assistantMessage,
        options: turn.options,
      },
    });

    revalidatePath("/hire");
    revalidatePath(`/hire/${requestId}`);

    return {
      ok: true,
      data: {
        requestId,
        sessionId,
        assistantMessage,
        options: turn.options,
        allowFreeText: turn.allowFreeText,
        readyToSearch: turn.readyToSearch,
        summary: turn.summary,
        spec: turn.spec,
        action: turn.action ?? null,
      },
    };
  } catch (error) {
    logger.error("[hire] sendScoutMessageAction", { error: String(error) });
    return {
      ok: false,
      message:
        "Could not save message. Apply the hire migration on your Neon branch if tables are missing.",
    };
  }
}

const MATCH_REQUEST_SELECT = {
  id: true,
  title: true,
  seniority: true,
  openings: true,
  mustHaveStack: true,
  niceToHaveStack: true,
  evidencePriority: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  salaryPeriod: true,
  workMode: true,
  locationCity: true,
  employmentType: true,
  noticePeriodDays: true,
  minExperience: true,
  maxExperience: true,
  requiresDegree: true,
  extra: true,
} as const;

/**
 * Rank + persist matches for a TalentRequest the caller already owns.
 * Plan 133: a run belongs to one session and searches THAT session's brief.
 * No session id means a new search, which gets a new session.
 */
async function executeMatchForOwnedRequest(
  requestId: string,
  recruiterUserId: string,
  options: { persistGapMessage?: boolean; sessionId?: string } = {},
): Promise<
  ActionResult<{
    requestId: string;
    sessionId: string;
    matchCount: number;
    overallGap: string;
  }>
> {
  const req = await prisma.talentRequest.findFirst({
    where: { id: requestId, recruiterUserId },
    select: MATCH_REQUEST_SELECT,
  });
  if (!req) return { ok: false, message: "Request not found." };

  await ensureLegacySession(req.id);
  let sessionId: string;
  let spec: JobSpec;
  if (options.sessionId) {
    const session = await getOwnedSession(
      recruiterUserId,
      req.id,
      options.sessionId,
    );
    if (!session) return { ok: false, message: "Search not found." };
    sessionId = session.id;
    spec = specFromJson(session.spec);
  } else {
    spec = dbToSpec(req);
    sessionId = (await createSession({ requestId: req.id, title: spec.title ?? null, spec })).id;
  }

  const search = await searchCandidates(spec, { limit: SEARCH_RESULT_LIMIT });
  if (!search.ok) return search;

  const explained = await explainMatches(
    search.data.matches,
    search.data.nearMisses,
    spec,
    {
      totalEligible: search.data.totalEligible,
      belowEvidenceFloor: search.data.belowEvidenceFloor,
      coverageNote: search.data.coverage.note,
      stage: search.data.stage,
    },
  );

  // A track the DB enum does not know yet cannot be stored. It is still shown
  // and still ranked — only the persisted copy is skipped — and it is logged,
  // because the fix is a one-line enum migration and silence would hide it.
  const persistable = explained.matches.filter((m) =>
    Boolean(persistableSource(m.source)),
  );
  const unstorable = explained.matches.length - persistable.length;
  if (unstorable > 0) {
    logger.error("[hire] matches not persisted: source missing from enum", {
      count: unstorable,
      sources: [
        ...new Set(
          explained.matches
            .filter((m) => !persistableSource(m.source))
            .map((m) => m.source),
        ),
      ].join(","),
    });
  }

  const rows = persistable.map((m) => {
    const card = toPublicMatch(m, {
      coverageNote: search.data.coverage.note,
      highlightSkills: spec.mustHaveStack,
    });
    return {
      requestId: req.id,
      source: persistableSource(m.source)!,
      // The candidate is the person. Every track has one of these.
      candidateUserId: m.userId,
      // Provenance: which cohort row the evidence came from, where there
      // was one. Not a key, not a foreign key, never looked up by.
      programMemberId: m.programMemberId,
      score: m.score,
      tier: m.tier as TalentMatchTier,
      scoreBreakdown: m.scoreBreakdown as unknown as Prisma.InputJsonValue,
      // Public evidence only — CandidateEvidence still carries company.
      evidence: {
        ...card.evidence,
        locationLabel: card.locationLabel ?? null,
        compensationBand: card.compensationBand ?? null,
        compensationDeclared: card.compensationDeclared ?? false,
      } as unknown as Prisma.InputJsonValue,
      rationale: m.rationale,
      gaps: m.gaps,
      availabilityUnknown: m.availabilityUnknown,
    };
  });

  // T-044 / T-149: a match run must not forget what the recruiter already did.
  //
  // This used to delete every row for the request and recreate it, which made
  // firstSeenAt / viewedAt / decision impossible to keep. Now only UNDECIDED
  // rows that dropped out of this run are deleted. SHORTLISTED and REJECTED
  // stay even when the candidate is outside the latest top set. Survivors
  // (and returning decided rows) are upserted with an `update` branch that
  // touches ONLY the scoring fields. The three state columns are absent
  // from `update` on purpose — that omission is the whole feature.
  //
  // One $transaction([...]) batch rather than an interactive callback, so
  // this stays on `prisma` exactly as before and needs no direct Neon
  // endpoint. (Review sheet question 5 asks whether writeClient() is wanted
  // here; keeping the current client means that answer changes nothing else.)
  //
  // Plan 133: "dropped out of this run" is no longer enough to delete. An
  // UNDECIDED row goes only when NO session of this project still shows
  // it, or reopening an earlier search would find its results gone. This
  // session's own list is written first, so the union below is current.
  await prisma.$transaction(
    rows.map(({ requestId: rowRequestId, candidateUserId, ...scoring }) =>
      prisma.talentRequestMatch.upsert({
        where: { requestId_candidateUserId: { requestId: rowRequestId, candidateUserId } },
        create: { requestId: rowRequestId, candidateUserId, ...scoring },
        update: scoring,
      }),
    ),
  );
  await recordSessionRun({
    sessionId,
    rows: rows.map((row) => ({
      candidateUserId: row.candidateUserId,
      score: row.score,
      tier: row.tier,
      scoreBreakdown: row.scoreBreakdown,
      evidence: row.evidence,
      rationale: row.rationale,
      gaps: row.gaps,
      availabilityUnknown: row.availabilityUnknown,
    })),
    overallGap: explained.overallGap,
    matchCount: explained.matches.length,
  });
  await pruneUndecidedOutsideSessions(req.id);

  // Always promote to ACTIVE so demand board sees the requirement
  const status =
    explained.matches.length > 0
      ? TalentRequestStatus.MATCHED
      : TalentRequestStatus.ACTIVE;

  await prisma.talentRequest.update({
    where: { id: req.id },
    data: { status },
  });

  if (options.persistGapMessage !== false) {
    await prisma.talentRequestMessage.create({
      data: {
        requestId: req.id,
        sessionId,
        role: "assistant",
        content: explained.overallGap,
      },
    });
  }

  revalidatePath(`/hire/${req.id}`);
  revalidatePath("/admin/hire");

  return {
    ok: true,
    data: {
      requestId: req.id,
      sessionId,
      matchCount: explained.matches.length,
      overallGap: explained.overallGap,
    },
  };
}

export async function runMatchAction(
  input: unknown,
): Promise<
  ActionResult<{
    requestId: string;
    /** Plan 133: the session these results belong to. */
    sessionId: string;
    matchCount: number;
    overallGap: string;
  }>
> {
  const gate = await requireApprovedRecruiter();
  if (!gate.ok) return gate;
  const limited = await assertRateLimit({
    bucket: "SEARCH",
    subjectId: gate.data.userId,
  });
  if (!limited.ok) return limited;
  const parsed = runMatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };

  try {
    return await executeMatchForOwnedRequest(
      parsed.data.requestId,
      gate.data.userId,
      { sessionId: parsed.data.sessionId },
    );
  } catch (error) {
    logger.error("[hire] runMatchAction", { error: String(error) });
    return {
      ok: false,
      message: "Match failed. Check migration and try again.",
    };
  }
}

/**
 * Write a filter-dialog spec onto the recruiter's own TalentRequest and
 * re-run search. No Scout turn — the brief is already structured.
 */
export async function applyHireFiltersAction(
  input: unknown,
): Promise<
  ActionResult<{
    requestId: string;
    sessionId: string;
    matchCount: number;
    overallGap: string;
  }>
> {
  const gate = await requireApprovedRecruiter();
  if (!gate.ok) return gate;
  const limited = await assertRateLimit({
    bucket: "SEARCH",
    subjectId: gate.data.userId,
  });
  if (!limited.ok) return limited;
  const parsed = applyHireFiltersSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid filters." };

  try {
    const owned = await prisma.talentRequest.findFirst({
      where: {
        id: parsed.data.requestId,
        recruiterUserId: gate.data.userId,
      },
      select: { id: true },
    });
    if (!owned) return { ok: false, message: "Request not found." };

    await prisma.talentRequest.update({
      where: { id: owned.id },
      data: specToDb(parsed.data.spec),
    });

    let sessionId = parsed.data.sessionId;
    if (sessionId) {
      const session = await getOwnedSession(
        gate.data.userId,
        owned.id,
        sessionId,
      );
      if (!session) return { ok: false, message: "Search not found." };
      await prisma.talentSearchSession.update({
        where: { id: session.id },
        data: { spec: specToJson(parsed.data.spec) },
        select: { id: true },
      });
    }

    return await executeMatchForOwnedRequest(owned.id, gate.data.userId, {
      persistGapMessage: false,
      sessionId,
    });
  } catch (error) {
    logger.error("[hire] applyHireFiltersAction", { error: String(error) });
    return {
      ok: false,
      message: "Could not apply filters. Try again.",
    };
  }
}

export async function saveCandidateAvailabilityAction(
  input: unknown,
): Promise<ActionResult<{ openToWork: boolean }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Please sign in." };
  }
  const parsed = candidateAvailabilitySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Please check availability fields." };
  }
  const v = parsed.data;
  try {
    await upsertCandidateAvailability(session.user.id, {
      openToWork: v.openToWork,
      expectedSalaryMin: v.expectedSalaryMin ?? null,
      expectedSalaryMax: v.expectedSalaryMax ?? null,
      salaryCurrency: v.salaryCurrency ?? "INR",
      noticePeriodDays: v.noticePeriodDays ?? null,
      preferredWorkMode: v.preferredWorkMode ?? null,
      preferredCities: (v.preferredCities ?? [])
        .map((c) =>
          c
            .trim()
            .replace(/\s+/g, " ")
            .replace(/\b\w/g, (ch) => ch.toUpperCase()),
        )
        .slice(0, 5),
      openToRelocate: v.openToRelocate ?? false,
    });
    revalidatePath("/profile");
    revalidatePath(`${PROGRAM_AI_COHORT_BASE}/dashboard`);
    return { ok: true, data: { openToWork: v.openToWork } };
  } catch (error) {
    logger.error("[hire] saveCandidateAvailabilityAction", {
      error: String(error),
    });
    return {
      ok: false,
      message: "Could not save availability. Please try again.",
    };
  }
}

export async function requestCohortTrainAction(
  requestId: string,
): Promise<ActionResult<{ requestId: string }>> {
  const gate = await requireApprovedRecruiter();
  if (!gate.ok) return gate;
  if (!requestId) return { ok: false, message: "Missing request." };

  try {
    const updated = await prisma.talentRequest.updateMany({
      where: { id: requestId, recruiterUserId: gate.data.userId },
      data: {
        alertWhenAvailable: true,
        status: TalentRequestStatus.ACTIVE,
      },
    });
    if (updated.count === 0) {
      return { ok: false, message: "Request not found." };
    }
    revalidatePath(`/hire/${requestId}`);
    revalidatePath("/admin/hire");
    return { ok: true, data: { requestId } };
  } catch (error) {
    logger.error("[hire] requestCohortTrainAction", { error: String(error) });
    return { ok: false, message: "Could not save training request." };
  }
}

const SAMPLE_DEMAND_NOTE =
  "Demand captured from a sample card — recruiter asked to be told when someone matching this requirement exists.";

/**
 * Record that the recruiter wants this requirement filled.
 *
 * Sets `alertWhenAvailable` on an existing TalentRequest, or creates one from
 * a spec when the recruiter arrived via the guest pending-demand rail. Same
 * columns `requestCohortTrainAction` already writes; the system message is
 * how admin can tell a sample-card ask from a normal one.
 */
export async function recordSampleDemandAction(
  input: unknown,
): Promise<ActionResult<{ requestId: string }>> {
  const gate = await requireRegisteredRecruiter();
  if (!gate.ok) return gate;
  const parsed = recordSampleDemandSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Could not read that requirement." };
  }

  const userId = gate.data.userId;
  const { requestId: existingId, spec } = parsed.data;

  try {
    if (existingId) {
      const existing = await prisma.talentRequest.findFirst({
        where: { id: existingId, recruiterUserId: userId },
        select: { id: true, alertWhenAvailable: true },
      });
      if (!existing) return { ok: false, message: "Request not found." };

      if (!existing.alertWhenAvailable) {
        await prisma.talentRequest.update({
          where: { id: existing.id },
          data: {
            alertWhenAvailable: true,
            status: TalentRequestStatus.ACTIVE,
          },
        });
      }

      await prisma.talentRequestMessage.create({
        data: {
          requestId: existing.id,
          role: "system",
          content: SAMPLE_DEMAND_NOTE,
        },
      });

      revalidatePath(`/hire/${existing.id}`);
      revalidatePath("/admin/hire");
      return { ok: true, data: { requestId: existing.id } };
    }

    if (!spec) return { ok: false, message: "Could not read that requirement." };

    const derivedTitle =
      spec.title?.trim() ||
      (spec.mustHaveStack?.[0]
        ? `${spec.mustHaveStack[0]!.charAt(0).toUpperCase()}${spec.mustHaveStack[0]!.slice(1)} developer`
        : "Untitled requirement");

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.talentRequest.create({
        data: {
          recruiterUserId: userId,
          status: TalentRequestStatus.ACTIVE,
          ...specToDb({ ...spec, title: derivedTitle }),
          alertWhenAvailable: true,
        },
        select: { id: true },
      });
      await tx.talentRequestMessage.create({
        data: {
          requestId: row.id,
          role: "system",
          content: SAMPLE_DEMAND_NOTE,
        },
      });
      return row;
    });

    revalidatePath("/hire");
    revalidatePath(`/hire/${created.id}`);
    revalidatePath("/admin/hire");
    return { ok: true, data: { requestId: created.id } };
  } catch (error) {
    logger.error("[hire] recordSampleDemandAction", { error: String(error) });
    return { ok: false, message: "Could not save that requirement." };
  }
}

/**
 * Persist the candidates a guest actually saw onto a request they now own.
 *
 * Called AFTER the adoption transaction has committed, never inside it: this
 * runs a full search, and slow work in an interactive transaction holds a
 * connection open for the length of it.
 *
 * The refs arrive from the browser and are treated as a *hint about which
 * candidates*, never as authority about them. `resolveEligibleCandidates`
 * re-tests every one against its own pool's visibility and eligibility rules,
 * and the scoring is recomputed here — so a forged, stale or edited ref buys
 * nothing that an ordinary signed-in search would not already return.
 *
 * The search is re-run and then INTERSECTED with those refs rather than taken
 * wholesale. A plain re-run is not the same promise: the guest saw A, B, C, and
 * a fresh search minutes later may rank a D into the top 20. D was never their
 * work, so it is not adopted.
 */
async function adoptGuestMatches(
  requestId: string,
  spec: JobSpec,
  candidateRefs: string[],
): Promise<{ adopted: number; skipped: number }> {
  const entitled = await resolveEligibleCandidates(candidateRefs);
  if (entitled.length === 0) return { adopted: 0, skipped: candidateRefs.length };
  const entitledRefs = new Set(entitled.map((c) => c.candidateRef));

  // Wider than the guest search's own limit of 20. The pool can shift between
  // the guest search and sign-in, and a candidate who has slipped to 30th must
  // still be found. It narrows the window rather than closing it — see the
  // shortfall log below.
  const search = await searchCandidates(spec, { limit: ADOPTION_SEARCH_LIMIT });
  if (!search.ok) return { adopted: 0, skipped: candidateRefs.length };

  const kept = search.data.matches.filter((m) => entitledRefs.has(m.candidateRef));

  // Deterministic only. `explainMatches` calls a model to upgrade the prose;
  // that is slow, costs money and returns different words each time. The
  // deterministic pass is what it computes first anyway, and `gaps` come from
  // the scorer rather than the model, so nothing of substance is lost.
  const explained = explainMatchesDeterministic(kept, [], spec, {
    totalEligible: search.data.totalEligible,
    belowEvidenceFloor: search.data.belowEvidenceFloor,
    coverageNote: search.data.coverage.note,
    stage: search.data.stage,
  });

  const rows = explained.matches
    .filter((m) => Boolean(persistableSource(m.source)))
    .map((m) => {
      const card = toPublicMatch(m, {
        coverageNote: search.data.coverage.note,
        highlightSkills: spec.mustHaveStack,
      });
      return {
        requestId,
        source: persistableSource(m.source)!,
        candidateUserId: m.userId,
        programMemberId: m.programMemberId,
        score: m.score,
        tier: m.tier as TalentMatchTier,
        scoreBreakdown: m.scoreBreakdown as unknown as Prisma.InputJsonValue,
        evidence: {
          ...card.evidence,
          locationLabel: card.locationLabel ?? null,
          compensationBand: card.compensationBand ?? null,
          compensationDeclared: card.compensationDeclared ?? false,
        } as unknown as Prisma.InputJsonValue,
        rationale: m.rationale,
        gaps: m.gaps,
        availabilityUnknown: m.availabilityUnknown,
      };
    });

  if (rows.length > 0) {
    // Upsert, not createMany: adoption can be retried, and a retry must not
    // duplicate a candidate or reset the state T-044 preserves.
    await prisma.$transaction(
      rows.map(({ requestId: rid, candidateUserId, ...scoring }) =>
        prisma.talentRequestMatch.upsert({
          where: {
            requestId_candidateUserId: { requestId: rid, candidateUserId },
          },
          create: { requestId: rid, candidateUserId, ...scoring },
          update: scoring,
        }),
      ),
    );
  }

  // Entitled, but the re-run did not reach them — the pool moved further than
  // ADOPTION_SEARCH_LIMIT covers. Raising the limit shrinks this; it cannot
  // eliminate it. Logged so the real rate is knowable rather than guessed at.
  const missing = entitled.length - rows.length;
  if (missing > 0) {
    logger.error("[hire] guest matches entitled but not returned by the re-run", {
      requestId,
      entitled: entitled.length,
      adopted: rows.length,
      missing,
      limit: ADOPTION_SEARCH_LIMIT,
    });
  }

  return { adopted: rows.length, skipped: candidateRefs.length - rows.length };
}

/**
 * After sign-in, write the guest Scout transcript onto a TalentRequest so the
 * brief and chat are not trapped in the browser and lost on the next page.
 */
export async function adoptGuestScoutSessionAction(
  input: unknown,
): Promise<
  ActionResult<{ requestId: string; adopted: number; skipped: number }>
> {
  const gate = await requireApprovedRecruiter();
  if (!gate.ok) return gate;
  const parsed = adoptGuestScoutSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Could not save that conversation." };
  }

  const { spec, messages, searched, candidateRefs = [] } = parsed.data;
  const userId = gate.data.userId;
  const last = messages[messages.length - 1]?.content ?? "";

  try {
    const recent = await prisma.talentRequest.findMany({
      where: {
        recruiterUserId: userId,
        createdAt: { gte: new Date(Date.now() - 15 * 60_000) },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true },
        },
      },
    });
    // A retry lands here. The request and its messages already exist, so only
    // the match step is repeated — which is exactly what makes recovery from a
    // half-done adoption possible without duplicating anything.
    const already = recent.find((r) => r.messages[0]?.content === last);
    if (already) {
      const retry =
        searched && candidateRefs.length > 0
          ? await adoptGuestMatches(already.id, spec, candidateRefs)
          : { adopted: 0, skipped: 0 };
      if (retry.adopted > 0) {
        await prisma.talentRequest.update({
          where: { id: already.id },
          data: { status: TalentRequestStatus.MATCHED },
          select: { id: true },
        });
        revalidatePath("/hire");
        revalidatePath(`/hire/${already.id}`);
      }
      return { ok: true, data: { requestId: already.id, ...retry } };
    }

    const dbFields = specToDb(spec);

    // Only the two fast writes live in the transaction. The match step runs
    // after it commits: it performs a full search, and holding an interactive
    // transaction open across that would pin a connection for its whole
    // duration.
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.talentRequest.create({
        data: {
          recruiterUserId: userId,
          // Deliberately NOT `searched ? MATCHED : DRAFT`. Status followed the
          // guest's intent, so a request whose matches were never written still
          // claimed MATCHED — the "MATCHED with zero matches" state the
          // investigation found in production. It is set from the outcome below
          // instead, which makes that state unreachable.
          status: TalentRequestStatus.DRAFT,
          ...dbFields,
          extra: dbFields.extra ?? Prisma.JsonNull,
        },
        select: { id: true },
      });
      await tx.talentRequestMessage.createMany({
        data: messages.map((m) => ({
          requestId: row.id,
          role: m.role,
          content: m.content,
          ...(m.options
            ? { options: m.options as Prisma.InputJsonValue }
            : {}),
        })),
      });
      return row;
    });

    const { adopted, skipped } =
      searched && candidateRefs.length > 0
        ? await adoptGuestMatches(created.id, spec, candidateRefs)
        : { adopted: 0, skipped: 0 };

    // ACTIVE, not MATCHED, when nothing survived: the requirement is real and
    // belongs on the demand board, but claiming a match it does not have is the
    // bug this replaces.
    if (searched) {
      await prisma.talentRequest.update({
        where: { id: created.id },
        data: {
          status:
            adopted > 0
              ? TalentRequestStatus.MATCHED
              : TalentRequestStatus.ACTIVE,
        },
        select: { id: true },
      });
    }

    revalidatePath("/hire");
    revalidatePath(`/hire/${created.id}`);
    return { ok: true, data: { requestId: created.id, adopted, skipped } };
  } catch (error) {
    logger.error("[hire] adoptGuestScoutSessionAction", { error: String(error) });
    return { ok: false, message: "Could not save that conversation." };
  }
}
