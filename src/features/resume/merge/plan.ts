import { normalizeGithubUsername } from "@/lib/validations/candidate-profile";
import { allSkills, isGenuineCertification } from "@/features/resume/normalize";
import { newTerms, mergeTermLists } from "@/features/resume/merge/terms";
import {
  joinBullets,
  mergeBullets,
  sameName,
  splitBullets,
  tokenOverlap,
} from "@/features/resume/merge/text";
import type { ParsedResume } from "@/features/resume/types";
import type {
  CandidateDetail,
  EducationView,
  ExperienceView,
  ProjectView,
} from "@/repositories/candidate-detail";

/**
 * The Résumé → Profile merge service.
 *
 * One responsibility: given the profile as it stands and the structured résumé,
 * decide what the profile should become. It does no ingestion, no extraction
 * and no scoring — those are `ingest.ts`, `parse.ts` and `strength.ts`, and
 * nothing here imports them.
 *
 * **Additive by construction.** Every operation this planner can emit is a
 * create, an append, or a fill of a field that is currently empty. There is no
 * op for deleting a row, removing a bullet, or replacing a value the candidate
 * entered — so "the résumé wiped my profile" is not a bug that can be written
 * here, it is a shape that does not exist.
 *
 * Matching uses several signals per entity type and is deliberately
 * conservative: when it cannot tell whether two entries are the same thing, it
 * keeps them separate. A spurious extra row is something a candidate can delete
 * in a second; a wrong merge quietly destroys the entry they wrote.
 *
 * Pure and deterministic — same profile and same résumé, same plan — so every
 * rule below is testable without a database.
 */

/* ─── Plan shape ─────────────────────────────────────────────────────────── */

export type MergeSection =
  | "basic"
  | "links"
  | "education"
  | "experience"
  | "projects"
  | "certifications"
  | "skills";

export type EducationCreate = {
  institutionName: string;
  degree: string | null;
  fieldOfStudy: string | null;
  graduationYear: number | null;
  grade: string | null;
};

/** Only the fields that were empty. Never a field the candidate filled. */
export type EducationUpdate = {
  id: string;
  degree?: string;
  fieldOfStudy?: string;
  graduationYear?: number;
  grade?: string;
};

export type ExperienceCreate = {
  companyName: string;
  title: string;
  employmentType: string | null;
  startedOn: Date;
  endedOn: Date | null;
  isCurrent: boolean;
  description: string | null;
};

export type ExperienceUpdate = {
  id: string;
  employmentType?: string;
  /** The existing bullets plus any genuinely new ones, in that order. */
  description?: string;
};

export type ProjectCreate = {
  title: string;
  description: string | null;
  techStack: string[];
  repoUrl: string | null;
  liveUrl: string | null;
};

export type ProjectUpdate = {
  id: string;
  description?: string;
  /** Existing stack first, then new technologies. Never a replacement. */
  techStack?: string[];
  repoUrl?: string;
  liveUrl?: string;
};

export type CertificationCreate = { name: string; issuer: string };

/**
 * One decision, for debugging a merge that went wrong. Never rendered.
 * `field` is a name; no candidate content is copied into the log.
 */
export type MergeDecision = {
  section: MergeSection;
  action: "created" | "merged" | "skipped-duplicate" | "kept-existing";
  /** Which résumé entry this was about, by its own label. */
  subject: string;
  /** Why, in one short phrase. */
  reason: string;
};

export type MergePlan = {
  basic: { headline?: string; summary?: string; locationCity?: string };
  links: { linkedinUrl?: string; githubUsername?: string; portfolioUrl?: string };
  education: { create: EducationCreate[]; update: EducationUpdate[] };
  experience: { create: ExperienceCreate[]; update: ExperienceUpdate[] };
  projects: { create: ProjectCreate[]; update: ProjectUpdate[] };
  certifications: { create: CertificationCreate[] };
  /** Free-text names, already de-duplicated against existing claims. */
  skillNames: string[];
  sections: MergeSection[];
  decisions: MergeDecision[];
};

/* ─── Small helpers ──────────────────────────────────────────────────────── */

function empty(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function clean(value: string | null, max: number): string | null {
  if (empty(value)) return null;
  const trimmed = value!.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Infers issuer name from standard certification titles.
 * Returns an empty string if unknown so the field remains honest and user-editable.
 */
export function inferCertificationIssuer(name: string): string {
  if (/\b(?:aws|amazon web services)\b/i.test(name)) return "Amazon Web Services";
  if (/\b(?:gcp|google cloud|google)\b/i.test(name)) return "Google";
  if (/\b(?:azure|microsoft)\b/i.test(name)) return "Microsoft";
  if (/\b(?:meta|facebook)\b/i.test(name)) return "Meta";
  if (/\b(?:cisco|ccna|ccnp)\b/i.test(name)) return "Cisco";
  if (/\b(?:comptia)\b/i.test(name)) return "CompTIA";
  if (/\b(?:oracle)\b/i.test(name)) return "Oracle";
  if (/\b(?:databricks)\b/i.test(name)) return "Databricks";
  if (/\b(?:red hat|redhat)\b/i.test(name)) return "Red Hat";
  if (/\b(?:docker)\b/i.test(name)) return "Docker";
  if (/\b(?:kubernetes|cncf|cka|ckad|cks)\b/i.test(name)) return "CNCF";
  if (/\b(?:hashicorp|terraform)\b/i.test(name)) return "HashiCorp";
  if (/\b(?:salesforce)\b/i.test(name)) return "Salesforce";
  if (/\b(?:pmp|pmi)\b/i.test(name)) return "PMI";
  if (/\b(?:coursera)\b/i.test(name)) return "Coursera";
  if (/\b(?:udemy)\b/i.test(name)) return "Udemy";
  if (/\b(?:deeplearning\.ai)\b/i.test(name)) return "DeepLearning.AI";
  if (/\b(?:freecodecamp)\b/i.test(name)) return "freeCodeCamp";

  const byMatch = /\s+(?:by|from|-|\|)\s+([A-Za-z0-9\s&.]+?)(?:\s*\(.*?\))?$/i.exec(name);
  if (byMatch && byMatch[1] && byMatch[1].trim().length >= 2 && byMatch[1].trim().length <= 50) {
    return byMatch[1].trim();
  }
  return "";
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Reads a free-text duration ("Jun 2022 – Aug 2023", "2023 - Present").
 *
 * `CandidateExperience.startedOn` is NOT NULL, so a role whose duration carries
 * no year cannot be created — it is skipped rather than dated with a guess.
 * Inventing a start date puts a false fact on a profile a recruiter reads.
 */
export function readDuration(duration: string | null): {
  startedOn: Date;
  endedOn: Date | null;
  isCurrent: boolean;
} | null {
  if (empty(duration)) return null;
  const text = duration!.toLowerCase();

  const years = [...text.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  if (years.length === 0) return null;

  const months = [
    ...text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/g),
  ].map((m) => MONTHS[m[1]!]!);

  const startedOn = new Date(Date.UTC(years[0]!, (months[0] ?? 1) - 1, 1));

  if (/present|current|now|ongoing/.test(text)) {
    return { startedOn, endedOn: null, isCurrent: true };
  }
  const endYear = years[1];
  if (endYear === undefined) return { startedOn, endedOn: null, isCurrent: false };
  const endedOn = new Date(Date.UTC(endYear, (months[1] ?? 12) - 1, 1));
  // A range that reads backwards is an extraction artefact, not a fact.
  if (endedOn < startedOn) return { startedOn, endedOn: null, isCurrent: false };
  return { startedOn, endedOn, isCurrent: false };
}

/**
 * The graduation year out of an education year field.
 *
 * Résumés write this as a RANGE more often than as a single year — "2018 -
 * 2022", "2018–22", "Aug 2019 to May 2023" — and the graduation year is the
 * LAST one, not the first. Taking the first match put every candidate's start
 * year on their profile as the year they graduated.
 */
function yearOf(value: string | null): number | null {
  if (empty(value)) return null;
  const matches = [...value!.matchAll(/\b(19|20)\d{2}\b/g)].map((m) =>
    Number(m[0]),
  );
  const inRange = matches.filter((y) => y >= 1950 && y <= 2040);
  if (inRange.length === 0) return null;
  return inRange[inRange.length - 1]!;
}

/* ─── Entity matching ────────────────────────────────────────────────────── */

/**
 * Same education entry: the institution matches, AND either the degree looks
 * like the same qualification or the graduation years agree.
 *
 * Institution alone is not enough — a BSc and an MSc at the same university are
 * two entries, not one.
 */
export function matchEducation(
  rows: readonly EducationView[],
  incoming: { institution: string | null; degree: string | null; year: number | null },
): EducationView | null {
  for (const row of rows) {
    if (!sameName(row.institutionName, incoming.institution, 0.7)) continue;

    const degreeMatches =
      !empty(row.degree) && !empty(incoming.degree)
        ? tokenOverlap(row.degree!, incoming.degree!) >= 0.5
        : false;
    const yearMatches =
      row.graduationYear !== null &&
      incoming.year !== null &&
      Math.abs(row.graduationYear - incoming.year) <= 1;
    // Nothing to tell them apart by: one row at that institution, and neither
    // side states a degree or a year. Treating it as the same entry is the
    // reading that does not duplicate.
    const undecidable =
      empty(row.degree) && empty(incoming.degree) &&
      row.graduationYear === null && incoming.year === null;

    if (degreeMatches || yearMatches || undecidable) return row;
  }
  return null;
}

/**
 * Same position: the company matches, AND either the title looks like the same
 * role or the start dates agree.
 *
 * The company-alone case is explicitly NOT a match. Two different roles at one
 * employer are two legitimate entries, and merging them would erase a
 * promotion.
 */
export function matchExperience(
  rows: readonly ExperienceView[],
  incoming: { company: string | null; title: string | null; startedOn: Date | null },
): ExperienceView | null {
  for (const row of rows) {
    if (!sameName(row.companyName, incoming.company, 0.7)) continue;

    const titleMatches =
      !empty(incoming.title) && tokenOverlap(row.title, incoming.title!) >= 0.6;
    const startMatches =
      incoming.startedOn !== null &&
      Math.abs(row.startYear - incoming.startedOn.getUTCFullYear()) <= 1;

    if (titleMatches || startMatches) return row;
  }
  return null;
}

/**
 * Same project: the same repository link, or a title that reads as the same
 * name, or a near-identical name backed by an overlapping stack.
 */
export function matchProject(
  rows: readonly ProjectView[],
  incoming: { title: string | null; repoUrl: string | null; tech: readonly string[] },
): ProjectView | null {
  const repo = incoming.repoUrl?.trim().toLowerCase().replace(/\/+$/, "");
  if (repo) {
    const byRepo = rows.find(
      (r) => r.repoUrl?.trim().toLowerCase().replace(/\/+$/, "") === repo,
    );
    if (byRepo) return byRepo;
  }
  if (empty(incoming.title)) return null;

  for (const row of rows) {
    const overlap = tokenOverlap(row.title, incoming.title!);
    if (overlap >= 0.8) return row;
    // A weaker name match is only trusted when the stacks agree too.
    if (overlap >= 0.5) {
      const shared = newTerms(row.techStack, incoming.tech).length;
      if (incoming.tech.length > 0 && shared < incoming.tech.length) return row;
    }
  }
  return null;
}

/* ─── The planner ────────────────────────────────────────────────────────── */

export function planResumeMerge(
  parsed: ParsedResume,
  detail: CandidateDetail,
): MergePlan {
  const decisions: MergeDecision[] = [];
  const sections = new Set<MergeSection>();

  /* ── Basic: fill empty fields only ──────────────────────────────────── */
  const basic: MergePlan["basic"] = {};
  if (empty(detail.headline) && !empty(parsed.headline)) {
    basic.headline = clean(parsed.headline, 160)!;
  }
  if (empty(detail.summary) && !empty(parsed.summary)) {
    basic.summary = clean(parsed.summary, 2000)!;
  }
  if (empty(detail.locationCity) && !empty(parsed.location)) {
    basic.locationCity = clean(parsed.location!.split(",")[0] ?? null, 120)!;
  }
  // Phone and email are never written from a document. `phoneVerified` hangs
  // off the phone number, and the account email is the identity Auth.js issued
  // — a résumé must not be able to change either.
  if (Object.keys(basic).length > 0) sections.add("basic");

  /* ── Links: fill empty fields only, never replace ───────────────────── */
  const links: MergePlan["links"] = {};
  if (empty(detail.linkedinUrl) && !empty(parsed.linkedin)) {
    links.linkedinUrl = clean(parsed.linkedin, 500)!;
  } else if (!empty(detail.linkedinUrl) && !empty(parsed.linkedin)) {
    decisions.push({
      section: "links",
      action: "kept-existing",
      subject: "linkedin",
      reason: "profile already has a link",
    });
  }
  if (empty(detail.githubUsername) && !empty(parsed.github)) {
    const username = normalizeGithubUsername(parsed.github!);
    if (username) links.githubUsername = username;
  }
  const portfolio = parsed.portfolio ?? parsed.website;
  if (empty(detail.portfolioUrl) && !empty(portfolio)) {
    links.portfolioUrl = clean(portfolio, 500)!;
  }
  if (Object.keys(links).length > 0) sections.add("links");

  /* ── Education: match, then merge or append ─────────────────────────── */
  const eduCreate: EducationCreate[] = [];
  const eduUpdate: EducationUpdate[] = [];
  const eduSeen: EducationView[] = [...detail.education];

  for (const e of parsed.education) {
    const institution = clean(e.institution, 200);
    if (!institution) continue;
    const incoming = {
      institution,
      degree: clean(e.degree, 200),
      year: yearOf(e.year),
    };
    const match = matchEducation(eduSeen, incoming);

    if (match) {
      const update: EducationUpdate = { id: match.id };
      if (empty(match.degree) && incoming.degree) update.degree = incoming.degree;
      if (empty(match.fieldOfStudy) && !empty(e.branch)) {
        update.fieldOfStudy = clean(e.branch, 200)!;
      }
      if (match.graduationYear === null && incoming.year !== null) {
        update.graduationYear = incoming.year;
      }
      if (empty(match.grade) && !empty(e.cgpa)) update.grade = clean(e.cgpa, 40)!;

      if (Object.keys(update).length > 1) {
        eduUpdate.push(update);
        decisions.push({
          section: "education",
          action: "merged",
          subject: institution,
          reason: "same institution and qualification",
        });
      } else {
        decisions.push({
          section: "education",
          action: "skipped-duplicate",
          subject: institution,
          reason: "already complete",
        });
      }
      continue;
    }

    const created: EducationCreate = {
      institutionName: institution,
      degree: incoming.degree,
      fieldOfStudy: clean(e.branch, 200),
      graduationYear: incoming.year,
      grade: clean(e.cgpa, 40),
    };
    eduCreate.push(created);
    // Later résumé rows must not re-match a row that exists only in this plan;
    // they are compared against a stand-in with no id and never updated.
    eduSeen.push({
      id: "",
      institutionName: created.institutionName,
      collegeId: null,
      degree: created.degree,
      fieldOfStudy: created.fieldOfStudy,
      startMonth: null,
      startYear: null,
      endMonth: null,
      graduationYear: created.graduationYear,
      isCurrent: false,
      gradeType: null,
      grade: created.grade,
      description: null,
    });
    decisions.push({
      section: "education",
      action: "created",
      subject: institution,
      reason: "no matching entry",
    });
  }
  if (eduCreate.length > 0 || eduUpdate.length > 0) sections.add("education");

  /* ── Experience: match on company AND (title OR dates) ──────────────── */
  const expCreate: ExperienceCreate[] = [];
  const expUpdate: ExperienceUpdate[] = [];
  const expSeen: ExperienceView[] = [...detail.experience];

  const incomingRoles = [
    ...parsed.experience.map((e) => ({
      company: e.company,
      title: e.title,
      employmentType: e.employmentType,
      duration: e.duration,
      bullets: [...e.achievements, ...e.responsibilities],
    })),
    ...parsed.internships.map((i) => ({
      company: i.company,
      title: i.role,
      employmentType: "Internship" as string | null,
      duration: i.duration,
      bullets: i.summary ? [i.summary] : [],
    })),
  ];

  for (const role of incomingRoles) {
    const companyName = clean(role.company, 200);
    const title = clean(role.title, 200);
    if (!companyName || !title) continue;
    const dates = readDuration(role.duration);
    const bullets = role.bullets.map((b) => b.trim()).filter(Boolean);

    const match = matchExperience(expSeen, {
      company: companyName,
      title,
      startedOn: dates?.startedOn ?? null,
    });

    if (match) {
      const update: ExperienceUpdate = { id: match.id };
      if (empty(match.employmentType) && !empty(role.employmentType)) {
        update.employmentType = clean(role.employmentType, 60)!;
      }
      const existingBullets = splitBullets(match.description);
      const { merged, added } = mergeBullets(existingBullets, bullets);
      if (added > 0) update.description = joinBullets(merged)!;

      if (Object.keys(update).length > 1) {
        expUpdate.push(update);
        decisions.push({
          section: "experience",
          action: "merged",
          subject: `${title} @ ${companyName}`,
          reason: added > 0 ? `${added} new bullet(s)` : "filled empty field",
        });
      } else {
        decisions.push({
          section: "experience",
          action: "skipped-duplicate",
          subject: `${title} @ ${companyName}`,
          reason: "nothing new",
        });
      }
      continue;
    }

    // No match, and no usable start date: the row cannot be created without
    // inventing `startedOn`, so it is dropped rather than fabricated.
    if (!dates) {
      decisions.push({
        section: "experience",
        action: "kept-existing",
        subject: `${title} @ ${companyName}`,
        reason: "no readable dates",
      });
      continue;
    }

    expCreate.push({
      companyName,
      title,
      employmentType: clean(role.employmentType, 60),
      startedOn: dates.startedOn,
      endedOn: dates.endedOn,
      isCurrent: dates.isCurrent,
      description: joinBullets(bullets.slice(0, 8)),
    });
    expSeen.push({
      id: "",
      companyName,
      title,
      employmentType: role.employmentType,
      locationCity: null,
      startMonth: dates.startedOn.getUTCMonth() + 1,
      startYear: dates.startedOn.getUTCFullYear(),
      endMonth: null,
      endYear: dates.endedOn?.getUTCFullYear() ?? null,
      isCurrent: dates.isCurrent,
      totalMonths: 0,
      description: joinBullets(bullets),
    });
    decisions.push({
      section: "experience",
      action: "created",
      subject: `${title} @ ${companyName}`,
      reason: "no matching position",
    });
  }
  if (expCreate.length > 0 || expUpdate.length > 0) sections.add("experience");

  /* ── Projects: match on repo, name, or name + stack ─────────────────── */
  const projCreate: ProjectCreate[] = [];
  const projUpdate: ProjectUpdate[] = [];
  const projSeen: ProjectView[] = [...detail.projects];

  for (const p of parsed.projects) {
    const title = clean(p.title, 200);
    if (!title) continue;
    const tech = p.technologies.map((t) => t.trim()).filter(Boolean).slice(0, 20);
    const description =
      clean(p.description, 2000) ?? joinBullets(p.contributions.slice(0, 6));
    const repoUrl = clean(p.github, 500);
    const liveUrl = clean(p.demo, 500);

    const match = matchProject(projSeen, { title, repoUrl, tech });

    if (match) {
      const update: ProjectUpdate = { id: match.id };
      if (empty(match.description) && description) update.description = description;
      const stack = mergeTermLists(match.techStack, tech);
      if (stack.length > match.techStack.length) update.techStack = stack.slice(0, 20);
      if (empty(match.repoUrl) && repoUrl) update.repoUrl = repoUrl;
      if (empty(match.liveUrl) && liveUrl) update.liveUrl = liveUrl;

      if (Object.keys(update).length > 1) {
        projUpdate.push(update);
        decisions.push({
          section: "projects",
          action: "merged",
          subject: title,
          reason: "same project",
        });
      } else {
        decisions.push({
          section: "projects",
          action: "skipped-duplicate",
          subject: title,
          reason: "nothing new",
        });
      }
      continue;
    }

    projCreate.push({ title, description, techStack: tech, repoUrl, liveUrl });
    projSeen.push({
      id: "",
      title,
      description,
      techStack: tech,
      repoUrl,
      liveUrl,
    });
    decisions.push({
      section: "projects",
      action: "created",
      subject: title,
      reason: "no matching project",
    });
  }
  if (projCreate.length > 0 || projUpdate.length > 0) sections.add("projects");

  /* ── Certifications: append what is new ─────────────────────────────── */
  const existingCerts = detail.certifications.map((c) => c.name);
  const incomingCerts = parsed.certifications
    .map((c) => clean(c, 200))
    .filter((c): c is string => c !== null && isGenuineCertification(c));

  const certCreate: CertificationCreate[] = [];
  const certSeen = [...existingCerts];
  for (const name of incomingCerts) {
    if (certSeen.some((e) => sameName(e, name, 0.85))) {
      decisions.push({
        section: "certifications",
        action: "skipped-duplicate",
        subject: name,
        reason: "already listed",
      });
      continue;
    }
    certSeen.push(name);
    const issuer = inferCertificationIssuer(name);
    certCreate.push({ name, issuer });
    decisions.push({
      section: "certifications",
      action: "created",
      subject: name,
      reason: "not already listed",
    });
    if (certCreate.length >= 20) break;
  }
  if (certCreate.length > 0) sections.add("certifications");

  /* ── Skills: canonical de-duplication against existing claims ───────── */
  const claimedNames = detail.skills.flatMap((s) => [s.name, s.slug]);
  const skillNames = newTerms(claimedNames, allSkills(parsed))
    .filter((s) => s.length > 1 && s.length <= 80)
    .slice(0, 60);
  if (skillNames.length > 0) sections.add("skills");

  return {
    basic,
    links,
    education: { create: eduCreate, update: eduUpdate },
    experience: { create: expCreate, update: expUpdate },
    projects: { create: projCreate, update: projUpdate },
    certifications: { create: certCreate },
    skillNames,
    sections: [...sections],
    decisions,
  };
}

/** Candidate-facing labels for the sections a résumé contributed to. */
export const SECTION_LABELS: Record<MergeSection, string> = {
  basic: "Basic information",
  links: "Links",
  education: "Education",
  experience: "Experience",
  projects: "Projects",
  certifications: "Certifications",
  skills: "Skills",
};
