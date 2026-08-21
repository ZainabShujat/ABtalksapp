/**
 * Shared helpers for plan 078 Phase 2 backfill scripts.
 * Target the Neon child branch plan-078-phase1. Legacy tables are read-only.
 */
import {
  Domain,
  EnrollmentStatus,
  PrismaClient,
  ProgramMemberStatus,
  type Prisma,
} from "@prisma/client";

export const PRODUCTION_NEON_HOST_ID = "ep-nameless-term-ams9a5e3";
/** Sample-validation child plan-078-phase1. Do not full-backfill. */
export const PHASE2_CHILD_HOST_ID = "ep-summer-field-amyzx79e";
/** Full rehearsal child plan-078-rehearsal (from latest production). */
export const PHASE2_REHEARSAL_HOST_ID = "ep-raspy-dust-amcmco9b";

export type Counts = Record<string, number>;

export type ConflictInput = {
  userId: string;
  field: string;
  chosenValue: string;
  rejectedValue: string;
  source: string;
};

export type QuarantineInput = {
  sourceTable: string;
  sourceId: string;
  field: string;
  payload: Prisma.InputJsonValue;
  reason: string;
};

export type StepContext = {
  prisma: PrismaClient;
  runId: string;
  conflicts: ConflictInput[];
  quarantine: QuarantineInput[];
};

const TIER_RANK: Record<string, number> = {
  StudentProfile: 0,
  ProgramMember: 1,
  HackathonParticipant: 2,
  WorkshopRegistration: 3,
};

export function assertChildBranch(): void {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (process.env.SEED_ALLOW_PRODUCTION === "true") {
    console.warn("SEED_ALLOW_PRODUCTION=true — production guard bypassed");
    return;
  }
  if (dbUrl.toLowerCase().includes(PRODUCTION_NEON_HOST_ID)) {
    throw new Error(
      `Refusing Phase 2: DATABASE_URL points at production (${PRODUCTION_NEON_HOST_ID}).`,
    );
  }
  const host = dbUrl.split("@")[1]?.split("/")[0] ?? "(unknown)";
  console.log(`Phase 2 targeting host: ${host}`);
}

/** Full unscoped backfill must target the rehearsal child, never sample or prod. */
export function assertNotSampleChildForFullRun(): void {
  if (isSampleMode()) return;
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (dbUrl.includes(PHASE2_CHILD_HOST_ID)) {
    throw new Error(
      "Refusing full Phase 2 on sample child plan-078-phase1 (ep-summer-field). Use plan-078-rehearsal.",
    );
  }
  if (!dbUrl.includes(PHASE2_REHEARSAL_HOST_ID)) {
    throw new Error(
      `Full Phase 2 must target rehearsal child ${PHASE2_REHEARSAL_HOST_ID} (plan-078-rehearsal).`,
    );
  }
}

export function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function clip(value: string | null | undefined, max = 500): string {
  if (value == null) return "";
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const SAMPLE_RUN_STEP = "phase2-sample-users";
/** First week of content is enough to prove the 2d/2e mapping. */
export const SAMPLE_DAY_CAP = 7;

/**
 * Catch-up is the idempotent transform itself: mutable legacy rows are upserted
 * on every run (Enrollment/ProgramMember.updatedAt, Submission.submittedAt).
 * Do not filter those models on createdAt-only. Append-only ledgers keep
 * stable ids + skipDuplicates so new events copy without duplicating.
 */

export function isSampleMode(): boolean {
  return process.env.PHASE2_SAMPLE === "1";
}

export function whereUserId(sample: string[] | null): { userId?: { in: string[] } } {
  return sample ? { userId: { in: sample } } : {};
}

export function sqlIn(qualifiedColumn: string, sample: string[] | null): string {
  if (!sample) return "TRUE";
  if (sample.length === 0) return "FALSE";
  const list = sample.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
  return `${qualifiedColumn} IN (${list})`;
}

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function readSampleIds(counts: Prisma.JsonValue | null | undefined): string[] | null {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return null;
  const ids = (counts as { userIds?: unknown }).userIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string")) {
    return null;
  }
  return ids;
}

async function pickSampleUserIds(prisma: PrismaClient): Promise<string[]> {
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (id) ids.add(id);
  };

  for (const domain of [Domain.SE, Domain.DS, Domain.AI, Domain.CLAUDE]) {
    const withSubs = await prisma.enrollment.findFirst({
      where: { domain, submissions: { some: {} } },
      orderBy: { startedAt: "desc" },
      select: { userId: true },
    });
    if (withSubs) add(withSubs.userId);
    else {
      const any = await prisma.enrollment.findFirst({
        where: { domain },
        select: { userId: true },
      });
      add(any?.userId);
    }
  }

  for (const status of [
    EnrollmentStatus.ACTIVE,
    EnrollmentStatus.COMPLETED,
    EnrollmentStatus.ABANDONED,
  ]) {
    add(
      (
        await prisma.enrollment.findFirst({
          where: { status },
          select: { userId: true },
        })
      )?.userId,
    );
  }

  const multi = await prisma.enrollment.groupBy({
    by: ["userId"],
    _count: { _all: true },
    having: { userId: { _count: { gt: 1 } } },
    orderBy: { userId: "asc" },
    take: 3,
  });
  for (const row of multi) add(row.userId);

  for (const status of [
    ProgramMemberStatus.APPLIED,
    ProgramMemberStatus.WAITLISTED,
    ProgramMemberStatus.ENROLLED,
    ProgramMemberStatus.COMPLETED,
    ProgramMemberStatus.DROPPED,
  ]) {
    add(
      (
        await prisma.programMember.findFirst({
          where: { status },
          select: { userId: true },
        })
      )?.userId,
    );
  }

  add((await prisma.certificate.findFirst({ select: { userId: true } }))?.userId);
  add((await prisma.studentProfile.findFirst({ select: { userId: true } }))?.userId);
  add(
    (
      await prisma.programMember.findFirst({
        where: { recruiterVisibilityConsentAt: { not: null } },
        select: { userId: true },
      })
    )?.userId,
  );
  add(
    (
      await prisma.programMember.findFirst({
        where: { recruiterVisibilityConsentAt: null },
        select: { userId: true },
      })
    )?.userId,
  );
  add(
    (
      await prisma.programMissionSubmission.findFirst({
        select: { member: { select: { userId: true } } },
      })
    )?.member.userId,
  );
  add(
    (
      await prisma.user.findFirst({
        where: { synergyPoints: { gt: 0 } },
        select: { id: true },
      })
    )?.id,
  );

  for (const type of ["SUBMISSION", "REDEEM", "REDEEM_REFUND", "COMMUNITY_GRANT", "REFERRAL"]) {
    add(
      (
        await prisma.synergyEvent.findFirst({
          where: { type },
          select: { userId: true },
        })
      )?.userId,
    );
  }
  add((await prisma.redemption.findFirst({ select: { userId: true } }))?.userId);

  const recruiters = await prisma.recruiterProfile.findMany({
    take: 3,
    select: { userId: true },
  });
  for (const r of recruiters) add(r.userId);

  const shortlists = await prisma.recruiterShortlistItem.findMany({
    take: 8,
    select: { recruiterUserId: true, member: { select: { userId: true } } },
  });
  for (const row of shortlists) {
    add(row.recruiterUserId);
    add(row.member.userId);
  }

  const reviews = await prisma.recruiterReview.findMany({
    take: 3,
    select: { userId: true },
  });
  for (const r of reviews) add(r.userId);

  add((await prisma.hackathonParticipant.findFirst({ select: { userId: true } }))?.userId);
  add((await prisma.workshopRegistration.findFirst({ select: { userId: true } }))?.userId);

  const emails = adminEmails();
  if (emails.length > 0) {
    const admins = await prisma.user.findMany({
      where: { email: { in: emails, mode: "insensitive" } },
      select: { id: true },
    });
    for (const a of admins) add(a.id);
  }

  return [...ids];
}

/** Null means process every user (full backfill). */
export async function resolveSampleUserIds(prisma: PrismaClient): Promise<string[] | null> {
  if (!isSampleMode()) return null;
  const existing = await prisma.migrationRun.findFirst({
    where: { step: SAMPLE_RUN_STEP, ok: true },
    orderBy: { startedAt: "desc" },
    select: { counts: true },
  });
  const reused = readSampleIds(existing?.counts) ?? [];
  const picked = await pickSampleUserIds(prisma);
  const merged = [...new Set([...reused, ...picked])];
  if (merged.length === 0) {
    throw new Error("PHASE2_SAMPLE=1 but no representative users were found");
  }
  const added = merged.length - reused.length;
  if (added > 0 || reused.length === 0) {
    await prisma.migrationRun.create({
      data: {
        step: SAMPLE_RUN_STEP,
        ok: true,
        finishedAt: new Date(),
        counts: { userIds: merged, n: merged.length, added },
      },
    });
    console.log(
      reused.length === 0
        ? `Phase 2 sample: selected ${merged.length} users`
        : `Phase 2 sample: expanded ${reused.length} → ${merged.length} users (+${added})`,
    );
  } else {
    console.log(`Phase 2 sample: reusing ${merged.length} users`);
  }
  return merged;
}

export type SampleCoverage = Record<string, boolean | number>;

/** What the current sample slice actually contains. Gaps are expected if prod has no such rows. */
export async function reportSampleCoverage(
  prisma: PrismaClient,
  sample: string[],
): Promise<SampleCoverage> {
  const inSample = { in: sample };
  const enrollmentByStatus = await prisma.enrollment.groupBy({
    by: ["status"],
    where: { userId: inSample },
    _count: { _all: true },
  });
  const memberByStatus = await prisma.programMember.groupBy({
    by: ["status"],
    where: { userId: inSample },
    _count: { _all: true },
  });
  const statusCount = (rows: Array<{ status: string; _count: { _all: number } }>, s: string) =>
    rows.find((r) => r.status === s)?._count._all ?? 0;
  const multi = await prisma.enrollment.groupBy({
    by: ["userId"],
    where: { userId: inSample },
    _count: { _all: true },
    having: { userId: { _count: { gt: 1 } } },
  });
  const coverage: SampleCoverage = {
    users: sample.length,
    challengeEnrollments: await prisma.enrollment.count({ where: { userId: inSample } }),
    enrollmentActive: statusCount(enrollmentByStatus, "ACTIVE"),
    enrollmentCompleted: statusCount(enrollmentByStatus, "COMPLETED"),
    enrollmentAbandoned: statusCount(enrollmentByStatus, "ABANDONED"),
    multiProgramCandidates: multi.length,
    programMembers: await prisma.programMember.count({ where: { userId: inSample } }),
    memberApplied: statusCount(memberByStatus, "APPLIED"),
    memberWaitlisted: statusCount(memberByStatus, "WAITLISTED"),
    memberEnrolled: statusCount(memberByStatus, "ENROLLED"),
    memberCompleted: statusCount(memberByStatus, "COMPLETED"),
    memberDropped: statusCount(memberByStatus, "DROPPED"),
    challengeSubmissions: await prisma.submission.count({ where: { userId: inSample } }),
    missionSubmissions: await prisma.programMissionSubmission.count({
      where: { member: { userId: inSample } },
    }),
    recruiterConsent: await prisma.programMember.count({
      where: { userId: inSample, recruiterVisibilityConsentAt: { not: null } },
    }),
    recruiterNoConsent: await prisma.programMember.count({
      where: { userId: inSample, recruiterVisibilityConsentAt: null },
    }),
    synergySubmission: await prisma.synergyEvent.count({
      where: { userId: inSample, type: "SUBMISSION" },
    }),
    synergyRedeem: await prisma.synergyEvent.count({
      where: { userId: inSample, type: "REDEEM" },
    }),
    synergyRefund: await prisma.synergyEvent.count({
      where: { userId: inSample, type: "REDEEM_REFUND" },
    }),
    synergyGrant: await prisma.synergyEvent.count({
      where: { userId: inSample, type: "COMMUNITY_GRANT" },
    }),
    certificates: await prisma.certificate.count({ where: { userId: inSample } }),
    recruiters: await prisma.recruiterProfile.count({ where: { userId: inSample } }),
    shortlistItems: await prisma.recruiterShortlistItem.count({
      where: {
        OR: [{ recruiterUserId: inSample }, { member: { userId: inSample } }],
      },
    }),
    recruiterReviews: await prisma.recruiterReview.count({ where: { userId: inSample } }),
  };
  console.log("Sample coverage:", JSON.stringify(coverage));
  return coverage;
}

export function pickNonNull<T>(
  facts: Array<{ value: T | null | undefined; source: string; at: Date }>,
): { value: T | null; source: string | null; rejected: Array<{ value: T; source: string }> } {
  const present = facts
    .filter((f): f is { value: T; source: string; at: Date } => f.value != null && f.value !== "")
    .sort((a, b) => {
      const tr = (TIER_RANK[a.source] ?? 99) - (TIER_RANK[b.source] ?? 99);
      if (tr !== 0) return tr;
      return b.at.getTime() - a.at.getTime();
    });
  if (present.length === 0) return { value: null, source: null, rejected: [] };
  const winner = present[0]!;
  const rejected = present.slice(1).filter((f) => String(f.value) !== String(winner.value));
  return {
    value: winner.value,
    source: winner.source,
    rejected: rejected.map((f) => ({ value: f.value, source: f.source })),
  };
}

export async function chunked<T>(
  items: T[],
  size: number,
  fn: (chunk: T[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size));
    if (i > 0 && i % (size * 10) === 0) {
      console.log(`  … ${Math.min(i + size, items.length)}/${items.length}`);
    }
  }
}

export async function runStep(
  prisma: PrismaClient,
  step: string,
  fn: (ctx: StepContext) => Promise<Counts>,
): Promise<void> {
  const run = await prisma.migrationRun.create({
    data: { step },
    select: { id: true },
  });
  const ctx: StepContext = {
    prisma,
    runId: run.id,
    conflicts: [],
    quarantine: [],
  };
  try {
    const counts = await fn(ctx);
    if (ctx.conflicts.length > 0) {
      await chunked(ctx.conflicts, 200, async (chunk) => {
        await prisma.migrationConflict.createMany({
          data: chunk.map((c) => ({ ...c, runId: run.id })),
        });
      });
    }
    if (ctx.quarantine.length > 0) {
      await chunked(ctx.quarantine, 100, async (chunk) => {
        await prisma.migrationQuarantine.createMany({
          data: chunk.map((q) => ({ ...q, runId: run.id })),
        });
      });
    }
    await prisma.migrationRun.update({
      where: { id: run.id },
      data: {
        ok: true,
        finishedAt: new Date(),
        counts: {
          ...counts,
          conflicts: ctx.conflicts.length,
          quarantine: ctx.quarantine.length,
        },
      },
    });
    console.log(
      `${step} ok`,
      counts,
      `conflicts=${ctx.conflicts.length}`,
      `quarantine=${ctx.quarantine.length}`,
    );
  } catch (err) {
    await prisma.migrationRun.update({
      where: { id: run.id },
      data: {
        ok: false,
        finishedAt: new Date(),
        error: err instanceof Error ? err.stack ?? err.message : String(err),
      },
    });
    throw err;
  }
}

export function logPick(
  ctx: StepContext,
  userId: string,
  field: string,
  pick: { value: unknown; source: string | null; rejected: Array<{ value: unknown; source: string }> },
): void {
  for (const r of pick.rejected) {
    ctx.conflicts.push({
      userId,
      field,
      chosenValue: clip(String(pick.value)),
      rejectedValue: clip(String(r.value)),
      source: `${pick.source} > ${r.source}`,
    });
  }
}

export const CATEGORY_BY_DOMAIN: Record<string, string> = {
  SE: "software-engineering",
  DS: "data-science",
  AI: "ai-engineering",
  CLAUDE: "claude",
};

export const PROGRAM_SLUG_BY_DOMAIN: Record<string, string> = {
  SE: "software-engineering-challenge",
  DS: "data-science-challenge",
  AI: "ai-engineering-challenge",
  CLAUDE: "claude-challenge",
};

export function cohortSlugForDomain(domain: string): string {
  return `legacy-${domain.toLowerCase()}`;
}

export function peIdForEnrollment(enrollmentId: string): string {
  return `pe_enr_${enrollmentId}`;
}

export function peIdForMember(memberId: string): string {
  return `pe_pm_${memberId}`;
}

export function activityIdForDailyTask(id: string): string {
  return `act_dt_${id}`;
}

export function activityIdForQuiz(id: string): string {
  return `act_quiz_${id}`;
}

export function activityIdForProgramDay(id: string): string {
  return `act_pd_${id}`;
}

export function activityIdForConceptQuiz(dayId: string): string {
  return `act_cq_${dayId}`;
}

export function activityIdForVideo(id: string): string {
  return `act_vid_${id}`;
}

export function activityIdForExercise(id: string): string {
  return `act_ex_${id}`;
}

export function activityIdForInterview(versionId: string): string {
  return `act_iv_${versionId}`;
}

export function activityIdForEntry(versionId: string): string {
  return `act_entry_${versionId}`;
}

export function attemptIdForSubmission(id: string): string {
  return `aa_sub_${id}`;
}

export function attemptIdForQuizAttempt(id: string): string {
  return `aa_qa_${id}`;
}

export function attemptIdForMission(id: string): string {
  return `aa_ms_${id}`;
}

export function attemptIdForProject(id: string): string {
  return `aa_proj_${id}`;
}

export function attemptIdForInterview(id: string): string {
  return `aa_iv_${id}`;
}

export function attemptIdForEntry(id: string): string {
  return `aa_entry_${id}`;
}
