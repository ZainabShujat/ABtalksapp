import "server-only";

import { prisma } from "@/lib/db";
import { isUsablePasswordHash } from "@/lib/password";
import { getCreditBalance } from "@/repositories/credits";
import { candidatePublicId } from "@/features/hire/public-id";
import { searchDeliveries } from "@/features/notification/delivery-diagnosis";
import type { DeliveryRow } from "@/features/notification/delivery-diagnosis";
import {
  CONTACT_UNLOCK_COST_KEY,
  LOW_BALANCE_THRESHOLD_KEY,
  STARTING_GRANT_KEY,
  VERY_LOW_BALANCE_THRESHOLD_KEY,
  getIntConfig,
} from "@/lib/platform-config";
import type {
  CreditTransactionType,
  RecruiterAssessmentStatus,
  TalentEngagementStatus,
} from "@prisma/client";

/**
 * T-266 — one page that tells support the truth about a recruiter.
 *
 * Assembled the same way as `get-admin-candidate-detail.ts`: one loader that
 * calls the feature each section belongs to, so the admin page is a render and
 * not a second implementation of anything. Credits come from the ledger through
 * `getCreditBalance`, deliveries through the Delivery Log's own search, the
 * unlock price from `PlatformConfig` — the same numbers the recruiter is
 * actually subject to.
 *
 * Read-only. Nothing on this page writes, and nothing provisions: a support
 * page that created a workspace as a side effect of being opened would make
 * "no workspace yet" impossible to see.
 *
 * `server-only`: it reads a recruiter's balance, their candidates and their
 * delivery failures.
 */

export type RecruiterAccountState = "ACTIVE" | "DISABLED" | "DELETED";

export type AdminRecruiterDetail = {
  account: {
    userId: string;
    name: string;
    email: string;
    role: string;
    emailVerified: Date | null;
    createdAt: Date;
    disabledAt: Date | null;
    disabledReason: string | null;
    deletedAt: Date | null;
    sessionInvalidatedAt: Date | null;
    state: RecruiterAccountState;
    /** Which providers this account can sign in with. */
    signInProviders: string[];
    /** Has a usable (hashed) password — never the password itself. */
    hasPassword: boolean;
    /** Unexpired NextAuth sessions. */
    liveSessions: number;
    lastSessionExpires: Date | null;
  };
  recruiter: {
    profileId: string;
    fullName: string;
    company: string;
    phone: string | null;
    approved: boolean;
    approvedAt: Date | null;
    setupCompletedAt: Date | null;
    createdAt: Date;
  } | null;
  company: {
    organizationId: string;
    name: string;
    slug: string;
    websiteUrl: string | null;
    industry: string | null;
    sizeBucket: string | null;
    location: string | null;
    isVerified: boolean;
    memberRole: string;
    memberStatus: string;
    joinedAt: Date | null;
  } | null;
  /**
   * What the platform charges and warns at. There are no plan tiers yet — the
   * limits in force are these `PlatformConfig` numbers plus the balance.
   */
  plan: {
    unlockCostMinor: number;
    startingGrantMinor: number;
    lowBalanceMinor: number;
    veryLowBalanceMinor: number;
    /** `checkPlanLimit`'s answer today. Not consulted by the unlock path. */
    entitlementStub: boolean;
  };
  credits: {
    balanceMinor: number;
    earnedMinor: number;
    spentMinor: number;
    transactionCount: number;
  } | null;
  ledger: {
    id: string;
    amount: number;
    type: CreditTransactionType;
    balanceAfter: number;
    reason: string;
    candidateLabel: string | null;
    createdAt: Date;
  }[];
  unlocks: {
    id: string;
    candidateUserId: string | null;
    candidatePublicId: string;
    candidateName: string | null;
    status: TalentEngagementStatus;
    createdAt: Date;
    decidedAt: Date | null;
  }[];
  projects: {
    id: string;
    name: string;
    status: string;
    sessionCount: number;
    matchCount: number;
    archivedAt: Date | null;
    createdAt: Date;
  }[];
  jobs: {
    id: string;
    title: string;
    status: string;
    isOpen: boolean;
    applicationCount: number;
    createdAt: Date;
  }[];
  assessments: {
    id: string;
    title: string;
    status: RecruiterAssessmentStatus;
    questionCount: number;
    assignedCount: number;
    submittedCount: number;
    updatedAt: Date;
  }[];
  outreach: {
    id: string;
    candidateUserId: string;
    candidatePublicId: string;
    subject: string;
    messageCount: number;
    failedEmails: number;
    lastMessageAt: Date;
    lastMessageBy: string;
  }[];
  /** Everything sent to this recruiter's address, newest first. */
  deliveries: DeliveryRow[];
  /** The failures out of that list, plus failed outreach emails. */
  failures: {
    id: string;
    kind: "DELIVERY" | "OUTREACH_EMAIL";
    at: Date;
    label: string;
    reason: string;
  }[];
  /** Candidates this recruiter has any relationship with — T-267's picker. */
  relatedCandidates: {
    userId: string;
    publicId: string;
    name: string;
    /** Why they are on this list, e.g. "Unlocked", "Applicant". */
    relations: string[];
  }[];
};

function accountState(user: {
  deletedAt: Date | null;
  disabledAt: Date | null;
}): RecruiterAccountState {
  if (user.deletedAt) return "DELETED";
  if (user.disabledAt) return "DISABLED";
  return "ACTIVE";
}

export async function getAdminRecruiterDetail(
  userId: string,
): Promise<AdminRecruiterDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      password: true,
      emailVerified: true,
      createdAt: true,
      disabledAt: true,
      disabledReason: true,
      deletedAt: true,
      sessionInvalidatedAt: true,
      recruiterProfile: {
        select: {
          id: true,
          fullName: true,
          company: true,
          phone: true,
          approved: true,
          approvedAt: true,
          setupCompletedAt: true,
          createdAt: true,
        },
      },
      accounts: { select: { provider: true } },
      sessions: {
        where: { expires: { gt: new Date() } },
        orderBy: { expires: "desc" },
        select: { expires: true },
      },
    },
  });
  if (!user) return null;

  const membership = await prisma.organizationMember.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      status: true,
      joinedAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          websiteUrl: true,
          industry: true,
          sizeBucket: true,
          location: true,
          isVerified: true,
        },
      },
    },
  });
  const organizationId = membership?.organization.id ?? null;

  const [
    unlockCostMinor,
    startingGrantMinor,
    lowBalanceMinor,
    veryLowBalanceMinor,
  ] = await Promise.all([
    getIntConfig(CONTACT_UNLOCK_COST_KEY),
    getIntConfig(STARTING_GRANT_KEY),
    getIntConfig(LOW_BALANCE_THRESHOLD_KEY),
    getIntConfig(VERY_LOW_BALANCE_THRESHOLD_KEY),
  ]);

  const [
    ledgerRows,
    earned,
    spent,
    txCount,
    engagements,
    projects,
    jobs,
    assessments,
    threads,
    deliveries,
  ] = await Promise.all([
    organizationId
      ? prisma.creditTransaction.findMany({
          where: { organizationId },
          orderBy: { seq: "desc" },
          take: 25,
          select: {
            id: true,
            amount: true,
            type: true,
            balanceAfter: true,
            reason: true,
            candidateUserId: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    organizationId
      ? prisma.creditTransaction.aggregate({
          where: { organizationId, amount: { gt: 0 } },
          _sum: { amount: true },
        })
      : Promise.resolve(null),
    organizationId
      ? prisma.creditTransaction.aggregate({
          where: { organizationId, amount: { lt: 0 } },
          _sum: { amount: true },
        })
      : Promise.resolve(null),
    organizationId
      ? prisma.creditTransaction.count({ where: { organizationId } })
      : Promise.resolve(0),
    prisma.talentEngagementRequest.findMany({
      where: { recruiterUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        candidateUserId: true,
        candidatePublicId: true,
        status: true,
        createdAt: true,
        decidedAt: true,
        candidate: {
          select: {
            name: true,
            candidateProfile: { select: { fullName: true } },
          },
        },
      },
    }),
    prisma.talentRequest.findMany({
      where: { recruiterUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        name: true,
        title: true,
        status: true,
        archivedAt: true,
        createdAt: true,
        _count: { select: { sessions: true, matches: true } },
      },
    }),
    prisma.job.findMany({
      where: { recruiterId: userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        title: true,
        status: true,
        isOpen: true,
        createdAt: true,
        _count: { select: { applications: true } },
      },
    }),
    organizationId
      ? prisma.recruiterAssessment.findMany({
          where: { organizationId },
          orderBy: { updatedAt: "desc" },
          take: 25,
          select: {
            id: true,
            title: true,
            status: true,
            updatedAt: true,
            _count: { select: { questions: true, assignments: true } },
            assignments: { select: { status: true } },
          },
        })
      : Promise.resolve([]),
    prisma.outreachThread.findMany({
      where: { recruiterUserId: userId },
      orderBy: { lastMessageAt: "desc" },
      take: 25,
      select: {
        id: true,
        candidateUserId: true,
        subject: true,
        lastMessageAt: true,
        lastMessageBy: true,
        _count: { select: { messages: true } },
        messages: {
          where: { emailStatus: "FAILED" },
          orderBy: { createdAt: "desc" },
          select: { id: true, createdAt: true, emailFailureReason: true },
        },
      },
    }),
    user.email
      ? searchDeliveries({ recipient: user.email, limit: 25 })
      : Promise.resolve([] as DeliveryRow[]),
  ]);

  const balanceMinor = organizationId
    ? await getCreditBalance(organizationId)
    : null;

  // One lookup for every candidate named anywhere on the page, so the ledger,
  // the unlock list and the outreach list all print the same label.
  const candidateIds = new Set<string>();
  for (const row of ledgerRows) if (row.candidateUserId) candidateIds.add(row.candidateUserId);
  for (const e of engagements) if (e.candidateUserId) candidateIds.add(e.candidateUserId);
  for (const t of threads) candidateIds.add(t.candidateUserId);
  const applicants = await prisma.jobApplication.findMany({
    where: { job: { recruiterId: userId } },
    take: 50,
    select: { userId: true },
  });
  for (const a of applicants) candidateIds.add(a.userId);

  const candidateRows =
    candidateIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: [...candidateIds] } },
          select: {
            id: true,
            name: true,
            candidateProfile: { select: { fullName: true } },
          },
        })
      : [];
  const nameById = new Map(
    candidateRows.map((c) => [
      c.id,
      c.candidateProfile?.fullName?.trim() || c.name?.trim() || "Unnamed",
    ]),
  );

  const relations = new Map<string, Set<string>>();
  const addRelation = (id: string, label: string) => {
    const set = relations.get(id) ?? new Set<string>();
    set.add(label);
    relations.set(id, set);
  };
  for (const e of engagements) {
    if (!e.candidateUserId) continue;
    addRelation(
      e.candidateUserId,
      e.status === "CONTACT_SHARED" ? "Unlocked" : `Engagement ${e.status}`,
    );
  }
  for (const t of threads) addRelation(t.candidateUserId, "Outreach");
  for (const a of applicants) addRelation(a.userId, "Applicant");

  const failures: AdminRecruiterDetail["failures"] = [];
  for (const d of deliveries) {
    if (d.state !== "failed") continue;
    failures.push({
      id: d.id,
      kind: "DELIVERY",
      at: new Date(d.createdAt),
      label: `${d.channel} · ${d.source === "notification" ? d.eventType : d.kind}`,
      reason: d.failureReason ?? "No reason recorded on the delivery row.",
    });
  }
  for (const t of threads) {
    for (const m of t.messages) {
      failures.push({
        id: m.id,
        kind: "OUTREACH_EMAIL",
        at: m.createdAt,
        label: `Outreach to ${candidatePublicId(t.candidateUserId)}`,
        reason: m.emailFailureReason ?? "No reason recorded on the message row.",
      });
    }
  }
  failures.sort((a, b) => b.at.getTime() - a.at.getTime());

  return {
    account: {
      userId: user.id,
      name: user.name ?? "Unnamed",
      email: user.email ?? "",
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      disabledAt: user.disabledAt,
      disabledReason: user.disabledReason,
      deletedAt: user.deletedAt,
      sessionInvalidatedAt: user.sessionInvalidatedAt,
      state: accountState(user),
      signInProviders: [...new Set(user.accounts.map((a) => a.provider))],
      hasPassword: isUsablePasswordHash(user.password),
      liveSessions: user.sessions.length,
      lastSessionExpires: user.sessions[0]?.expires ?? null,
    },
    recruiter: user.recruiterProfile
      ? { ...user.recruiterProfile, profileId: user.recruiterProfile.id }
      : null,
    company: membership
      ? {
          organizationId: membership.organization.id,
          name: membership.organization.name,
          slug: membership.organization.slug,
          websiteUrl: membership.organization.websiteUrl,
          industry: membership.organization.industry,
          sizeBucket: membership.organization.sizeBucket,
          location: membership.organization.location,
          isVerified: membership.organization.isVerified,
          memberRole: membership.role,
          memberStatus: membership.status,
          joinedAt: membership.joinedAt,
        }
      : null,
    plan: {
      unlockCostMinor,
      startingGrantMinor,
      lowBalanceMinor,
      veryLowBalanceMinor,
      entitlementStub: true,
    },
    credits:
      balanceMinor === null
        ? null
        : {
            balanceMinor,
            earnedMinor: earned?._sum.amount ?? 0,
            spentMinor: Math.abs(spent?._sum.amount ?? 0),
            transactionCount: txCount,
          },
    ledger: ledgerRows.map((r) => ({
      id: r.id,
      amount: r.amount,
      type: r.type,
      balanceAfter: r.balanceAfter,
      reason: r.reason,
      candidateLabel: r.candidateUserId
        ? `${candidatePublicId(r.candidateUserId)} · ${nameById.get(r.candidateUserId) ?? "Unnamed"}`
        : null,
      createdAt: r.createdAt,
    })),
    unlocks: engagements.map((e) => ({
      id: e.id,
      candidateUserId: e.candidateUserId,
      candidatePublicId: e.candidatePublicId,
      candidateName:
        e.candidate?.candidateProfile?.fullName?.trim() ||
        e.candidate?.name?.trim() ||
        null,
      status: e.status,
      createdAt: e.createdAt,
      decidedAt: e.decidedAt,
    })),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name?.trim() || p.title,
      status: p.status,
      sessionCount: p._count.sessions,
      matchCount: p._count.matches,
      archivedAt: p.archivedAt,
      createdAt: p.createdAt,
    })),
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      isOpen: j.isOpen,
      applicationCount: j._count.applications,
      createdAt: j.createdAt,
    })),
    assessments: assessments.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      questionCount: a._count.questions,
      assignedCount: a._count.assignments,
      submittedCount: a.assignments.filter((x) => x.status === "SUBMITTED").length,
      updatedAt: a.updatedAt,
    })),
    outreach: threads.map((t) => ({
      id: t.id,
      candidateUserId: t.candidateUserId,
      candidatePublicId: candidatePublicId(t.candidateUserId),
      subject: t.subject,
      messageCount: t._count.messages,
      failedEmails: t.messages.length,
      lastMessageAt: t.lastMessageAt,
      lastMessageBy: t.lastMessageBy,
    })),
    deliveries,
    failures: failures.slice(0, 15),
    relatedCandidates: [...relations.entries()]
      .map(([id, set]) => ({
        userId: id,
        publicId: candidatePublicId(id),
        name: nameById.get(id) ?? "Unnamed",
        relations: [...set],
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
