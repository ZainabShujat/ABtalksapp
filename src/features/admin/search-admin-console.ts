import { prisma } from "@/lib/db";
import { listCandidateProfiles } from "@/repositories/candidate";

export async function searchAdminConsole(q: string) {
  const term = q.trim();
  if (term.length < 2) {
    return { candidates: [], recruiters: [], jobs: [], assessments: [] };
  }

  const [candidates, recruiters, jobs, assessments] = await Promise.all([
    prisma.user.findMany({
      where: {
        deletedAt: null,
        recruiterProfile: { is: null },
        OR: [
          { email: { contains: term, mode: "insensitive" } },
          { name: { contains: term, mode: "insensitive" } },
          {
            candidateProfile: {
              fullName: { contains: term, mode: "insensitive" },
            },
          },
        ],
      },
      take: 8,
      select: {
        id: true,
        email: true,
        name: true,
        disabledAt: true,
        candidateProfile: { select: { fullName: true } },
        resume: { select: { blobPathname: true, fileName: true } },
      },
    }),
    prisma.recruiterProfile.findMany({
      where: {
        OR: [
          { fullName: { contains: term, mode: "insensitive" } },
          { company: { contains: term, mode: "insensitive" } },
          { user: { email: { contains: term, mode: "insensitive" } } },
        ],
      },
      take: 8,
      select: {
        id: true,
        userId: true,
        fullName: true,
        company: true,
        user: { select: { email: true, disabledAt: true } },
      },
    }),
    prisma.job.findMany({
      where: {
        OR: [
          { title: { contains: term, mode: "insensitive" } },
          { company: { contains: term, mode: "insensitive" } },
        ],
      },
      take: 8,
      select: {
        id: true,
        title: true,
        company: true,
        isOpen: true,
      },
    }),
    prisma.recruiterAssessment.findMany({
      where: { title: { contains: term, mode: "insensitive" } },
      take: 8,
      select: {
        id: true,
        title: true,
        status: true,
        createdBy: { select: { email: true, name: true } },
      },
    }),
  ]);

  const names = await listCandidateProfiles(candidates.map((c) => c.id));
  // `resume` is destructured away on purpose: the page needs a boolean and a
  // name, and a private blob pathname has no business on a rendered payload.
  const namedCandidates = candidates.map(({ resume, ...c }) => ({
    ...c,
    hasResumeFile: Boolean(resume?.blobPathname),
    resumeFileName: resume?.fileName ?? null,
    studentProfile: {
      fullName:
        names.get(c.id)?.fullName ?? c.candidateProfile?.fullName ?? c.name ?? c.email,
    },
  }));

  return { candidates: namedCandidates, recruiters, jobs, assessments };
}
