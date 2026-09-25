import "server-only";

import { listProfileCandidates } from "@/repositories/hire";
import { listUnclaimedImportUserIds } from "@/repositories/resume-import";
import { encodeCandidateRef } from "@/features/hire/candidate-ref";
import { computeCoverage, loadAvailabilityByUserId } from "@/features/hire/dossier";
import { declared, derived, verified } from "@/features/hire/dossier-provenance";
import { candidatePublicId } from "@/features/hire/public-id";
import { tidyRoleLabel } from "@/features/hire/role-family";
import { splitSkills } from "@/features/hire/challenge-dossier";
import type { CandidateDossier, EvidenceCoverage } from "@/features/hire/types";

/**
 * Candidates who are searchable because their PROFILE is usable — and for no
 * other reason.
 *
 * This is the track that makes discoverability derive from profile state alone.
 * Everyone here has zero ABTalks activity by construction: no cohort, no
 * challenge, no hackathon, no missions, no interview. That is not a defect to
 * be papered over, so every evidence figure below is an honest zero rather than
 * an invented one, and `provenance` marks the profile facts `declared` — they
 * are the candidate's word, and the card must not imply otherwise.
 *
 * Consequences that are deliberate:
 *   - `computeCoverage` will report almost every dimension false for a
 *     profile-only pool, which is exactly right: there is nothing to rank on but
 *     the declared stack, and the recruiter should be told that.
 *   - the evidence floor is never consulted here. It ranks and counts elsewhere;
 *     it has never been an eligibility condition and must not become one.
 */

export type ProfileDossierSet = {
  dossiers: CandidateDossier[];
  coverage: EvidenceCoverage;
  nameByUser: Map<string, string>;
};

const EMPTY: ProfileDossierSet = {
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
      role: false,
    },
    note: "No profile-only candidates in the pool yet.",
  },
  nameByUser: new Map(),
};

export async function buildProfileDossierSet(
  opts?: { limit?: number },
): Promise<ProfileDossierSet> {
  const rows = await listProfileCandidates(opts?.limit ?? 200);
  if (rows.length === 0) return EMPTY;

  const [availability, unclaimed] = await Promise.all([
    loadAvailabilityByUserId(rows.map((r) => r.userId)),
    listUnclaimedImportUserIds(rows.map((r) => r.userId)),
  ]);

  const nameByUser = new Map<string, string>();
  const dossiers: CandidateDossier[] = rows.map((row) => {
    const p = row.recruiterIdentity;
    const skills = splitSkills(p.skills);
    const given = row.user.name?.trim() || p.fullName.trim();
    if (given) nameByUser.set(row.userId, given);
    const av = availability.get(row.userId) ?? null;

    return {
      publicId: candidatePublicId(row.userId),
      source: "PROFILE",
      candidateRef: encodeCandidateRef("PROFILE", row.userId),
      programMemberId: null,
      userId: row.userId,
      importedUnclaimed: unclaimed.has(row.userId),
      roleFamily: derived("OTHER"),
      rawRoleLabel: p.role
        ? declared(tidyRoleLabel(p.role))
        : derived("Candidate"),
      yearsExperience: declared(p.yearsExperience ?? 0),
      education: declared({
        level: p.education,
        university: p.university,
        gradYear: p.graduationYear ?? null,
      }),
      declaredSkills: declared(skills),
      // Booleans only. The addresses are contact data and never leave the server.
      links: declared({
        linkedin: p.hasLinkedin,
        github: p.hasGithub,
        resume: p.hasResume,
      }),
      evidence: {
        // Honest zeros: this track exists precisely for people with no ABTalks
        // record. Nothing here is a floor — it is an absence, and the scorer
        // reads it as one.
        missionsPassed: verified(0),
        missionsAttempted: verified(0),
        missionsWaived: verified(0),
        cleanPassCount: verified(0),
        cleanPassPct: derived(0),
        commitDays: verified(0),
        activeDaysSpan: verified(0),
        lastActiveAt: verified(null),
        projectScores: verified([]),
        interview: verified(null),
        // Working languages are the languages of missions actually passed.
        // There are none, and the declared stack is not a substitute for them.
        workingLanguages: verified([]),
        missionTypesPassed: verified([]),
        cohortProgress: derived({ day: 0, ofDays: 0 }),
        certificateIssued: verified(false),
        quizAverage: verified(null),
      },
      availability: av
        ? {
            openToWork: av.openToWork,
            expectedSalaryMin: av.expectedSalaryMin,
            expectedSalaryMax: av.expectedSalaryMax,
            salaryCurrency: av.salaryCurrency,
            noticePeriodDays: av.noticePeriodDays,
            preferredWorkMode: av.preferredWorkMode,
            preferredCities: av.preferredCities,
            openToRelocate: av.openToRelocate,
            opportunityTypes: av.opportunityTypes,
          }
        : null,
      compensation: { declared: null, estimate: null },
    };
  });

  return {
    dossiers,
    coverage: computeCoverage(dossiers),
    nameByUser,
  };
}
