import "server-only";

import { prisma } from "@/lib/db";
import { encodeCandidateRef } from "@/features/hire/candidate-ref";
import { computeCoverage } from "@/features/hire/dossier";
import { declared, derived, verified } from "@/features/hire/dossier-provenance";
import { candidatePublicId } from "@/features/hire/public-id";
import { tidyRoleLabel } from "@/features/hire/role-family";
import { splitSkills } from "@/features/hire/challenge-dossier";
import type { CandidateDossier, EvidenceCoverage } from "@/features/hire/types";

export type HackathonDossierSet = {
  dossiers: CandidateDossier[];
  coverage: EvidenceCoverage;
  nameByUser: Map<string, string>;
};

const EMPTY: HackathonDossierSet = {
  dossiers: [],
  coverage: {
    dimensions: {
      stack: false,
      missions: false,
      cleanPass: false,
      projects: false,
      consistency: false,
      interview: false,
      experience: false,
    },
    note: "No hackathon submissions in the pool yet.",
  },
  nameByUser: new Map(),
};

/**
 * People who actually shipped a hackathon repo. Thin evidence: one shipped
 * project, optional profile skills. No 60-day denominator.
 */
export async function buildHackathonDossierSet(): Promise<HackathonDossierSet> {
  const rows = await prisma.hackathonParticipant.findMany({
    where: { team: { submission: { isNot: null } } },
    select: {
      userId: true,
      user: {
        select: {
          name: true,
          studentProfile: {
            select: {
              skills: true,
              role: true,
              yearsExperience: true,
              graduationYear: true,
              linkedinUrl: true,
              githubUsername: true,
              resumeUrl: true,
            },
          },
        },
      },
    },
    take: 200,
  });
  if (rows.length === 0) return EMPTY;

  const nameByUser = new Map<string, string>();
  const dossiers: CandidateDossier[] = rows.map((row) => {
    const p = row.user.studentProfile;
    const skills = splitSkills(p?.skills ?? []);
    const given = row.user.name?.trim();
    if (given) nameByUser.set(row.userId, given);
    return {
      publicId: candidatePublicId(row.userId),
      source: "HACKATHON",
      candidateRef: encodeCandidateRef("HACKATHON", row.userId),
      programMemberId: null,
      userId: row.userId,
      roleFamily: derived("OTHER"),
      rawRoleLabel: p?.role
        ? declared(tidyRoleLabel(p.role))
        : derived("Hackathon builder"),
      yearsExperience: declared(p?.yearsExperience ?? 0),
      education: declared({
        level: null,
        university: null,
        gradYear: p?.graduationYear ?? null,
      }),
      declaredSkills: declared(skills),
      links: declared({
        linkedin: Boolean(p?.linkedinUrl),
        github: Boolean(p?.githubUsername),
        resume: Boolean(p?.resumeUrl),
      }),
      evidence: {
        missionsPassed: verified(1),
        missionsAttempted: verified(1),
        missionsWaived: verified(0),
        cleanPassCount: verified(0),
        cleanPassPct: derived(0),
        commitDays: verified(1),
        activeDaysSpan: verified(1),
        lastActiveAt: verified(null),
        projectScores: verified([]),
        interview: verified(null),
        workingLanguages: verified(skills.slice(0, 4)),
        missionTypesPassed: verified(["HACKATHON"]),
        cohortProgress: derived({ day: 1, ofDays: 1 }),
        certificateIssued: verified(false),
        quizAverage: verified(null),
      },
      availability: null,
      compensation: { declared: null, estimate: null },
    };
  });

  return {
    dossiers,
    coverage: computeCoverage(dossiers),
    nameByUser,
  };
}
