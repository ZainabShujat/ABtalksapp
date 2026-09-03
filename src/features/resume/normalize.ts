/**
 * Port of `normalize_resume_parsed()` from the Résumé Parser Agent
 * (`agent packages/AI-Agents/Résumé Parser Agent/resume_agent.py`).
 *
 * Same job, same guarantees: whatever the model returns — missing keys, a
 * string where a list belongs, a null inside an array, a number as a year — a
 * fully-populated `ParsedResume` comes out. Every downstream reader (the
 * scorer, the view, the stored JSON) can then assume the shape without
 * defensive checks of its own.
 *
 * The agent emits snake_case. Both spellings are accepted on the way in so the
 * prompt can keep the agent's exact schema while the rest of this codebase
 * stays camelCase.
 *
 * Pure — no I/O, no `server-only`, so the test file can import it directly.
 */
import type {
  ParsedEducation,
  ParsedExperience,
  ParsedInternship,
  ParsedProject,
  ParsedResume,
} from "@/features/resume/types";

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};
}

/** First non-empty of the given keys, trimmed. Empty string becomes null. */
function str(raw: Raw, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length > 0) return trimmed;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      return String(v);
    }
  }
  return null;
}

/**
 * A list of non-empty strings. Tolerates the model returning a single
 * comma-separated string instead of an array, which it does often enough for a
 * skills field that dropping it would visibly cost the candidate points.
 */
function strList(raw: Raw, ...keys: string[]): string[] {
  for (const key of keys) {
    const v = raw[key];
    if (Array.isArray(v)) {
      const out = v
        .filter((x) => x !== null && x !== undefined)
        .map((x) => String(x).trim())
        .filter((x) => x.length > 0);
      if (out.length > 0) return dedupe(out);
    } else if (typeof v === "string" && v.trim().length > 0) {
      return dedupe(
        v
          .split(",")
          .map((x) => x.trim())
          .filter((x) => x.length > 0),
      );
    }
  }
  return [];
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function objList(raw: Raw, ...keys: string[]): Raw[] {
  for (const key of keys) {
    const v = raw[key];
    if (Array.isArray(v)) {
      return v.filter(
        (x): x is Raw =>
          x !== null && typeof x === "object" && !Array.isArray(x),
      );
    }
  }
  return [];
}

function num(raw: Raw, ...keys: string[]): number {
  for (const key of keys) {
    const v = raw[key];
    const parsed = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(parsed) && parsed >= 0) {
      // Clamped: the model occasionally reads a graduation year as a duration.
      return Math.min(parsed, 60);
    }
  }
  return 0;
}

/**
 * Peels wrappers and trailing punctuation off an extracted URL, repeatedly.
 *
 * A single pass is not enough: a link written inline as "(https://x.app)," ends
 * in `),`, so a trailing-bracket rule that anchors at the end of the string
 * never fires, the comma is removed, and the `)` is left welded to the URL.
 * Peeling in a loop until the string stops changing handles any nesting order.
 *
 * A trailing `)` or `]` is only removed when it is UNBALANCED. URLs that
 * legitimately end in a bracket exist — a Wikipedia article title, a generated
 * doc anchor — and stripping theirs would break a working link. Counting first
 * keeps "(https://x.app)" and "https://en.wikipedia.org/wiki/Foo_(bar)" apart.
 */
function stripWrappingPunctuation(input: string): string {
  let s = input.trim();
  for (let guard = 0; guard < 10; guard++) {
    const before = s;

    s = s.replace(/^[\s"'<([{]+/, "");
    s = s.replace(/[\s"'>]+$/, "");
    s = s.replace(/[.,;:!?]+$/, "");

    const last = s[s.length - 1];
    if (last === ")" || last === "]" || last === "}") {
      const open = last === ")" ? "(" : last === "]" ? "[" : "{";
      const opens = s.split(open).length - 1;
      const closes = s.split(last).length - 1;
      if (closes > opens) s = s.slice(0, -1);
    }

    s = s.trim();
    if (s === before) break;
  }
  return s;
}

/**
 * Normalizes an arbitrary URL string extracted from a document.
 * - Trims whitespace and strips surrounding/trailing punctuation.
 * - Filters out empty strings and non-URL labels ("none", "n/a", "link", "demo", "repo").
 * - Auto-prepends "https://" on bare domain-like strings (e.g. "github.com/...", "linkedin.com/...").
 * - Upgrades "http://" to "https://".
 */
export function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;

  s = stripWrappingPunctuation(s);
  if (!s) return null;

  // Ignore common placeholder words
  const lower = s.toLowerCase();
  const placeholders = new Set([
    "none",
    "n/a",
    "na",
    "null",
    "undefined",
    "nil",
    "false",
    "link",
    "url",
    "website",
    "portfolio",
    "github",
    "linkedin",
    "demo",
    "live",
    "live demo",
    "preview",
    "repo",
    "repository",
    "view project",
    "code",
    "project link",
    "see demo",
  ]);
  if (placeholders.has(lower)) return null;

  // Non-web schemes are ignored
  if (/^(?:mailto|tel|sms|file|ftp):/i.test(s)) return null;

  // If already starts with http:// or https://
  if (/^https?:\/\//i.test(s)) {
    s = s.replace(/^http:\/\//i, "https://");
    try {
      new URL(s);
      return s;
    } catch {
      return null;
    }
  }

  // Check if it looks like a domain / web address (e.g. "linkedin.com/in/...", "github.com/...", "sub.vercel.app")
  if (/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/.*)?$/i.test(s)) {
    const url = `https://${s}`;
    try {
      new URL(url);
      return url;
    } catch {
      return null;
    }
  }

  return null;
}

/** Normalizes a LinkedIn profile URL or handle. */
export function normalizeLinkedinUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Same peeling as normalizeUrl: a handle written inline as "(github.com/x),"
  // must not keep its bracket.
  const trimmed = stripWrappingPunctuation(raw);
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower === "linkedin" || lower === "none" || lower === "n/a" || lower === "null") {
    return null;
  }

  // Matches linkedin.com/in/username or https://www.linkedin.com/in/username
  const fullMatch =
    /^(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?linkedin\.com\/in\/([a-zA-Z0-9_%\-]+)(?:[/?#].*)?$/i.exec(
      trimmed,
    );
  if (fullMatch && fullMatch[1]) {
    return `https://www.linkedin.com/in/${fullMatch[1]}`;
  }

  // Matches in/username or @username
  const inMatch = /^(?:in\/|@)([a-zA-Z0-9_%\-]+)$/i.exec(trimmed);
  if (inMatch && inMatch[1]) {
    return `https://www.linkedin.com/in/${inMatch[1]}`;
  }

  // If it's a handle without spaces/slashes
  if (/^[a-zA-Z0-9_%\-]{3,100}$/.test(trimmed) && !trimmed.includes(".")) {
    return `https://www.linkedin.com/in/${trimmed}`;
  }

  return normalizeUrl(trimmed);
}

/** Normalizes a GitHub URL or username. */
export function normalizeGithubUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Same peeling as normalizeUrl: a handle written inline as "(github.com/x),"
  // must not keep its bracket.
  const trimmed = stripWrappingPunctuation(raw);
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower === "github" || lower === "none" || lower === "n/a" || lower === "null") {
    return null;
  }

  // Repo URL: github.com/user/repo
  const repoMatch =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)(?:[/?#].*)?$/i.exec(
      trimmed,
    );
  if (repoMatch && repoMatch[1]) {
    return `https://github.com/${repoMatch[1]}`;
  }

  // Profile URL: github.com/user
  const profileMatch =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)(?:[/?#].*)?$/i.exec(
      trimmed,
    );
  if (profileMatch && profileMatch[1]) {
    return `https://github.com/${profileMatch[1]}`;
  }

  // Handle: @user or bare username
  if (/^@?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?)$/.test(trimmed)) {
    const handle = trimmed.replace(/^@/, "");
    return `https://github.com/${handle}`;
  }

  return normalizeUrl(trimmed);
}

/** Extracts embedded GitHub and live demo URLs from free-form project text. */
function extractUrlsFromText(text: string): {
  githubUrl: string | null;
  liveUrl: string | null;
} {
  let githubUrl: string | null = null;
  let liveUrl: string | null = null;

  // Match GitHub repository URLs in text
  const githubMatch =
    /(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/i.exec(
      text,
    );
  if (githubMatch) {
    githubUrl = normalizeGithubUrl(githubMatch[0]);
  }

  // Match other live demo / deployment URLs
  const urlMatches = text.match(
    /(?:https?:\/\/[^\s)>\]'",]+|(?:www\.)[^\s)>\]'",]+|(?:[a-zA-Z0-9-]+\.)+(?:vercel\.app|netlify\.app|onrender\.com|herokuapp\.com|pages\.dev|github\.io|[a-z]{2,})(?:\/[^\s)>\]'",]*)?)/gi,
  );
  if (urlMatches) {
    for (const match of urlMatches) {
      if (/github\.com/i.test(match)) continue;
      const norm = normalizeUrl(match);
      if (norm) {
        liveUrl = norm;
        break;
      }
    }
  }

  return { githubUrl, liveUrl };
}

function project(raw: Raw): ParsedProject {
  let title = str(raw, "title", "name", "project_name", "projectName");
  const description = str(raw, "description", "summary");
  const contributions = strList(
    raw,
    "contributions",
    "highlights",
    "bullets",
    "points",
  );

  let github = normalizeGithubUrl(
    str(
      raw,
      "github",
      "repo",
      "repoUrl",
      "repo_url",
      "repository",
      "code",
      "code_url",
      "source",
      "source_code",
    ),
  );
  let demo = normalizeUrl(
    str(
      raw,
      "demo",
      "link",
      "url",
      "liveUrl",
      "live_url",
      "live",
      "deployment",
      "preview",
      "app_url",
      "website",
    ),
  );

  // Fallback: extract inline URLs from project text if not separately structured
  if (!github || !demo) {
    const combined = [title ?? "", description ?? "", ...contributions].join(
      " ",
    );
    const inline = extractUrlsFromText(combined);
    if (!github && inline.githubUrl) github = inline.githubUrl;
    if (!demo && inline.liveUrl) demo = inline.liveUrl;
  }

  // Derive sensible title if missing but repository or description is present
  if (!title && github) {
    const match = /github\.com\/[^\/]+\/([^\/?#]+)/i.exec(github);
    if (match && match[1]) {
      title = match[1];
    } else {
      title = "Open Source Project";
    }
  } else if (!title && description) {
    title = description.length > 40 ? `${description.slice(0, 37)}...` : description;
  }

  return {
    title,
    description,
    technologies: strList(raw, "technologies", "tools", "tech", "techStack"),
    github,
    demo,
    contributions,
  };
}

function experience(raw: Raw): ParsedExperience {
  return {
    title: str(raw, "title", "role", "position"),
    company: str(raw, "company", "organisation", "organization", "employer"),
    employmentType: str(raw, "employment_type", "employmentType"),
    duration: str(raw, "duration", "dates", "period"),
    responsibilities: strList(
      raw,
      "responsibilities",
      "description",
      "bullets",
      "highlights",
    ),
    achievements: strList(raw, "achievements", "impact"),
    technologies: strList(raw, "technologies", "tools", "tech"),
  };
}

function education(raw: Raw): ParsedEducation {
  return {
    degree: str(raw, "degree", "qualification"),
    branch: str(raw, "branch", "field_of_study", "fieldOfStudy", "major"),
    institution: str(raw, "institution", "school", "college", "university"),
    year: str(raw, "year", "graduation_year", "graduationYear", "end_year"),
    cgpa: str(raw, "cgpa", "gpa", "grade", "score"),
  };
}

function internship(raw: Raw): ParsedInternship {
  return {
    company: str(raw, "company", "organisation", "organization"),
    role: str(raw, "role", "title", "position"),
    duration: str(raw, "duration", "dates", "period"),
    summary: str(raw, "summary", "description"),
  };
}

/** Matches open-source contributions, PRs, or repository contributions. */
export function isLikelyOpenSource(text: string): boolean {
  return /\b(?:open[- ]source|github\.com|pull requests?|\bprs?\b|merged (?:pr|pull)|contribut(?:ed|ing|or) to (?:open[- ]source|\w+)|open source contribution)\b/i.test(
    text,
  );
}

/** Matches competitive programming ranks, hackathons, awards, scholarships, honors. */
export function isLikelyAchievement(text: string): boolean {
  return /\b(?:hackathon|codeforces|codechef|leetcode|hackerrank|kaggle|topcoder|geeksforgeeks|runner[- ]?up|1st place|2nd place|3rd place|finalist|winner|won\b|gold medal|silver medal|bronze medal|rank(?:ed)? \d|global rank|national rank|scholarship|dean'?s list|merit award|academic excellence|hall of fame)\b/i.test(
    text,
  );
}

/** Matches academic coursework / university subjects. */
export function isLikelyCoursework(text: string): boolean {
  return /\b(?:coursework|relevant courses|curriculum|subjects studied|passed with distinction|cgpa|gpa \d)\b/i.test(
    text,
  );
}

/** Matches extracurricular, student club, volunteer, or leadership roles. */
export function isLikelyExtracurricular(text: string): boolean {
  return /\b(?:volunteer(?:ed|ing)?|rotaract|ngo|club (?:president|lead|head|secretary|coordinator|member)|student (?:council|coordinator|lead)|organized (?:event|fest|workshop)|gdsc|acm chapter|ieee student branch|campus ambassador|event coordinator|society president)\b/i.test(
    text,
  );
}

/** Matches publications, research papers, patents. */
export function isLikelyPublicationOrPatent(text: string): boolean {
  return /\b(?:published paper|ieee|research paper|conference paper|journal|patent (?:filed|granted))\b/i.test(
    text,
  );
}

/**
 * Returns true only if the string looks like a legitimate certification / credential.
 * Rejects open source contributions, hackathons, awards, coursework, sentences, and degrees.
 */
export function isGenuineCertification(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 150) return false;

  if (isLikelyOpenSource(trimmed)) return false;
  if (isLikelyAchievement(trimmed)) return false;
  if (isLikelyCoursework(trimmed)) return false;
  if (isLikelyExtracurricular(trimmed)) return false;
  if (isLikelyPublicationOrPatent(trimmed)) return false;

  // Degrees (B.Tech, B.S., etc.)
  if (/^(?:bachelor|master|b\.?tech|m\.?tech|b\.?s\.?|m\.?s\.?|ph\.?d|bca|mca)\b/i.test(trimmed)) {
    return false;
  }

  // Multi-sentence or action-verb descriptions (e.g. "Built ...", "Developed ...", "Responsible for ...")
  if (
    /^(?:built|developed|designed|implemented|maintained|created|spearheaded|worked on|managed|led|collaborated|responsible for|helped with|participated in|attended)\b/i.test(
      trimmed,
    )
  ) {
    return false;
  }

  return true;
}

export function normalizeParsedResume(input: unknown): ParsedResume {
  const raw = asRecord(input);

  const rawCerts = strList(raw, "certifications", "certificates");
  const rawAchievements = strList(raw, "achievements", "awards");
  const parsedProjects = objList(raw, "projects").map(project);

  const cleanCerts: string[] = [];
  const rescuedAchievements = [...rawAchievements];
  const rescuedProjects = [...parsedProjects];

  for (const cert of rawCerts) {
    if (isLikelyOpenSource(cert)) {
      // Rescue open-source contribution into projects if it has substance or link
      const urls = extractUrlsFromText(cert);
      let title = "Open Source Contribution";
      if (urls.githubUrl) {
        const repoMatch = /github\.com\/[^\/]+\/([^\/?#]+)/i.exec(urls.githubUrl);
        if (repoMatch && repoMatch[1]) {
          title = `${repoMatch[1]} (Open Source)`;
        }
      }
      if (
        !rescuedProjects.some(
          (p) =>
            p.title?.toLowerCase() === title.toLowerCase() ||
            (urls.githubUrl && p.github === urls.githubUrl),
        )
      ) {
        rescuedProjects.push({
          title,
          description: cert,
          technologies: [],
          github: urls.githubUrl,
          demo: urls.liveUrl,
          contributions: [cert],
        });
      }
      rescuedAchievements.push(cert);
    } else if (
      isLikelyAchievement(cert) ||
      isLikelyExtracurricular(cert) ||
      isLikelyPublicationOrPatent(cert)
    ) {
      rescuedAchievements.push(cert);
    } else if (isGenuineCertification(cert)) {
      cleanCerts.push(cert);
    }
  }

  return {
    candidateName: str(raw, "candidate_name", "candidateName", "name"),
    headline: str(raw, "headline", "title"),
    email: str(raw, "email"),
    phone: str(raw, "phone", "mobile"),
    location: str(raw, "location", "city"),
    linkedin: normalizeLinkedinUrl(
      str(raw, "linkedin", "linkedin_url", "linkedinUrl", "linkedin_profile"),
    ),
    github: normalizeGithubUrl(
      str(raw, "github", "github_url", "githubUrl", "github_profile"),
    ),
    portfolio: normalizeUrl(
      str(raw, "portfolio", "portfolio_url", "portfolioUrl"),
    ),
    website: normalizeUrl(
      str(raw, "website", "site", "personal_website", "web"),
    ),
    summary: str(raw, "summary", "objective", "about"),
    careerLevel: str(raw, "career_level", "careerLevel"),
    primaryDomain: str(raw, "primary_domain", "primaryDomain", "domain"),
    estimatedExperienceYears: num(
      raw,
      "estimated_experience_years",
      "estimatedExperienceYears",
      "years_of_experience",
    ),
    skills: strList(raw, "skills"),
    technicalSkills: strList(raw, "technical_skills", "technicalSkills"),
    softSkills: strList(raw, "soft_skills", "softSkills"),
    programmingLanguages: strList(
      raw,
      "programming_languages",
      "programmingLanguages",
    ),
    frameworks: strList(raw, "frameworks", "libraries"),
    databases: strList(raw, "databases"),
    cloudPlatforms: strList(raw, "cloud_platforms", "cloudPlatforms"),
    tools: strList(raw, "tools", "platforms"),
    certifications: dedupe(cleanCerts),
    achievements: dedupe(rescuedAchievements),
    languages: strList(raw, "languages"),
    projects: rescuedProjects,
    experience: objList(raw, "experience", "work_experience").map(experience),
    education: objList(raw, "education").map(education),
    internships: objList(raw, "internships").map(internship),
  };
}

/**
 * True when the document produced enough structure to be worth showing and
 * scoring. A PDF that is not a résumé (a certificate, a scanned photo, a
 * cover letter) lands here with essentially nothing extracted, and the
 * candidate deserves "this does not look like a résumé" rather than a
 * confident 12/100.
 */
export function looksLikeResume(parsed: ParsedResume): boolean {
  const sections =
    (parsed.experience.length > 0 ? 1 : 0) +
    (parsed.education.length > 0 ? 1 : 0) +
    (parsed.projects.length > 0 ? 1 : 0) +
    (parsed.internships.length > 0 ? 1 : 0) +
    (allSkills(parsed).length >= 3 ? 1 : 0);

  return sections >= 2;
}

/** Every skill the parser found, across the categorised lists, deduped. */
export function allSkills(parsed: ParsedResume): string[] {
  return dedupe([
    ...parsed.skills,
    ...parsed.technicalSkills,
    ...parsed.programmingLanguages,
    ...parsed.frameworks,
    ...parsed.databases,
    ...parsed.cloudPlatforms,
    ...parsed.tools,
  ]);
}
