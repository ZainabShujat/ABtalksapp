import { prisma } from "@/lib/db";

/**
 * Candidate-facing detail. Draft jobs are treated as non-existent (returns
 * null so the page renders notFound()) — this prevents recruiters leaking
 * the existence of a draft opening via id enumeration.
 */
export async function getJobDetail(jobId: string, userId: string) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      workMode: true,
      type: true,
      description: true,
      skills: true,
      minExperience: true,
      applyExternalUrl: true,
      isOpen: true,
      status: true,
      createdAt: true,
      publishedAt: true,
      closedAt: true,
    },
  });
  if (!job) return null;
  if (job.status === "DRAFT") return null;

  const applied = await prisma.jobApplication.findUnique({
    where: { userId_jobId: { userId, jobId } },
    select: { id: true },
  });

  return { job, alreadyApplied: !!applied };
}
