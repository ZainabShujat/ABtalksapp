import { prisma } from "@/lib/db";
import { listCandidateProfiles } from "@/repositories/candidate";

export async function getJobApplicants(jobId: string) {
  const rows = await prisma.jobApplication.findMany({
    where: { jobId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      note: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          email: true,
          studentProfile: {
            select: {
              fullName: true,
              phone: true,
              domain: true,
              linkedinUrl: true,
              githubUsername: true,
              college: true,
              graduationYear: true,
              isReadyForInterview: true,
            },
          },
        },
      },
    },
  });

  const identities = await listCandidateProfiles(rows.map((r) => r.user.id));

  return rows.map((row) => {
    const identity = identities.get(row.user.id);
    const sp = row.user.studentProfile;
    if (!identity || !sp) return row;
    return {
      ...row,
      user: {
        ...row.user,
        studentProfile: {
          ...sp,
          fullName: identity.fullName,
          phone: identity.phone,
          linkedinUrl: identity.linkedinUrl,
          githubUsername: identity.githubUsername,
          college: identity.college,
          graduationYear: identity.graduationYear,
          isReadyForInterview: identity.isReadyForInterview,
        },
      },
    };
  });
}
