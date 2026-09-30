import { prisma } from "@/lib/db";
import { loadRecruiterIdentities } from "@/repositories/talent";
import type {
  ApplicantPublicIdentity,
  ApplicantStoreRow,
  ApplicationStore,
  JobRow,
  JobStore,
} from "./service";

const SELECT = {
  id: true,
  title: true,
  company: true,
  description: true,
  location: true,
  workMode: true,
  type: true,
  skills: true,
  minExperience: true,
  status: true,
  isOpen: true,
  recruiterId: true,
  createdByAdminId: true,
  publishedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  applyExternalUrl: true,
} as const;

export function prismaJobStore(): JobStore {
  return {
    async create({ data }): Promise<JobRow> {
      return prisma.job.create({ data, select: SELECT });
    },
    async findById(id: string): Promise<JobRow | null> {
      return prisma.job.findUnique({ where: { id }, select: SELECT });
    },
    async update(id: string, patch): Promise<JobRow> {
      return prisma.job.update({ where: { id }, data: patch, select: SELECT });
    },
    async listByRecruiter(recruiterId: string): Promise<JobRow[]> {
      return prisma.job.findMany({
        where: { recruiterId },
        orderBy: { createdAt: "desc" },
        select: SELECT,
      });
    },
  };
}

/**
 * Recruiter-facing application reads. The select is the isolation surface:
 * fullName only — no email, phone, LinkedIn, GitHub, or resume URL.
 */
export function prismaApplicantStore(): ApplicationStore {
  return {
    async listByJob(jobId: string): Promise<ApplicantStoreRow[]> {
      const rows = await prisma.jobApplication.findMany({
        where: { jobId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          userId: true,
          note: true,
          status: true,
          createdAt: true,
          user: {
            select: {
              candidateProfile: { select: { fullName: true } },
            },
          },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        note: row.note,
        status: row.status,
        createdAt: row.createdAt,
        fullName: row.user.candidateProfile?.fullName ?? null,
      }));
    },
    async countByJobIds(jobIds: string[]): Promise<Record<string, number>> {
      const counts: Record<string, number> = {};
      for (const id of jobIds) counts[id] = 0;
      if (jobIds.length === 0) return counts;
      const grouped = await prisma.jobApplication.groupBy({
        by: ["jobId"],
        where: { jobId: { in: jobIds } },
        _count: { _all: true },
      });
      for (const row of grouped) {
        counts[row.jobId] = row._count._all;
      }
      return counts;
    },
    async existsOnJob(jobId, userId) {
      const row = await prisma.jobApplication.findFirst({
        where: { jobId, userId },
        select: { id: true },
      });
      return Boolean(row);
    },
  };
}

/** Recruiter-safe identity for the inspector — booleans, never URLs. */
export async function prismaLoadPublicIdentity(
  userId: string,
): Promise<ApplicantPublicIdentity | null> {
  const map = await loadRecruiterIdentities([userId]);
  const row = map.get(userId);
  if (!row) return null;
  return {
    fullName: row.fullName,
    role: row.role,
    yearsExperience: row.yearsExperience,
    education: row.education,
    skills: row.skills,
    hasLinkedin: row.hasLinkedin,
    hasGithub: row.hasGithub,
    hasResume: row.hasResume,
  };
}
