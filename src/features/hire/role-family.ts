/**
 * A usable role bucket from a free-text job title.
 *
 * `ProgramMember.jobRole` is whatever the member typed at application time.
 * The live cohort contains "Student", "student", "STUDENT", "Fresher",
 * "B.Tech 3rd year Student", "Software (Data) Engineer", "Data Analyst-
 * Benefits" and "Credit Risk Analyst Intern" — so the raw string is unusable
 * for grouping, filtering or a salary band, and showing it back to a recruiter
 * as a job title overstates what it is.
 *
 * The raw label is still kept on the dossier and shown as "self-described as
 * …". This function only produces the bucket used for aggregates and for the
 * indicative compensation band.
 *
 * No `import "server-only"` — the card renders the label.
 */
export type RoleFamily =
  | "AI_ML"
  | "DATA"
  | "BACKEND"
  | "FRONTEND"
  | "FULLSTACK"
  | "ANALYST"
  | "MANAGER"
  | "STUDENT"
  | "OTHER";

export const ROLE_FAMILY_LABEL: Record<RoleFamily, string> = {
  AI_ML: "AI / ML",
  DATA: "Data engineering",
  BACKEND: "Backend",
  FRONTEND: "Frontend",
  FULLSTACK: "Full-stack",
  ANALYST: "Analyst",
  MANAGER: "Management",
  STUDENT: "Student / fresher",
  OTHER: "Other",
};

/**
 * Ordered most-specific first: the first rule that hits wins.
 *
 * Order carries real meaning. "AI Safety Analyst" is an AI role, not a generic
 * analyst, so AI_ML is tested before ANALYST. "Data Analyst" is a data role, so
 * DATA precedes ANALYST too. A title that matches nothing becomes OTHER rather
 * than being forced into the nearest bucket — a wrong family produces a wrong
 * salary band, and no band is better than a wrong one.
 */
const RULES: { family: RoleFamily; patterns: RegExp[] }[] = [
  {
    family: "AI_ML",
    patterns: [
      /\bai\b/,
      /\bml\b/,
      /machine learning/,
      /deep learning/,
      /\bnlp\b/,
      /\bllm\b/,
      /data scien/,
      /prompt/,
      /genai|gen ai/,
    ],
  },
  {
    family: "DATA",
    patterns: [
      /\bdata\b/,
      /\betl\b/,
      /analytics engineer/,
      /\bbi\b|business intelligence/,
      /warehouse|databricks|spark|airflow/,
    ],
  },
  {
    family: "FULLSTACK",
    patterns: [/full.?stack/, /\bmern\b|\bmean\b/],
  },
  {
    family: "FRONTEND",
    patterns: [/front.?end/, /\bui\b developer/, /react developer/, /web designer/],
  },
  {
    family: "BACKEND",
    patterns: [
      /back.?end/,
      /\bsde\b/,
      /software (dev|engineer)/,
      /\bdevops\b/,
      /platform engineer/,
      /\bapi\b/,
      /cloud engineer/,
    ],
  },
  {
    family: "ANALYST",
    patterns: [/analyst/, /\bresearch/, /consultant/],
  },
  {
    family: "MANAGER",
    patterns: [
      /manager/,
      /\blead\b/,
      /director/,
      /\bhead\b/,
      /\bvp\b/,
      /founder/,
      /product owner/,
    ],
  },
  {
    family: "STUDENT",
    patterns: [
      /student/,
      /fresher/,
      /\bgrad(uate)?\b/,
      /\bintern\b/,
      /b\.?tech|b\.?e\b|m\.?tech|bca|mca|bsc|msc/,
      /aspirant|seeking|looking for/,
      /unemployed|none|n\/a/,
    ],
  },
];

export function roleFamilyFor(rawRole: string | null | undefined): RoleFamily {
  const role = (rawRole ?? "").trim().toLowerCase();
  if (!role) return "OTHER";
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(role))) return rule.family;
  }
  return "OTHER";
}

/**
 * The raw title, cleaned enough to display without shouting.
 *
 * "STUDENT" and "student" are the same answer typed by two people; neither
 * should reach a recruiter in its original casing.
 */
export function tidyRoleLabel(rawRole: string | null | undefined): string {
  const role = (rawRole ?? "").trim().replace(/\s+/g, " ");
  if (!role) return "Not stated";
  const allCaps = role === role.toUpperCase();
  const allLower = role === role.toLowerCase();
  if (!allCaps && !allLower) return role;
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}
