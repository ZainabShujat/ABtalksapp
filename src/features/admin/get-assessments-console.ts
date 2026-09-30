import { prisma } from "@/lib/db";

/** Recruiter-built assessments only; platform ones are listed by plan 166's store. */
const RECRUITER = { source: "RECRUITER" } as const;

export async function getAssessmentsConsole() {
  const [total, published, drafts, rows] = await Promise.all([
    prisma.recruiterAssessment.count({ where: RECRUITER }),
    prisma.recruiterAssessment.count({
      where: { ...RECRUITER, status: "PUBLISHED" },
    }),
    prisma.recruiterAssessment.count({
      where: { ...RECRUITER, status: "DRAFT" },
    }),
    prisma.recruiterAssessment.findMany({
      where: RECRUITER,
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        createdBy: { select: { email: true, name: true } },
        _count: { select: { assignments: true, questions: true } },
      },
    }),
  ]);

  return { total, published, drafts, rows };
}
