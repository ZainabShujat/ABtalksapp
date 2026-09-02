/**
 * Résumé domain types.
 *
 * `ParsedResume` is the canonical, camelCase form of the Résumé Parser Agent's
 * output (`agent packages/AI-Agents/Résumé Parser Agent/resume_agent.py`). The
 * agent emits snake_case; `normalizeParsedResume` is the port of that file's
 * `normalize_resume_parsed()` and is the only place the two shapes meet.
 *
 * `ResumeAnalysis` is a **Résumé Strength** result. It is computed without any
 * job description and is not an ATS score — see `strength.ts`.
 *
 * `ResumeView` is the ONLY shape that crosses to the client. Raw parser output
 * and raw analysis never leave the server.
 *
 * No `server-only` here: these are types plus two const arrays, and the client
 * section imports the category metadata to label the score breakdown.
 */

/* ─── Upload limits (client-safe) ────────────────────────────────────────── */

/** Vercel caps a serverless request body at 4.5 MB; stay under it with room. */
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;

/**
 * PDF only. The Python agent's README claims DOCX, but its actual pipeline is
 * `pdfplumber` over a PDF; there is no reliable DOCX path in it, so DOCX is not
 * advertised in the UI either.
 */
export const ACCEPTED_MIME_TYPES = ["application/pdf"] as const;

/* ─── Parsed résumé ──────────────────────────────────────────────────────── */

export type ParsedProject = {
  title: string | null;
  description: string | null;
  technologies: string[];
  github: string | null;
  demo: string | null;
  contributions: string[];
};

export type ParsedExperience = {
  title: string | null;
  company: string | null;
  employmentType: string | null;
  duration: string | null;
  responsibilities: string[];
  achievements: string[];
  technologies: string[];
};

export type ParsedEducation = {
  degree: string | null;
  branch: string | null;
  institution: string | null;
  year: string | null;
  cgpa: string | null;
};

export type ParsedInternship = {
  company: string | null;
  role: string | null;
  duration: string | null;
  summary: string | null;
};

export type ParsedResume = {
  candidateName: string | null;
  headline: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin: string | null;
  github: string | null;
  portfolio: string | null;
  website: string | null;
  summary: string | null;
  careerLevel: string | null;
  primaryDomain: string | null;
  estimatedExperienceYears: number;
  skills: string[];
  technicalSkills: string[];
  softSkills: string[];
  programmingLanguages: string[];
  frameworks: string[];
  databases: string[];
  cloudPlatforms: string[];
  tools: string[];
  certifications: string[];
  achievements: string[];
  languages: string[];
  projects: ParsedProject[];
  experience: ParsedExperience[];
  education: ParsedEducation[];
  internships: ParsedInternship[];
};

/* ─── Résumé Strength ────────────────────────────────────────────────────── */

export type StrengthCategoryKey =
  | "completeness"
  | "contentQuality"
  | "impact"
  | "structure"
  | "skillsEvidence"
  | "experienceProjectStrength"
  | "professionalReadiness";

/**
 * Weights sum to exactly 100. Changing one means changing another — the scorer
 * asserts the sum at module load so a bad edit fails loudly rather than
 * silently producing scores that cannot reach 100.
 */
export const STRENGTH_CATEGORIES: readonly {
  key: StrengthCategoryKey;
  label: string;
  weight: number;
  /** Shown under the bar. Explains what the number measures, in the user's terms. */
  blurb: string;
}[] = [
  {
    key: "completeness",
    label: "Completeness",
    weight: 15,
    blurb: "Whether the expected sections are all present.",
  },
  {
    key: "contentQuality",
    label: "Content quality",
    weight: 20,
    blurb: "How the bullets are written — length, verbs, specificity.",
  },
  {
    key: "impact",
    label: "Impact",
    weight: 20,
    blurb: "How much of your work is described with measurable outcomes.",
  },
  {
    key: "structure",
    label: "Structure",
    weight: 15,
    blurb: "Dates, ordering, and a readable amount of detail per entry.",
  },
  {
    key: "skillsEvidence",
    label: "Skills evidence",
    weight: 10,
    blurb: "How many listed skills actually appear in your work.",
  },
  {
    key: "experienceProjectStrength",
    label: "Experience & projects",
    weight: 15,
    blurb: "Depth and substance of the roles and projects you show.",
  },
  {
    key: "professionalReadiness",
    label: "Professional readiness",
    weight: 5,
    blurb: "Headline and the links a recruiter will look for.",
  },
] as const;

export type StrengthCategories = Record<StrengthCategoryKey, number>;

export type ResumeAnalysis = {
  /** 0-100. Weighted sum of `categories`. */
  overallScore: number;
  categories: StrengthCategories;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  /** Bumped when the scoring rules change, so old rows are identifiable. */
  version: number;
};

/* ─── Client-facing view ─────────────────────────────────────────────────── */

export type ResumeStatus = "EMPTY" | "PROCESSING" | "READY" | "FAILED";

/**
 * Everything the profile needs and nothing else. Deliberately contains no
 * extraction metadata, no model names, no blob URLs and no internal status
 * strings beyond the four the UI actually renders.
 *
 * There is no copy of the candidate's experience, education, projects or
 * skills here. Those live in the profile's own sections, which the résumé
 * fills in — rendering them a second time inside the résumé card would build
 * exactly the separate "document viewer" this feature is meant not to be.
 */
export type ResumeView = {
  status: ResumeStatus;
  sourceType: "UPLOAD" | "URL";
  /** Present for uploads. Null for links. */
  fileName: string | null;
  /** The candidate's own link, if that is the source. */
  sourceUrl: string | null;
  /** Set when an original file is stored and can be downloaded by the owner. */
  downloadPath: string | null;
  updatedAtIso: string;
  /** User-facing message when `status` is FAILED. */
  failureReason: string | null;

  /**
   * Null until the résumé has been read successfully.
   *
   * Deliberately narrow. The engine scores seven weighted categories and every
   * one is persisted in `CandidateResume.analysis` — but the candidate's own
   * profile shows a number, a label, one sentence and a short list of things to
   * fix. The per-category scores, the strengths list and the full weaknesses
   * list are not sent to the client at all: data that is not rendered should
   * not cross the boundary, and trimming it here is what stops the section
   * drifting back into a diagnostic panel.
   */
  strength: {
    overallScore: number;
    band: string;
    /** 2-3 concrete things to fix, worst first. */
    tips: string[];
  } | null;

  /**
   * Human labels for the profile sections this résumé filled in, e.g.
   * ["Education", "Projects", "Skills"]. Empty when the candidate had already
   * filled everything in themselves — enrichment never overwrites.
   */
  addedToProfile: string[];
};
