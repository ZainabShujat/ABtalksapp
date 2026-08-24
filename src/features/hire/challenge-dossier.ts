import "server-only";

import { Domain } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encodeCandidateRef } from "@/features/hire/candidate-ref";
import { computeCoverage, loadAvailabilityByUserId } from "@/features/hire/dossier";
import {
  declared,
  derived,
  verified,
} from "@/features/hire/dossier-provenance";
import { candidatePublicId } from "@/features/hire/public-id";
import { roleFamilyFor, tidyRoleLabel, type RoleFamily } from "@/features/hire/role-family";
import type { CandidateDossier, EvidenceCoverage } from "@/features/hire/types";

/**
 * The 60-day challenge cohort, assembled into the same dossier the program
 * pool produces.
 *
 * Same rubric, different evidence. A program member is measured against 31 days
 * of graded missions, a graded project and an exit interview; a challenge
 * participant is measured against 60 days of daily submissions, each one carrying
 * a GitHub URL the platform recorded at the time. Neither has to be translated
 * into the other — the dossier carries a provenance per field, and the coverage
 * it returns says which dimensions this track can produce at all.
 *
 * Given name is loaded for the card. Email, phone, college, GitHub handle,
 * LinkedIn URL, and submission URLs stay off the dossier. `links` reports that
 * a GitHub exists, never where.
 */

/** How long the challenge runs. The denominator for missions and consistency. */
export const CHALLENGE_TOTAL_DAYS = 60;

export type ChallengeDossierSet = {
  dossiers: CandidateDossier[];
  coverage: EvidenceCoverage;
  /** Days elapsed since the candidate started, capped at the track length. */
  dayByUser: Map<string, number>;
  /** Given name only — never email or profile URLs. */
  nameByUser: Map<string, string>;
};

const EMPTY: ChallengeDossierSet = {
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
    note: "No challenge candidates in the pool yet.",
  },
  dayByUser: new Map(),
  nameByUser: new Map(),
};

/** English glue that is never a skill, however it was typed. */
const NOT_A_SKILL = new Set([
  "and",
  "or",
  "with",
  "using",
  "for",
  "the",
  "in",
  "on",
  "of",
  "etc",
  "etc.",
  "basic",
  "basics",
]);         

/**
 * Skills as typed, split into skills.
 *
 * The column is `String[]`, but the registration form let people paste, so a
 * real row reads `["php mysql react-js  js  html css python"]` — one array
 * entry holding seven skills, which matches nothing a recruiter searches for.
 *
 * Three rules, each earned from a real row:
 *
 * - Punctuation and the word "and" always separate. `"C++ Git and GitHub"` is a
 *   list, and a list is what the recruiter is searching against.
 * - Whitespace separates only in an entry of **four or more** words. Three-word
 *   skills are real — "Full Stack Development" — while four-word entries in
 *   this data are always a paste: `"HTML CSS JAVASCRIPT JAVA"`.
 * - Glue words are dropped, so nobody's profile claims "and" as a skill.
 *
 * Single letters survive: "C" and "R" are languages. What stops them matching
 * everything is `containsWord` in the scorer, not a filter here.
 */


export function splitSkills(raw: string[]): string[] {
  const out: string[] = [];
  for (const entry of raw) {
    for (const part of entry.split(/[,;/|]+|\s+(?:and|&)\s+/i)) {
      const token = part.trim().replace(/\s+/g, " ");
      if (!token) continue;
      const words = token.split(" ");
      const pieces = words.length >= 4 ? words : [token];
      for (const p of pieces) {
        if (!p || NOT_A_SKILL.has(p.toLowerCase())) continue;
        out.push(p);
      }
    }
  }
  // Case-insensitive dedupe, first spelling wins — "React" and "react" are one
  // skill and the recruiter should not see both.
  const seen = new Set<string>();
  return out.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Years of experience, declared or inferred from when they graduate.
 *
 * 550 of these people are working professionals who stated a number. The other
 * 2,454 are students who never saw the field, and treating them all as zero
 * would put a final-year student and a first-year on the same line. A
 * graduation year in the future means they are still studying: zero, honestly.
 */
export function yearsFor(
  declaredYears: number | null,
  graduationYear: number | null,
  now = new Date(),
): number {
  if (declaredYears != null && declaredYears >= 0) return declaredYears;
  if (graduationYear == null) return 0;
  const elapsed = now.getFullYear() - graduationYear;
  return elapsed > 0 ? Math.min(elapsed, 50) : 0;
}

/**
 * A role bucket for someone who never stated a role.
 *
 * Only 550 of 3,004 profiles carry a job title, so `roleFamilyFor` returns
 * OTHER for the rest — and OTHER produces no compensation band and groups
 * badly. The track they chose and the skills they typed are the honest fallback:
 * a student enrolled in the DS track listing python and sql is a data candidate
 * on the evidence available, and the dossier marks the whole field DERIVED so
 * nobody reads it as a claim the candidate made.
 */
export function familyFor(
  role: string | null,
  domain: Domain,
  skills: string[],
): RoleFamily {
  const stated = roleFamilyFor(role);
  if (stated !== "OTHER") return stated;

  if (domain === Domain.AI) return "AI_ML";
  if (domain === Domain.DS) return "DATA";

  const lower = skills.map((s) => s.toLowerCase());
  const has = (...needles: string[]) =>
    needles.some((n) => lower.some((s) => s === n || s.includes(n)));

  if (has("machine learning", "tensorflow", "pytorch", "nlp", "genai")) return "AI_ML";
  if (has("power bi", "tableau", "excel", "pandas", "numpy")) return "DATA";
  const front = has("react", "html", "css", "javascript", "js", "next", "angular", "vue");
  const back = has("node", "django", "flask", "spring", "express", "java", "php", "sql");
  if (front && back) return "FULLSTACK";
  if (front) return "FRONTEND";
  if (back) return "BACKEND";

  // Enrolled, still studying, nothing else stated. "Student / fresher" is a
  // truthful bucket; OTHER is a shrug.
  return "STUDENT";
}

/**
 * Build dossiers for challenge participants clearing `minDays` submitted days.
 *
 * Four queries: enrollments with their profile and certificate, submission day
 * numbers, quiz attempts, and any availability rows. Nothing per-candidate.
 */
export async function buildChallengeDossierSet(opts: {
  minDays: number;
  domains?: Domain[];
  limit?: number;
}): Promise<ChallengeDossierSet> {
  const domains = opts.domains ?? [Domain.CLAUDE];

  const enrollments = await prisma.enrollment.findMany({
    where: {
      challenge: { domain: { in: domains } },
      // A candidate is someone with a track record, and the floor is what makes
      // that true. Applied in the query rather than after, so a pool of 2,708
      // never lands in memory to be filtered down to 320.
      submissions: { some: {} },
    },
    select: {
      id: true,
      userId: true,
      domain: true,
      status: true,
      startedAt: true,
      completedAt: true,
      longestStreak: true,
      currentStreak: true,
      certificate: { select: { status: true } },
      _count: { select: { submissions: true } },
      user: {
        select: {
          name: true,
          studentProfile: {
            select: {
              skills: true,
              role: true,
              yearsExperience: true,
              graduationYear: true,
              domain: true,
              linkedinUrl: true,
              githubUsername: true,
              resumeUrl: true,
            },
          },
        },
      },
    },
  });

  const eligible = enrollments.filter(
    (e) => e._count.submissions >= opts.minDays,
  );
  if (eligible.length === 0) return EMPTY;

  // Ranked by evidence before the cap, so a limit never trims the best people.
  eligible.sort((a, b) => b._count.submissions - a._count.submissions);
  const rows = opts.limit ? eligible.slice(0, opts.limit) : eligible;

  const userIds = rows.map((e) => e.userId);
  const [lastSubmissions, quiz, availability] = await Promise.all([
    prisma.submission.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
      _max: { submittedAt: true, dayNumber: true },
      _min: { submittedAt: true },
    }),
    prisma.quizAttempt.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
      _avg: { score: true },
      _count: true,
    }),
    loadAvailabilityByUserId(userIds),
  ]);

  const activity = new Map(lastSubmissions.map((s) => [s.userId, s]));
  const quizByUser = new Map(quiz.map((q) => [q.userId, q]));

  const dayByUser = new Map<string, number>();
  const nameByUser = new Map<string, string>();
  const dossiers: CandidateDossier[] = [];
  const now = new Date();

  for (const e of rows) {
    const p = e.user.studentProfile;
    const act = activity.get(e.userId);
    const q = quizByUser.get(e.userId);

    const daysSubmitted = e._count.submissions;
    const lastActiveAt = act?._max.submittedAt ?? null;
    const firstActiveAt = act?._min.submittedAt ?? e.startedAt;

    // How far into the challenge this person is. Their own elapsed time, not a
    // shared cohort clock — challenge enrolment is rolling, so two candidates
    // on day 30 may have started months apart, and each is measured against the
    // days they have actually had.
    const elapsed = Math.max(
      1,
      Math.min(
        CHALLENGE_TOTAL_DAYS,
        Math.floor((now.getTime() - e.startedAt.getTime()) / 86_400_000) + 1,
      ),
    );
    dayByUser.set(e.userId, elapsed);
    const given = e.user.name?.trim();
    if (given) nameByUser.set(e.userId, given);

    const activeSpan =
      lastActiveAt && firstActiveAt
        ? Math.round(
            (lastActiveAt.getTime() - firstActiveAt.getTime()) / 86_400_000,
          ) + 1
        : daysSubmitted;

    const skills = splitSkills(p?.skills ?? []);
    const family = familyFor(p?.role ?? null, e.domain, skills);
    const av = availability.get(e.userId) ?? null;

    dossiers.push({
      publicId: candidatePublicId(e.userId),
      source: e.domain === Domain.CLAUDE ? "CLAUDE" : "CHALLENGE_60",
      candidateRef: encodeCandidateRef(
        e.domain === Domain.CLAUDE ? "CLAUDE" : "CHALLENGE_60",
        e.userId,
      ),
      // No ProgramMember row exists for these people, and inventing one would
      // break the foreign key the moment a match is persisted.
      programMemberId: null,
      userId: e.userId,

      roleFamily: derived(family),
      rawRoleLabel: p?.role ? declared(tidyRoleLabel(p.role)) : derived("Not stated"),
      yearsExperience: declared(
        yearsFor(p?.yearsExperience ?? null, p?.graduationYear ?? null, now),
      ),
      education: declared({
        level: null,
        // The university name is identifying enough to be worth withholding
        // until an introduction is agreed, and it is not scored either way.
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
        // Every submitted day was checked and recorded against a GitHub URL at
        // the time. That is the verified unit on this track.
        missionsPassed: verified(daysSubmitted, lastActiveAt),
        missionsAttempted: verified(daysSubmitted, lastActiveAt),
        missionsWaived: verified(0),
        // The challenge logs a submission; it does not re-run it, so there is
        // no attempt count to read a first-attempt rate from. Zero here means
        // "not measured", and `computeCoverage` drops the dimension because of
        // it rather than scoring anyone down.
        cleanPassCount: verified(0),
        cleanPassPct: derived(0),
        // Daily submission over consecutive days is this track's showing-up
        // signal — the same thing commit days measure for the cohort.
        commitDays: verified(e.longestStreak, lastActiveAt),
        activeDaysSpan: derived(activeSpan),
        lastActiveAt: verified(lastActiveAt ? lastActiveAt.toISOString() : null),
        projectScores: verified([]),
        interview: verified(null),
        // `DailyTask` carries no language, so there is nothing to derive. An
        // absent chip is better than a guessed one.
        workingLanguages: derived([]),
        missionTypesPassed: verified([]),
        cohortProgress: derived({ day: elapsed, ofDays: CHALLENGE_TOTAL_DAYS }),
        certificateIssued: verified(e.certificate?.status === "ISSUED"),
        quizAverage: verified(
          q && q._count > 0 && q._avg.score != null
            ? Math.round(q._avg.score * 10) / 10
            : null,
        ),
      },

      compensation: {
        declared:
          av?.expectedSalaryMin != null || av?.expectedSalaryMax != null
            ? {
                min: av.expectedSalaryMin ?? 0,
                max: av.expectedSalaryMax ?? av.expectedSalaryMin ?? 0,
                currency: av.salaryCurrency,
              }
            : null,
        estimate: null,
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
          }
        : null,
    });
  }

  const coverage = computeCoverage(dossiers);
  return {
    dossiers,
    coverage: {
      dimensions: coverage.dimensions,
      note:
        "Ranked on verified daily submissions, streak and declared skills. " +
        "The 60-day challenge records what was submitted each day, not how many " +
        "attempts it took, and it has no graded project or exit interview — so " +
        "those dimensions are excluded rather than counted as zero.",
    },
    dayByUser,
    nameByUser,
  };
}
