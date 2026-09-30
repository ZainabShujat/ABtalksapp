import "server-only";
import { PipelineStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PIPELINE_STAGE_ORDER as SHARED_STAGE_ORDER } from "@/lib/pipeline-stages";

/**
 * T-240 recruiter hiring pipeline — sole reader/writer for `TalentListItem`.
 *
 * Every read and write scopes on `TalentList.ownerRecruiterId`, so a recruiter
 * only ever sees rows on a list they own. No other module in `src/` may touch
 * `prisma.talentListItem.*` directly — go through this repository.
 *
 * The list itself (`TalentList`) is the recruiter's private, auto-provisioned
 * pipeline. Its `name` is a reserved slug (`__pipeline:<recruiterProfileId>`)
 * so `@@unique([organizationId, name])` can never collide with a recruiter's
 * own custom list.
 *
 * Plan: [docs/plans/146-t240-recruiter-hiring-pipeline.md].
 */

const PIPELINE_LIST_NAME_PREFIX = "__pipeline:";
const PIPELINE_LIST_DESCRIPTION = "Hiring pipeline";

export function pipelineListName(recruiterProfileId: string): string {
  return `${PIPELINE_LIST_NAME_PREFIX}${recruiterProfileId}`;
}

/**
 * Re-export the shared stage order so existing repository callers keep the
 * `@/repositories/talent-pipeline` import — the leaf module in
 * `@/lib/pipeline-stages.ts` is the one the client bundle sees, so a client
 * component never pulls this server-only file through the graph.
 */
export const PIPELINE_STAGE_ORDER = SHARED_STAGE_ORDER;

export type PipelineWorkspace = {
  recruiterProfileId: string;
  organizationId: string;
  /** The userId of the recruiter — recorded as `addedByUserId` on new items. */
  userId: string;
};

export type PipelineCardRow = {
  itemId: string;
  candidateUserId: string | null;
  candidateLabel: string;
  stage: PipelineStage;
  addedAt: Date;
  stageChangedAt: Date;
};

export type PipelineSnapshot = {
  listId: string;
  stages: Record<PipelineStage, PipelineCardRow[]>;
  counts: Record<PipelineStage, number>;
  candidateIds: Set<string>;
};

export type PipelineResult<T = undefined> = T extends undefined
  ? { ok: true }
  : { ok: true; data: T };
export type PipelineError = { ok: false; message: string };

/**
 * Return the recruiter's private pipeline list, creating it on first use.
 * Idempotent: rerunning it once the list exists is a single upsert with an
 * empty update payload.
 */
export async function ensureRecruiterPipeline(
  workspace: PipelineWorkspace,
): Promise<{ id: string }> {
  const name = pipelineListName(workspace.recruiterProfileId);
  return prisma.talentList.upsert({
    where: {
      organizationId_name: {
        organizationId: workspace.organizationId,
        name,
      },
    },
    create: {
      organizationId: workspace.organizationId,
      ownerRecruiterId: workspace.recruiterProfileId,
      isSharedWithOrg: false,
      name,
      description: PIPELINE_LIST_DESCRIPTION,
    },
    update: {},
    select: { id: true },
  });
}

function emptyBuckets<T>(): Record<PipelineStage, T[]> {
  return PIPELINE_STAGE_ORDER.reduce(
    (acc, stage) => ({ ...acc, [stage]: [] as T[] }),
    {} as Record<PipelineStage, T[]>,
  );
}

function zeroCounts(): Record<PipelineStage, number> {
  return PIPELINE_STAGE_ORDER.reduce(
    (acc, stage) => ({ ...acc, [stage]: 0 }),
    {} as Record<PipelineStage, number>,
  );
}

/**
 * The recruiter's full pipeline, bucketed by stage. Rows exclude tombstones
 * where the candidate has deleted their account (candidateUserId is null) —
 * the list still keeps the row so the recruiter's history is not silently
 * shortened, but there is nothing meaningful to render for it on the board.
 */
export async function listPipeline(
  workspace: PipelineWorkspace,
): Promise<PipelineSnapshot> {
  const list = await ensureRecruiterPipeline(workspace);

  // Sync discovered candidates from the recruiter's projects into SOURCED
  // so candidates discovered in search/projects automatically appear in Sourced pipeline.
  try {
    const discoveredMatches = await prisma.talentRequestMatch.findMany({
      where: {
        request: {
          recruiterUserId: workspace.userId,
        },
      },
      select: {
        candidateUserId: true,
        firstSeenAt: true,
        candidate: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { firstSeenAt: "asc" },
    });

    if (discoveredMatches.length > 0) {
      // Find which candidates already exist in the recruiter's pipeline
      const existingItems = await prisma.talentListItem.findMany({
        where: {
          talentListId: list.id,
          talentList: { ownerRecruiterId: workspace.recruiterProfileId },
          candidateUserId: { not: null },
        },
        select: { candidateUserId: true },
      });
      const existingUserIds = new Set(
        existingItems
          .map((i) => i.candidateUserId)
          .filter((id): id is string => Boolean(id)),
      );

      // Add missing discovered candidates at SOURCED stage
      const toAdd = new Map<string, { label: string; addedAt: Date }>();
      for (const m of discoveredMatches) {
        if (!existingUserIds.has(m.candidateUserId) && !toAdd.has(m.candidateUserId)) {
          toAdd.set(m.candidateUserId, {
            label: m.candidate?.name?.trim() || "Candidate",
            addedAt: m.firstSeenAt,
          });
        }
      }

      for (const [candidateUserId, info] of toAdd.entries()) {
        await addToPipeline(workspace, {
          candidateUserId,
          label: info.label,
          stage: PipelineStage.SOURCED,
        });
      }
    }
  } catch (err) {
    logger.warn("talent-pipeline.syncDiscoveredToSourced failed", {
      recruiterProfileId: workspace.recruiterProfileId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const rows = await prisma.talentListItem.findMany({
    where: {
      talentListId: list.id,
      talentList: { ownerRecruiterId: workspace.recruiterProfileId },
      candidateUserId: { not: null },
    },
    orderBy: [{ stage: "asc" }, { addedAt: "desc" }],
    select: {
      id: true,
      candidateUserId: true,
      candidateLabel: true,
      stage: true,
      addedAt: true,
      stageChangedAt: true,
    },
  });

  const stages = emptyBuckets<PipelineCardRow>();
  const counts = zeroCounts();
  const candidateIds = new Set<string>();

  for (const row of rows) {
    const bucket = stages[row.stage];
    bucket.push({
      itemId: row.id,
      candidateUserId: row.candidateUserId,
      candidateLabel: row.candidateLabel,
      stage: row.stage,
      addedAt: row.addedAt,
      stageChangedAt: row.stageChangedAt,
    });
    counts[row.stage] = (counts[row.stage] ?? 0) + 1;
    if (row.candidateUserId) candidateIds.add(row.candidateUserId);
  }

  return { listId: list.id, stages, counts, candidateIds };
}

/**
 * Recruiter's cache of "which candidates are on my pipeline". Cheap enough to
 * pass down to the Scout row buttons so an already-tracked candidate renders
 * as a disabled "In pipeline" pill instead of another "Add to Pipeline"
 * button.
 */
export async function listPipelineCandidateIds(
  workspace: PipelineWorkspace,
): Promise<Set<string>> {
  const list = await ensureRecruiterPipeline(workspace);
  const rows = await prisma.talentListItem.findMany({
    where: {
      talentListId: list.id,
      talentList: { ownerRecruiterId: workspace.recruiterProfileId },
      candidateUserId: { not: null },
    },
    select: { candidateUserId: true },
  });
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.candidateUserId) ids.add(row.candidateUserId);
  }
  return ids;
}

/**
 * How many candidates this recruiter has at one pipeline stage.
 *
 * Exists so T-242's recruiter analytics can report its "Contacted" figure
 * without reaching for `prisma.talentListItem` itself — this repository is the
 * only module allowed to touch that table, and the suite in
 * `talent-pipeline.test.ts` enforces it.
 *
 * Scoped on `ownerRecruiterId` like every other read here, so the count can
 * only ever be the calling recruiter's own.
 *
 * Deliberately does NOT call `ensureRecruiterPipeline`: counting is a read and
 * must not create a list as a side effect for a recruiter who has never opened
 * their board. No list means no items, which is the honest answer — zero.
 */
export async function countPipelineAtStage(
  workspace: PipelineWorkspace,
  stage: PipelineStage,
): Promise<number> {
  return prisma.talentListItem.count({
    where: {
      stage,
      talentList: { ownerRecruiterId: workspace.recruiterProfileId },
    },
  });
}

/**
 * Add a candidate to the recruiter's pipeline. Idempotent on
 * `@@unique([talentListId, candidateUserId])`: adding an already-tracked
 * candidate keeps their current stage — the Scout button must never demote
 * someone the recruiter has already advanced.
 *
 * `label` is the display fallback stored on the row so a candidate deleting
 * their account (which nulls `candidateUserId`) does not silently shrink the
 * pipeline count.
 */
export async function addToPipeline(
  workspace: PipelineWorkspace,
  input: {
    candidateUserId: string;
    label: string;
    stage?: PipelineStage;
  },
): Promise<PipelineResult<{ itemId: string; created: boolean }> | PipelineError> {
  const list = await ensureRecruiterPipeline(workspace);
  const stage = input.stage ?? PipelineStage.SHORTLISTED;
  const label = input.label.trim() || "Candidate";

  try {
    const existing = await prisma.talentListItem.findUnique({
      where: {
        talentListId_candidateUserId: {
          talentListId: list.id,
          candidateUserId: input.candidateUserId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      return { ok: true, data: { itemId: existing.id, created: false } };
    }

    const created = await prisma.talentListItem.create({
      data: {
        talentListId: list.id,
        candidateUserId: input.candidateUserId,
        candidateLabel: label,
        stage,
        addedByUserId: workspace.userId,
        stageChangedAt: new Date(),
      },
      select: { id: true },
    });
    return { ok: true, data: { itemId: created.id, created: true } };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Race: another request added the same candidate between our findUnique
      // and create. Treat as success — the row exists.
      const row = await prisma.talentListItem.findUnique({
        where: {
          talentListId_candidateUserId: {
            talentListId: list.id,
            candidateUserId: input.candidateUserId,
          },
        },
        select: { id: true },
      });
      if (row) return { ok: true, data: { itemId: row.id, created: false } };
    }
    logger.error("talent-pipeline.addToPipeline failed", {
      recruiterProfileId: workspace.recruiterProfileId,
      candidateUserId: input.candidateUserId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, message: "Could not add candidate to pipeline." };
  }
}

/**
 * Move a pipeline item to a new stage. Enforces recruiter isolation by
 * scoping the update to the caller's own list — an itemId belonging to a
 * different recruiter's list matches zero rows and returns a not-found.
 */
export async function moveStage(
  workspace: PipelineWorkspace,
  input: { itemId: string; stage: PipelineStage },
): Promise<PipelineResult | PipelineError> {
  try {
    const result = await prisma.talentListItem.updateMany({
      where: {
        id: input.itemId,
        talentList: {
          ownerRecruiterId: workspace.recruiterProfileId,
        },
      },
      data: {
        stage: input.stage,
        stageChangedAt: new Date(),
      },
    });
    if (result.count === 0) {
      return { ok: false, message: "Pipeline item not found." };
    }
    return { ok: true };
  } catch (err) {
    logger.error("talent-pipeline.moveStage failed", {
      recruiterProfileId: workspace.recruiterProfileId,
      itemId: input.itemId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, message: "Could not move candidate stage." };
  }
}

/**
 * The candidate on one of this recruiter's pipeline cards, or null. Same
 * ownership scope as `moveStage` — an itemId on another recruiter's list
 * resolves to null. Read-only; used by the applications write-back
 * (features/pipeline-convergence/sync-application-status.ts).
 */
export async function getPipelineItemCandidateId(
  workspace: PipelineWorkspace,
  itemId: string,
): Promise<string | null> {
  const item = await prisma.talentListItem.findFirst({
    where: {
      id: itemId,
      talentList: { ownerRecruiterId: workspace.recruiterProfileId },
    },
    select: { candidateUserId: true },
  });
  return item?.candidateUserId ?? null;
}

/**
 * Remove a candidate from the recruiter's pipeline. Same ownership guard as
 * `moveStage` — deleteMany scopes through the parent list, so an itemId from
 * a different recruiter's list is a silent no-op we surface as not-found.
 */
export async function removeFromPipeline(
  workspace: PipelineWorkspace,
  input: { itemId: string },
): Promise<PipelineResult | PipelineError> {
  try {
    const result = await prisma.talentListItem.deleteMany({
      where: {
        id: input.itemId,
        talentList: {
          ownerRecruiterId: workspace.recruiterProfileId,
        },
      },
    });
    if (result.count === 0) {
      return { ok: false, message: "Pipeline item not found." };
    }
    return { ok: true };
  } catch (err) {
    logger.error("talent-pipeline.removeFromPipeline failed", {
      recruiterProfileId: workspace.recruiterProfileId,
      itemId: input.itemId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, message: "Could not remove candidate from pipeline." };
  }
}

