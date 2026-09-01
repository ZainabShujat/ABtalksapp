/**
 * Curated vocabularies for the detailed profile's dropdowns.
 *
 * Deliberately static constants rather than catalog tables. Colleges already
 * have a real catalog (`College`, 54k rows, `/api/colleges/search`) and skills
 * have `Skill`; degrees, departments and role titles do not, and three new
 * tables to hold a few dozen strings each would be a migration nobody needs.
 * Every one of these is a suggestion list, not an allow-list — each field
 * accepts free text so nobody is blocked by a missing entry.
 */

export const MONTHS = [
  { value: 1, label: "January", short: "Jan" },
  { value: 2, label: "February", short: "Feb" },
  { value: 3, label: "March", short: "Mar" },
  { value: 4, label: "April", short: "Apr" },
  { value: 5, label: "May", short: "May" },
  { value: 6, label: "June", short: "Jun" },
  { value: 7, label: "July", short: "Jul" },
  { value: 8, label: "August", short: "Aug" },
  { value: 9, label: "September", short: "Sep" },
  { value: 10, label: "October", short: "Oct" },
  { value: 11, label: "November", short: "Nov" },
  { value: 12, label: "December", short: "Dec" },
] as const;

export function monthShort(month: number | null | undefined): string | null {
  if (month == null) return null;
  return MONTHS.find((m) => m.value === month)?.short ?? null;
}

/** Education spans reach further back than employment; projects reach forward. */
export function yearRange(back: number, forward: number): number[] {
  const now = new Date().getUTCFullYear();
  const years: number[] = [];
  for (let y = now + forward; y >= now - back; y--) years.push(y);
  return years;
}

export const DEGREES = [
  "B.E",
  "B.Tech",
  "B.Sc",
  "B.C.A",
  "B.Com",
  "B.A",
  "B.B.A",
  "B.Des",
  "B.Pharm",
  "M.E",
  "M.Tech",
  "M.Sc",
  "M.C.A",
  "M.B.A",
  "M.Com",
  "M.A",
  "M.Des",
  "Ph.D",
  "Diploma",
  "Integrated M.Tech",
  "Higher Secondary (12th)",
  "Secondary (10th)",
] as const;

export const FIELDS_OF_STUDY = [
  "Computer Science and Engineering",
  "Information Technology",
  "Artificial Intelligence and Machine Learning",
  "Data Science",
  "Electronics and Communication Engineering",
  "Electrical Engineering",
  "Mechanical Engineering",
  "Civil Engineering",
  "Chemical Engineering",
  "Biotechnology",
  "Mathematics and Computing",
  "Statistics",
  "Physics",
  "Commerce",
  "Business Administration",
  "Design",
  "Economics",
] as const;

export const COMMON_ROLES = [
  "Software Engineer",
  "Senior Software Engineer",
  "Frontend Engineer",
  "Backend Engineer",
  "Full Stack Engineer",
  "Mobile Engineer",
  "Data Scientist",
  "Data Analyst",
  "Data Engineer",
  "Machine Learning Engineer",
  "AI Engineer",
  "MLOps Engineer",
  "DevOps Engineer",
  "Site Reliability Engineer",
  "Cloud Engineer",
  "QA Engineer",
  "Product Manager",
  "Engineering Manager",
  "UI/UX Designer",
  "Business Analyst",
  "Technical Writer",
  "Research Intern",
  "Software Engineering Intern",
  "Data Science Intern",
] as const;

export const EMPLOYMENT_TYPES = [
  "Full-time",
  "Part-time",
  "Internship",
  "Contract",
  "Freelance",
  "Apprenticeship",
] as const;

/** Stored on `CandidatePreference.remotePreference`, which is a free string. */
export const WORK_MODES = ["Remote", "Hybrid", "On-site", "Flexible"] as const;

export const GRADE_TYPE_LABELS: Record<string, string> = {
  PERCENTAGE: "Percentage",
  CGPA_10: "CGPA (out of 10)",
  GPA_4: "GPA (out of 4)",
  GRADE: "Letter grade",
  OTHER: "Other",
};

export const OPPORTUNITY_TYPE_LABELS: Record<string, string> = {
  INTERNSHIP: "Internship",
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  FREELANCE: "Freelance",
};

export const PROFICIENCY_LABELS: Record<string, string> = {
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
  EXPERT: "Expert",
};

export const LINK_TYPE_LABELS: Record<string, string> = {
  PORTFOLIO: "Portfolio",
  LINKEDIN: "LinkedIn",
  GITHUB: "GitHub",
  LEETCODE: "LeetCode",
  CODECHEF: "CodeChef",
  CODEFORCES: "Codeforces",
  KAGGLE: "Kaggle",
  BEHANCE: "Behance",
  DRIBBBLE: "Dribbble",
  OTHER: "Other",
};

/** Additional-link types only — the three first-class links have their own fields. */
export const EXTRA_LINK_TYPES = [
  "LEETCODE",
  "CODECHEF",
  "CODEFORCES",
  "KAGGLE",
  "BEHANCE",
  "DRIBBBLE",
  "OTHER",
] as const;

export const PERSONA_LABELS: Record<string, string> = {
  STUDENT: "Student",
  PROFESSIONAL: "Working professional",
  OTHER: "Other",
};
