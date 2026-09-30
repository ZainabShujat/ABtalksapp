import { prisma } from "@/lib/db";
import type { JobRow } from "@/features/recruiter-jobs/service";
import type {
  ApplicationRow,
  ApplicationStore,
  ApplicationWithJob,
  JobFilterInput,
} from "./service";

const APPLICATION_SELECT = {
  id: true,
  jobId: true,
  userId: true,
  status: true,
  resumeUrl: true,
  coverLetter: true,
  note: true,
  createdAt: true,
  updatedAt: true,
} as const;

const JOB_LIST_SELECT = {
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

const JOB_TRACKING_SELECT = {
  id: true,
  title: true,
  company: true,
  location: true,
  workMode: true,
  type: true,
  status: true,
  isOpen: true,
} as const;

export function prismaApplicationStore(): ApplicationStore {
  return {
    async create(input): Promise<ApplicationRow> {
      return prisma.jobApplication.create({
        data: {
          jobId: input.jobId,
          userId: input.userId,
          note: input.note ?? null,
          resumeUrl: input.resumeUrl ?? null,
          coverLetter: input.coverLetter ?? null,
        },
        select: APPLICATION_SELECT,
      });
    },

    async findByCandidateAndJob(userId, jobId): Promise<ApplicationRow | null> {
      return prisma.jobApplication.findUnique({
        where: { userId_jobId: { userId, jobId } },
        select: APPLICATION_SELECT,
      });
    },

    async listByCandidate(userId): Promise<ApplicationWithJob[]> {
      const rows = await prisma.jobApplication.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { ...APPLICATION_SELECT, job: { select: JOB_TRACKING_SELECT } },
      });
      return rows.map((r) => ({
        id: r.id,
        jobId: r.jobId,
        userId: r.userId,
        status: r.status,
        resumeUrl: r.resumeUrl,
        coverLetter: r.coverLetter,
        note: r.note,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        job: r.job,
      }));
    },

    async listPublishedJobsFiltered(filter: JobFilterInput): Promise<JobRow[]> {
      return prisma.job.findMany({
        where: {
          status: "PUBLISHED",
          ...(filter.location
            ? { location: { contains: filter.location, mode: "insensitive" } }
            : {}),
          ...(filter.workMode ? { workMode: filter.workMode } : {}),
          ...(filter.opportunityType ? { type: filter.opportunityType } : {}),
          ...(filter.skills && filter.skills.length > 0
            ? { skills: { hasSome: filter.skills } }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        select: JOB_LIST_SELECT,
      });
    },
  };
}
