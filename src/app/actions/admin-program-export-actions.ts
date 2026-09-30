"use server";

import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { assertRateLimit } from "@/lib/rate-limit";
import { getInterviewSignals } from "@/features/interview/read-model";
import { getAtRiskMembers } from "@/features/program/commits";
import { getMemberCalendarDay } from "@/features/program/progression";
import { getAdminProgramCohort } from "@/features/program/admin";
import { cohortIdSchema } from "@/lib/validations/program";
import {
  compareProgramScoreRows,
  listAiCohortMemberships,
  listCanonicalProgramMemberIds,
} from "@/repositories/program-state";
import { ProgramMemberStatus } from "@prisma/client";

async function requireAdminProgramExport() {
  const admin = await requireAdmin();
  const limited = await assertRateLimit({
    bucket: "EXPORT",
    subjectId: admin.userId,
  });
  if (!limited.ok) return limited;
  return { ok: true as const, admin };
}

export async function exportProgramMembersAction(input: unknown) {
  const gate = await requireAdminProgramExport();
  if (!gate.ok) return gate;
  const parsed = cohortIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Invalid cohort." };

  const members = await listAiCohortMemberships({
    programCohortId: parsed.data.cohortId,
    statuses: [ProgramMemberStatus.ENROLLED, ProgramMemberStatus.COMPLETED],
  });
  members.sort(compareProgramScoreRows);
  const users = await prisma.user.findMany({
    where: { id: { in: members.map((m) => m.userId) } },
    select: { id: true, email: true },
  });
  const emailByUser = new Map(users.map((u) => [u.id, u.email]));

  return {
    ok: true as const,
    data: members.map((m) => ({
      name: m.fullName,
      email: emailByUser.get(m.userId) ?? "",
      role: m.jobRole,
      company: m.company,
      yearsExperience: m.yearsExperience,
      status: m.status,
      totalScore: m.totalScore,
      missionPoints: m.missionPoints,
      conceptPoints: m.conceptPoints,
      commitPoints: m.commitPoints,
      projectPoints: m.projectPoints,
      cleanPassCount: m.cleanPassCount,
      highestUnlockedDay: m.highestUnlockedDay,
    })),
  };
}

export async function exportProgramAtRiskAction(input: unknown) {
  const gate = await requireAdminProgramExport();
  if (!gate.ok) return gate;
  const parsed = cohortIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Invalid cohort." };

  const atRisk = await getAtRiskMembers(parsed.data.cohortId);
  const members = await listAiCohortMemberships({
    memberIds: atRisk.map((a) => a.memberId),
  });
  const users = await prisma.user.findMany({
    where: { id: { in: members.map((m) => m.userId) } },
    select: { id: true, email: true },
  });
  const byId = new Map(members.map((m) => [m.id, m]));
  const emailByUser = new Map(users.map((u) => [u.id, u.email]));

  return {
    ok: true as const,
    data: atRisk.map((a) => {
      const m = byId.get(a.memberId);
      return {
        name: a.fullName,
        email: m ? (emailByUser.get(m.userId) ?? "") : "",
        company: m?.company ?? "",
        reasons: a.reasons.join("; "),
        // Each member is measured against their own calendar (plan 157).
        behindBy: m
          ? Math.max(0, getMemberCalendarDay(m) - m.highestUnlockedDay)
          : 0,
      };
    }),
  };
}

export async function exportProgramRecruitersAction() {
  const gate = await requireAdminProgramExport();
  if (!gate.ok) return gate;

  const recruiters = await prisma.recruiterProfile.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      fullName: true,
      company: true,
      phone: true,
      approved: true,
      approvedAt: true,
      createdAt: true,
      user: { select: { email: true } },
    },
  });

  return {
    ok: true as const,
    data: recruiters.map((r) => ({
      name: r.fullName,
      email: r.user.email,
      company: r.company,
      phone: r.phone ?? "",
      approved: r.approved ? "yes" : "no",
      approvedAt: r.approvedAt?.toISOString() ?? "",
      appliedAt: r.createdAt.toISOString(),
    })),
  };
}

export async function exportProgramInterviewsAction(input: unknown) {
  const gate = await requireAdminProgramExport();
  if (!gate.ok) return gate;
  const parsed = cohortIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Invalid cohort." };

  const cohort = await getAdminProgramCohort();
  const cohortId = parsed.data.cohortId;

  const members = await listAiCohortMemberships({
    programCohortId: cohortId,
    statuses: [ProgramMemberStatus.ENROLLED, ProgramMemberStatus.COMPLETED],
  });
  members.sort((a, b) => a.fullName.localeCompare(b.fullName));
  const users = await prisma.user.findMany({
    where: { id: { in: members.map((m) => m.userId) } },
    select: { id: true, email: true },
  });
  const emailByUser = new Map(users.map((u) => [u.id, u.email]));

  // Resolved via the interview read model (DAY_31 -> DAY_15 -> legacy).
  // Column names are deliberately unchanged so anything parsing this export
  // keeps working; comm/tech/problem now carry the new competency values.
  const signals = await getInterviewSignals(members.map((m) => m.id));

  return {
    ok: true as const,
    data: members
      .filter((m) => signals.has(m.id))
      .map((m) => {
        const s = signals.get(m.id)!;
        return {
          name: m.fullName,
          email: emailByUser.get(m.userId) ?? "",
          company: m.company,
          status: s.status,
          durationSec: s.durationSec ?? "",
          commScore: s.communicationScore ?? "",
          techScore: s.technicalDepthScore ?? "",
          problemScore: s.problemSolvingScore ?? "",
          overallScore: s.overallScore ?? "",
          summary: s.summary ?? "",
          evaluatedAt: s.evaluatedAt?.toISOString() ?? "",
        };
      }),
  };
}
