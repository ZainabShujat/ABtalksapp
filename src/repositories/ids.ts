/** Stable ids shared with prisma/scripts/migrate-078-shared.ts. */
export function peIdForEnrollment(enrollmentId: string): string {
  return `pe_enr_${enrollmentId}`;
}

export function peIdForMember(memberId: string): string {
  return `pe_pm_${memberId}`;
}

export function activityIdForDailyTask(id: string): string {
  return `act_dt_${id}`;
}

export function activityIdForProgramDay(id: string): string {
  return `act_pd_${id}`;
}

export function attemptIdForSubmission(id: string): string {
  return `aa_sub_${id}`;
}

export function attemptIdForMission(id: string): string {
  return `aa_ms_${id}`;
}

export function cohortSlugForDomain(domain: string): string {
  return `legacy-${domain.toLowerCase()}`;
}

export function cohortSlugForProgramCohort(programCohortId: string): string {
  return `legacy-program-${programCohortId}`;
}
