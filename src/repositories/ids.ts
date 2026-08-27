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

export function activityIdForQuiz(id: string): string {
  return `act_quiz_${id}`;
}

export function activityIdForVideo(id: string): string {
  return `act_vid_${id}`;
}

export function enrollmentIdFromPe(peId: string): string | null {
  return peId.startsWith("pe_enr_") ? peId.slice("pe_enr_".length) : null;
}

export function memberIdFromPe(peId: string): string | null {
  return peId.startsWith("pe_pm_") ? peId.slice("pe_pm_".length) : null;
}

export function dailyTaskIdFromActivity(activityId: string): string | null {
  return activityId.startsWith("act_dt_")
    ? activityId.slice("act_dt_".length)
    : null;
}

export function programDayIdFromActivity(activityId: string): string | null {
  return activityId.startsWith("act_pd_")
    ? activityId.slice("act_pd_".length)
    : null;
}

export function quizIdFromActivity(activityId: string): string | null {
  return activityId.startsWith("act_quiz_")
    ? activityId.slice("act_quiz_".length)
    : null;
}

export function videoIdFromActivity(activityId: string): string | null {
  return activityId.startsWith("act_vid_")
    ? activityId.slice("act_vid_".length)
    : null;
}

export function programCohortIdFromSlug(slug: string): string | null {
  return slug.startsWith("legacy-program-")
    ? slug.slice("legacy-program-".length)
    : null;
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
