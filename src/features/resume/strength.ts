/**
 * Résumé Strength Score.
 *
 * **This is not an ATS score and not a job match.** No job description is read
 * here, none is accepted as an argument, and none ever should be — JD matching
 * is a separate future feature with a separate score. This function judges the
 * résumé on its own terms: is it complete, is it written well, does it show
 * measurable impact, is it structured, are the claimed skills evidenced.
 *
 * Deterministic and pure. No model call, no clock, no randomness — the same
 * `ParsedResume` always produces the same number, which is what makes the
 * breakdown defensible to a candidate who asks "why 61?".
 *
 * Methodology is documented in `docs/plans/106-resume-upload-parsing-and-strength.md`
 * and mirrored in the per-category comments below.
 */
import {
  STRENGTH_CATEGORIES,
  type ParsedResume,
  type ResumeAnalysis,
  type StrengthCategories,
} from "@/features/resume/types";
import { allSkills } from "@/features/resume/normalize";

/** Bumped whenever a rule below changes, so stored rows stay identifiable. */
export const STRENGTH_VERSION = 1;

const WEIGHT_TOTAL = STRENGTH_CATEGORIES.reduce((n, c) => n + c.weight, 0);
if (WEIGHT_TOTAL !== 100) {
  // Fails at import, not at scoring time, so a bad edit cannot ship a score
  // that is quietly incapable of reaching 100.
  throw new Error(
    `Résumé strength weights must sum to 100, got ${WEIGHT_TOTAL}`,
  );
}

/* ─── Text helpers ───────────────────────────────────────────────────────── */

const STRONG_VERBS = new Set([
  "achieved", "architected", "automated", "built", "collaborated", "consolidated",
  "converted", "created", "cut", "delivered", "deployed", "designed", "developed",
  "diagnosed", "doubled", "drove", "engineered", "enhanced", "established",
  "expanded", "grew", "implemented", "improved", "increased", "initiated",
  "integrated", "introduced", "launched", "led", "maintained", "migrated",
  "mentored", "modernised", "modernized", "optimised", "optimized", "orchestrated",
  "owned", "presented", "prototyped", "published", "recovered", "redesigned",
  "reduced", "refactored", "resolved", "restructured", "scaled", "shipped",
  "simplified", "solved", "streamlined", "strengthened", "tested", "trained",
  "translated", "wrote",
]);

const FILLER = /\b(responsible for|worked on|helped with|involved in|assisted in|duties included|tasked with|part of a team)\b/i;

/**
 * A bullet counts as quantified when it carries a real magnitude. Four-digit
 * years are stripped first — "Backend engineer, 2023-2024" is a date, not an
 * outcome, and letting it score would make almost every résumé look measured.
 */
function isQuantified(text: string): boolean {
  if (/\d\s*%/.test(text)) return true;
  if (/[₹$€£]\s*\d/.test(text)) return true;
  const withoutYears = text.replace(/\b(19|20)\d{2}\b/g, " ");
  return /\d/.test(withoutYears);
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function startsWithStrongVerb(text: string): boolean {
  const first = text.trim().split(/\s+/)[0] ?? "";
  return STRONG_VERBS.has(first.replace(/[^a-zA-Z]/g, "").toLowerCase());
}

/** 0-1, linear, saturating at `target`. */
function ratio(value: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, value / target));
}

function pct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function share(matching: number, total: number): number {
  return total === 0 ? 0 : matching / total;
}

/* ─── Derived signals ────────────────────────────────────────────────────── */

type Signals = {
  bullets: string[];
  quantifiedBullets: number;
  wellSizedBullets: number;
  verbLedBullets: number;
  fillerBullets: number;
  longestBulletWords: number;
  roles: number;
  projects: number;
  items: number;
  itemsWithDetail: number;
  itemsWithTech: number;
  projectsWithLink: number;
  rolesWithDates: number;
  skills: string[];
  evidencedSkills: number;
  sectionCount: number;
};

function collectSignals(r: ParsedResume): Signals {
  const bullets = [
    ...r.experience.flatMap((e) => [...e.responsibilities, ...e.achievements]),
    ...r.projects.flatMap((p) => p.contributions),
    ...r.internships.map((i) => i.summary ?? "").filter(Boolean),
    ...r.achievements,
  ].filter((b) => b.trim().length > 0);

  const roles = r.experience.length + r.internships.length;
  const projects = r.projects.length;

  const detailOf = [
    ...r.experience.map(
      (e) => e.responsibilities.length + e.achievements.length,
    ),
    ...r.projects.map(
      (p) => p.contributions.length + (p.description ? 1 : 0),
    ),
    ...r.internships.map((i) => (i.summary ? 1 : 0)),
  ];
  const techOf = [
    ...r.experience.map((e) => e.technologies.length),
    ...r.projects.map((p) => p.technologies.length),
    ...r.internships.map(() => 0),
  ];

  const skills = allSkills(r);
  const evidenceHaystack = [
    ...r.experience.flatMap((e) => [
      ...e.responsibilities,
      ...e.achievements,
      ...e.technologies,
      e.title ?? "",
    ]),
    ...r.projects.flatMap((p) => [
      ...p.contributions,
      ...p.technologies,
      p.description ?? "",
      p.title ?? "",
    ]),
    ...r.internships.map((i) => i.summary ?? ""),
    ...r.certifications,
  ]
    .join(" \n ")
    .toLowerCase();

  const evidencedSkills = skills.filter((s) => {
    const needle = s.trim().toLowerCase();
    if (needle.length < 2) return false;
    return evidenceHaystack.includes(needle);
  }).length;

  const sectionCount =
    (r.experience.length > 0 ? 1 : 0) +
    (r.education.length > 0 ? 1 : 0) +
    (r.projects.length > 0 ? 1 : 0) +
    (skills.length > 0 ? 1 : 0) +
    (r.certifications.length > 0 ? 1 : 0) +
    (r.internships.length > 0 ? 1 : 0);

  return {
    bullets,
    quantifiedBullets: bullets.filter(isQuantified).length,
    wellSizedBullets: bullets.filter((b) => {
      const w = words(b);
      return w >= 8 && w <= 35;
    }).length,
    verbLedBullets: bullets.filter(startsWithStrongVerb).length,
    fillerBullets: bullets.filter((b) => FILLER.test(b)).length,
    longestBulletWords: bullets.reduce((m, b) => Math.max(m, words(b)), 0),
    roles,
    projects,
    items: roles + projects,
    itemsWithDetail: detailOf.filter((n) => n >= 2).length,
    itemsWithTech: techOf.filter((n) => n >= 1).length,
    projectsWithLink: r.projects.filter((p) => p.github || p.demo).length,
    rolesWithDates: r.experience.filter((e) => Boolean(e.duration)).length,
    skills,
    evidencedSkills,
    sectionCount,
  };
}

/* ─── Categories ─────────────────────────────────────────────────────────── */

/** Presence of the sections a reader expects. Weighted by what matters most. */
function scoreCompleteness(r: ParsedResume, s: Signals): number {
  let n = 0;
  if (r.candidateName && r.email) n += 15;
  if (r.phone || r.location) n += 5;
  if ((r.summary ?? "").trim().length >= 40) n += 15;
  if (r.education.length > 0) n += 15;
  if (s.roles > 0) n += 20;
  if (r.projects.length > 0) n += 15;
  if (s.skills.length >= 5) n += 10;
  if (r.certifications.length > 0) n += 5;
  return pct(n);
}

/** How the bullets read: enough of them, right length, verb-led, no filler. */
function scoreContentQuality(s: Signals): number {
  if (s.bullets.length === 0) return 0;
  const volume = ratio(s.bullets.length, 10) * 30;
  const sized = share(s.wellSizedBullets, s.bullets.length) * 35;
  const verbs = share(s.verbLedBullets, s.bullets.length) * 25;
  const clean = (1 - share(s.fillerBullets, s.bullets.length)) * 10;
  return pct(volume + sized + verbs + clean);
}

/**
 * Share of bullets carrying a measurable outcome. Half of them earning full
 * marks is deliberate: demanding a number on every line pushes candidates to
 * invent them, which is the opposite of what this score is for.
 */
function scoreImpact(s: Signals): number {
  if (s.bullets.length === 0) return 0;
  return pct(ratio(share(s.quantifiedBullets, s.bullets.length), 0.5) * 100);
}

/** Dates, section coverage, and a readable amount of detail per entry. */
function scoreStructure(r: ParsedResume, s: Signals): number {
  let n = 0;
  n += ratio(s.sectionCount, 4) * 25;

  // Dated entries. Freshers have no roles, so education years stand in rather
  // than costing them a quarter of the category for a section they cannot fill.
  const datedShare =
    r.experience.length > 0
      ? share(s.rolesWithDates, r.experience.length)
      : share(r.education.filter((e) => Boolean(e.year)).length, Math.max(1, r.education.length));
  n += datedShare * 25;

  if (s.items > 0) {
    const perItem = s.bullets.length / s.items;
    n += (perItem >= 2 && perItem <= 6 ? 1 : ratio(perItem, 2)) * 25;
  }

  n += (s.longestBulletWords > 0 && s.longestBulletWords <= 60 ? 1 : 0) * 15;
  if (r.headline || r.summary) n += 10;
  return pct(n);
}

/** Claimed skills that actually show up in the work described. */
function scoreSkillsEvidence(s: Signals): number {
  if (s.skills.length === 0) return 0;
  return pct(ratio(share(s.evidencedSkills, s.skills.length), 0.6) * 100);
}

/** Count and depth of the roles and projects on show. */
function scoreExperienceProjects(r: ParsedResume, s: Signals): number {
  if (s.items === 0) return 0;
  const count = ratio(s.items, 4) * 40;
  const depth = share(s.itemsWithDetail, s.items) * 30;
  const tech = share(s.itemsWithTech, s.items) * 20;
  // Links only apply to projects; with none, the remaining 10 goes to whether
  // the roles at least name their employer.
  const links =
    r.projects.length > 0
      ? share(s.projectsWithLink, r.projects.length) * 10
      : share(r.experience.filter((e) => Boolean(e.company)).length, Math.max(1, r.experience.length)) * 10;
  return pct(count + depth + tech + links);
}

/** The headline and links a recruiter opens first. */
function scoreProfessionalReadiness(r: ParsedResume): number {
  let n = 0;
  if (r.linkedin) n += 30;
  if (r.github) n += 30;
  if (r.portfolio || r.website) n += 20;
  if (r.headline) n += 20;
  return pct(n);
}

/* ─── Narrative ──────────────────────────────────────────────────────────── */

export function scoreBand(overall: number): string {
  if (overall >= 85) return "Excellent";
  if (overall >= 70) return "Strong foundation";
  if (overall >= 55) return "Solid start";
  if (overall >= 40) return "Needs work";
  return "Early draft";
}

function buildNarrative(
  r: ParsedResume,
  s: Signals,
  c: StrengthCategories,
): Pick<ResumeAnalysis, "strengths" | "weaknesses" | "recommendations"> {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recommendations: string[] = [];

  if (c.completeness >= 80) strengths.push("All the expected sections are present");
  if (c.impact >= 70) strengths.push("Your work is described with measurable outcomes");
  if (c.contentQuality >= 75) strengths.push("Bullets are well written and action-led");
  if (s.projects >= 3) strengths.push(`Strong project coverage — ${s.projects} projects listed`);
  if (s.skills.length >= 10 && c.skillsEvidence >= 60)
    strengths.push("Clear technical skills, backed by where you used them");
  if (c.professionalReadiness >= 80) strengths.push("Your profile links are complete");
  if (s.roles >= 2) strengths.push(`${s.roles} roles or internships give real work history`);

  // Weakness + the recommendation that fixes it, kept adjacent so the advice
  // always follows from something actually observed.
  if (s.bullets.length === 0) {
    weaknesses.push("No detail under your roles or projects");
    recommendations.push(
      "Add 2-4 bullet points under each role and project describing what you built and what changed as a result.",
    );
  } else {
    if (c.impact < 55) {
      weaknesses.push("Limited quantified achievements");
      recommendations.push(
        "Add measurable outcomes to your experience bullets — users served, latency cut, time saved, percentage improved.",
      );
    }
    if (share(s.verbLedBullets, s.bullets.length) < 0.5) {
      weaknesses.push("Bullets do not lead with a strong action verb");
      recommendations.push(
        "Start each bullet with a verb like built, shipped, reduced or led, rather than describing your duties.",
      );
    }
    if (s.fillerBullets > 0) {
      weaknesses.push("Some bullets use filler phrasing");
      recommendations.push(
        'Replace phrases like "responsible for" and "worked on" with what you specifically did.',
      );
    }
    if (share(s.wellSizedBullets, s.bullets.length) < 0.6) {
      weaknesses.push("Bullet length is uneven");
      recommendations.push(
        "Aim for roughly 8-35 words per bullet — long enough to be specific, short enough to scan.",
      );
    }
  }

  if (r.projects.length === 0) {
    weaknesses.push("No projects listed");
    recommendations.push(
      "Add at least two projects with a short description, the tech used, and a repository or demo link.",
    );
  } else if (s.projectsWithLink < r.projects.length) {
    recommendations.push(
      "Add a repository or live link to every project so a recruiter can open your work.",
    );
  }

  if (c.skillsEvidence < 50 && s.skills.length > 0) {
    weaknesses.push("Several listed skills are not evidenced anywhere");
    recommendations.push(
      "For each skill you list, make sure at least one project or role bullet shows you using it.",
    );
  }
  if ((r.summary ?? "").trim().length < 40) {
    weaknesses.push("No summary at the top");
    recommendations.push(
      "Add a two-line summary naming your focus area and what you are looking for.",
    );
  }
  if (r.education.length === 0) weaknesses.push("No education section found");
  if (c.professionalReadiness < 60) {
    const missing = [
      !r.linkedin && "LinkedIn",
      !r.github && "GitHub",
      !r.portfolio && !r.website && "a portfolio",
    ].filter(Boolean);
    if (missing.length > 0) {
      weaknesses.push(`Missing links: ${missing.join(", ")}`);
      recommendations.push(
        `Add ${missing.join(" and ")} to the header of your résumé.`,
      );
    }
  }
  if (r.experience.length > 0 && s.rolesWithDates < r.experience.length) {
    recommendations.push("Add start and end dates to every role.");
  }

  return {
    strengths: strengths.slice(0, 5),
    weaknesses: weaknesses.slice(0, 5),
    // 3-5 is the brief. Fewer than three only when the résumé genuinely has
    // fewer than three things wrong with it.
    recommendations: recommendations.slice(0, 5),
  };
}

/* ─── Entry point ────────────────────────────────────────────────────────── */

export function analyseResumeStrength(parsed: ParsedResume): ResumeAnalysis {
  const s = collectSignals(parsed);

  const categories: StrengthCategories = {
    completeness: scoreCompleteness(parsed, s),
    contentQuality: scoreContentQuality(s),
    impact: scoreImpact(s),
    structure: scoreStructure(parsed, s),
    skillsEvidence: scoreSkillsEvidence(s),
    experienceProjectStrength: scoreExperienceProjects(parsed, s),
    professionalReadiness: scoreProfessionalReadiness(parsed),
  };

  const overallScore = pct(
    STRENGTH_CATEGORIES.reduce(
      (sum, c) => sum + categories[c.key] * c.weight,
      0,
    ) / 100,
  );

  return {
    overallScore,
    categories,
    ...buildNarrative(parsed, s, categories),
    version: STRENGTH_VERSION,
  };
}
