"use server";

import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { getInterviewSignals } from "@/features/interview/read-model";
import { getAtRiskMembers } from "@/features/program/commits";
import { getCohortCalendarDay } from "@/features/program/progression";
import { getAdminProgramCohort } from "@/features/program/admin";
import { cohortIdSchema } from "@/lib/validations/program";

export async function exportProgramMembersAction(input: unknown) {
  await requireAdmin();
  const parsed = cohortIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Invalid cohort." };

  const members = await prisma.programMember.findMany({
    where: {
      cohortId: parsed.data.cohortId,
      status: { in: ["ENROLLED", "COMPLETED"] },
    },
    orderBy: [{ totalScore: "desc" }, { fullName: "asc" }],
    select: {
      fullName: true,
      jobRole: true,
      company: true,
      yearsExperience: true,
      status: true,
      missionPoints: true,
      conceptPoints: true,
      commitPoints: true,
      projectPoints: true,
      totalScore: true,
      cleanPassCount: true,
      highestUnlockedDay: true,
      user: { select: { email: true } },
    },
  });

  return {
    ok: true as const,
    data: members.map((m) => ({
      name: m.fullName,
      email: m.user.email,
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
  await requireAdmin();
  const parsed = cohortIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Invalid cohort." };

  const cohort = await prisma.programCohort.findUnique({
    where: { id: parsed.data.cohortId },
    select: { startsAt: true },
  });
  if (!cohort) return { ok: false as const, message: "Cohort not found." };

  const cohortDay = getCohortCalendarDay(cohort);
  const atRisk = await getAtRiskMembers(parsed.data.cohortId);
  const members = await prisma.programMember.findMany({
    where: { id: { in: atRisk.map((a) => a.memberId) } },
    select: {
      id: true,
      fullName: true,
      company: true,
      highestUnlockedDay: true,
      user: { select: { email: true } },
    },
  });
  const byId = new Map(members.map((m) => [m.id, m]));

  return {
    ok: true as const,
    data: atRisk.map((a) => {
      const m = byId.get(a.memberId);
      return {
        name: a.fullName,
        email: m?.user.email ?? "",
        company: m?.company ?? "",
        reasons: a.reasons.join("; "),
        behindBy: m ? Math.max(0, cohortDay - m.highestUnlockedDay) : 0,
      };
    }),
  };
}

export async function exportProgramRecruitersAction() {
  await requireAdmin();

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
  await requireAdmin();
  const parsed = cohortIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Invalid cohort." };

  const cohort = await getAdminProgramCohort();
  const cohortId = parsed.data.cohortId;

  const members = await prisma.programMember.findMany({
    where: { cohortId, status: { in: ["ENROLLED", "COMPLETED"] } },
    select: {
      id: true,
      fullName: true,
      company: true,
      user: { select: { email: true } },
    },
    orderBy: { fullName: "asc" },
  });

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
          email: m.user.email,
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
