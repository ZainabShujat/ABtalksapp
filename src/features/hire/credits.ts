import "server-only";

import { requireRecruiterWorkspace } from "@/features/recruiter-workspace/workspace";
import { prisma } from "@/lib/db";
import {
  getCreditBalance,
  listCreditTransactions,
  summarizeCreditLedger,
  type CreditLedgerEntry,
} from "@/repositories/credits";
import {
  CONTACT_UNLOCK_COST_KEY,
  CREDITS_CURRENCY_KEY,
  LOW_BALANCE_THRESHOLD_KEY,
  VERY_LOW_BALANCE_THRESHOLD_KEY,
  getIntConfig,
  getStringConfig,
} from "@/lib/platform-config";
import {
  creditLevel,
  type CreditLevel,
  type CreditThresholds,
} from "@/lib/credits-format";

/**
 * What product code calls to ask about a recruiter's credits.
 *
 * Takes no ids, for the same reason `requireRecruiterWorkspace` takes none: the
 * workspace comes from the session, on the server, so the whole class of
 * "recruiter A passes recruiter B's organization id" bugs is closed by the
 * signature rather than by a check somebody has to remember to write.
 *
 * ## These are reads. They do not create money.
 *
 * There is no lazy "grant on first read" here, and there should never be one.
 * The onboarding grant happens where a workspace is created —
 * `provisionRecruiterIdentity` and the setup action — which is deterministic,
 * auditable, and happens exactly once. A read that quietly mints credits would
 * make "how much does this recruiter have" a mutation, put a write inside a
 * Server Component render, and give the ledger a grant site not tied to
 * anything a person did. Workspaces created before T-228 shipped are granted by
 * `npm run db:backfill:credit-grants -- --apply`, which is a required deploy
 * step, not an optional one.
 */

export type WorkspaceCredits = {
  /** USD minor units. Divide by 100 for dollars; never do that in a query. */
  balanceMinor: number;
  currency: string;
  /**
   * What one contact unlock costs. Surfaced here so a cost preview has one
   * place to read it; the unlock re-reads it before spending.
   */
  unlockCostMinor: number;
  /** T-231 warning thresholds, from `PlatformConfig`. */
  thresholds: CreditThresholds;
  level: CreditLevel;
};

export type WorkspaceCreditsResult =
  | { ok: true; data: WorkspaceCredits }
  | { ok: false; message: string };

export async function getWorkspaceCredits(): Promise<WorkspaceCreditsResult> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) return { ok: false, message: workspace.message };

  const [balanceMinor, currency, unlockCostMinor, lowMinor, veryLowMinor] =
    await Promise.all([
      getCreditBalance(workspace.data.organizationId),
      getStringConfig(CREDITS_CURRENCY_KEY),
      getIntConfig(CONTACT_UNLOCK_COST_KEY),
      getIntConfig(LOW_BALANCE_THRESHOLD_KEY),
      getIntConfig(VERY_LOW_BALANCE_THRESHOLD_KEY),
    ]);
  const thresholds = { lowMinor, veryLowMinor };

  return {
    ok: true,
    data: {
      balanceMinor,
      currency,
      unlockCostMinor,
      thresholds,
      level: creditLevel(balanceMinor, thresholds, unlockCostMinor),
    },
  };
}

export type WorkspaceLedgerResult =
  | { ok: true; data: CreditLedgerEntry[] }
  | { ok: false; message: string };

export async function getWorkspaceCreditHistory(
  opts?: { limit?: number; beforeSeq?: string },
): Promise<WorkspaceLedgerResult> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) return { ok: false, message: workspace.message };

  return {
    ok: true,
    data: await listCreditTransactions(workspace.data.organizationId, opts),
  };
}

/** One ledger row as the recruiter reads it on `/hire/credits` (T-231). */
export type CreditHistoryRow = {
  id: string;
  amountMinor: number;
  balanceAfterMinor: number;
  type: CreditLedgerEntry["type"];
  reason: string;
  /** ISO — crosses to the client. */
  createdAt: string;
  /**
   * Who an unlock was for. The candidate's name only while this recruiter
   * still holds contact access; otherwise their public id, which is what the
   * unlock dialog showed when the money was spent.
   */
  candidateLabel: string | null;
};

export type WorkspaceCreditOverview = WorkspaceCredits & {
  grantedMinor: number;
  spentMinor: number;
  transactionCount: number;
  history: CreditHistoryRow[];
};

export type WorkspaceCreditOverviewResult =
  | { ok: true; data: WorkspaceCreditOverview }
  | { ok: false; message: string };

/** The history page caps at the repository's maximum page; T-231 has no pagination yet. */
const HISTORY_LIMIT = 200;

export async function getWorkspaceCreditOverview(): Promise<WorkspaceCreditOverviewResult> {
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) return { ok: false, message: workspace.message };
  const { organizationId, userId } = workspace.data;

  const [credits, summary, entries] = await Promise.all([
    getWorkspaceCredits(),
    summarizeCreditLedger(organizationId),
    listCreditTransactions(organizationId, { limit: HISTORY_LIMIT }),
  ]);
  if (!credits.ok) return credits;

  const candidateIds = [
    ...new Set(entries.map((e) => e.candidateUserId).filter((id): id is string => !!id)),
  ];
  const engagements =
    candidateIds.length > 0
      ? await prisma.talentEngagementRequest.findMany({
          where: { recruiterUserId: userId, candidateUserId: { in: candidateIds } },
          orderBy: { createdAt: "desc" },
          select: {
            candidateUserId: true,
            candidatePublicId: true,
            status: true,
            candidate: { select: { name: true } },
          },
        })
      : [];
  const labels = new Map<string, string>();
  for (const e of engagements) {
    if (labels.has(e.candidateUserId)) continue;
    const name = e.status === "CONTACT_SHARED" ? e.candidate.name?.trim() : null;
    labels.set(e.candidateUserId, name || e.candidatePublicId);
  }

  return {
    ok: true,
    data: {
      ...credits.data,
      ...summary,
      history: entries.map((e) => ({
        id: e.id,
        amountMinor: e.amount,
        balanceAfterMinor: e.balanceAfter,
        type: e.type,
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
        candidateLabel: e.candidateUserId
          ? (labels.get(e.candidateUserId) ?? "Candidate")
          : null,
      })),
    },
  };
}

/**
 * The price of one contact unlock.
 *
 * Never zero: a missing or unreadable configuration row resolves to the
 * registry default (see `lib/platform-config.ts`), because the one answer a
 * price must never fall back to is "free".
 */
export async function contactUnlockCostMinor(): Promise<number> {
  return getIntConfig(CONTACT_UNLOCK_COST_KEY);
}

/**
 * Re-exported so a server surface that already imports the reads does not have
 * to reach for a second module to render what it just read. The definition
 * lives in `lib/credits-format.ts`, outside `server-only`, because a Client
 * Component needs it too.
 */
export { formatCreditsMinor } from "@/lib/credits-format";
