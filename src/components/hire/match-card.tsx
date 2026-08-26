"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Info } from "lucide-react";
import { refPublicId, type CandidateSource } from "@/features/hire/candidate-ref";
import { COMPENSATION_DISCLAIMER } from "@/features/hire/compensation";
import { buttonVariants } from "@/components/ui/button";
import { RequestIntroButton } from "@/components/hire/request-intro-button";
import {
  SampleCardNotice,
  type SampleDemand,
} from "@/components/hire/sample-card-notice";
import { ShortlistButton } from "@/components/talent/shortlist-button";
import { cn } from "@/lib/utils";

/** One ranking dimension as the inspector chart reads it. Null ≠ 0. */
export type PublicScoreSlice = {
  stack: number | null;
  missions: number | null;
  cleanPass: number | null;
  projects: number | null;
  consistency: number | null;
  interview: number | null;
  experience: number | null;
};

export type MatchCardData = {
  /** `PROGRAM:<id>` / `CLAUDE:<id>` — what every action on this card addresses. */
  candidateRef: string;
  /** Which track the evidence came from. Decides the wording of the counts:
   *  the cohort passes graded missions, the challenge submits daily work. */
  source?: CandidateSource;
  /** Program members only. Its absence is what hides the cart and the member
   *  profile link, so a challenge candidate cannot reach a page built around a
   *  `ProgramMember` row that does not exist. */
  programMemberId: string | null;
  /**
   * Given name when the pool has one. Contact (email, LinkedIn, GitHub) still
   * stays off this card until an introduction is confirmed.
   */
  displayName?: string | null;
  /**
   * Role family / declared title. Shown under the name, or as the heading
   * when no name is on the record.
   */
  jobRole: string;
  locationLabel?: string | null;
  score: number;
  tier: string;
  rationale: string | null;
  gaps: string[];
  availabilityUnknown: boolean;
  shortlisted?: boolean;
  /** Status of this recruiter's live engagement request, if any. */
  engagementStatus?: string | null;
  /**
   * The seven ranking dimensions, 0–100. `null` means the track cannot
   * produce that evidence — never a zero. Safe to show; it is not identity.
   */
  scores?: PublicScoreSlice;
  evidence: {
    skills?: string[];
    missionPoints?: number;
    /** Missions passed by doing them — excludes the days waived at enrolment.
     *  Prefer this over missionPoints everywhere it is present. */
    missionsPassed?: number;
    missionsAttempted?: number;
    cleanPassCount?: number;
    commitDayCount?: number;
    projectScores?: number[];
    yearsExperience?: number;
    /** Languages of the mission days they passed. Verified, unlike `skills`. */
    workingLanguages?: string[];
    cohortDay?: number;
    /** Finished the track. Verified, and never part of the score. */
    certificateIssued?: boolean;
    /** Mean weekly-quiz score where they sat any. Verified, never scored. */
    quizAverage?: number | null;
    /** How long the track runs — 31 for the cohort, 60 for the challenge. */
    totalTrackDays?: number | null;
    /** Declared education level only — never the university name. */
    educationLevel?: string | null;
    /** Candidate preference (ONSITE / HYBRID / REMOTE / FLEXIBLE). */
    workMode?: string | null;
    /** Booleans, never profile URLs. */
    githubConnected?: boolean;
    linkedinConnected?: boolean;
    interviewOverall?: number | null;
    interviewComm?: number | null;
    interviewTech?: number | null;
    interviewProblem?: number | null;
  };
  /** Pre-formatted "₹6–12 LPA". Candidate-stated when `compensationDeclared`
   *  is true; otherwise an ABTalks estimate — print the disclaimer. */
  compensationBand?: string | null;
  /** True only when `compensationBand` is the candidate's own figure. */
  compensationDeclared?: boolean;
  /** Which evidence dimensions the ranking could use, and which the cohort has
   *  not produced yet. */
  coverageNote?: string | null;
  /** Stack tokens from this search — matching skill chips are pulled forward. */
  highlightSkills?: string[];
};

type TrackKind = "cohort" | "challenge" | "hackathon";

function trackMeta(source?: CandidateSource): {
  label: string | null;
  kind: TrackKind;
  totalDays: number | null;
} {
  switch (source) {
    case "CLAUDE":
      return { label: "Claude", kind: "challenge", totalDays: 60 };
    case "CHALLENGE_60":
      return { label: "60-day", kind: "challenge", totalDays: 60 };
    case "HACKATHON":
      return { label: "Hackathon", kind: "hackathon", totalDays: null };
    case "PROGRAM":
      return { label: "US cohort", kind: "cohort", totalDays: 31 };
    default:
      return { label: null, kind: "cohort", totalDays: null };
  }
}

/** Same word-boundary rule as ranking — "java" must not light up "javascript". */
function skillHighlighted(skill: string, needles: string[]): boolean {
  const hay = skill.toLowerCase();
  return needles.some((n) => {
    const needle = n.toLowerCase().trim();
    if (!needle) return false;
    const i = hay.indexOf(needle);
    if (i === -1) return false;
    const before = i === 0 ? "" : hay[i - 1]!;
    const after = hay[i + needle.length] ?? "";
    const bound = (c: string) => c === "" || !/[a-z0-9]/.test(c);
    return bound(before) && bound(after);
  });
}

function orderedSkills(skills: string[], needles: string[]): string[] {
  if (!needles.length) return skills;
  const hit: string[] = [];
  const rest: string[] = [];
  for (const s of skills) {
    (skillHighlighted(s, needles) ? hit : rest).push(s);
  }
  return [...hit, ...rest];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-base font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export function MatchCard({
  match,
  rank,
  onCartToggle,
  variant = "real",
  sampleDemand,
}: {
  match: MatchCardData;
  /** 1-based position in the ranking; 1 gets the standing glow. */
  rank?: number;
  onCartToggle?: (inCart: boolean) => void;
  /**
   * Sample cards are a reduced card, not a forked one. The real path below
   * does not read this — branching here is how that path stays untouched.
   */
  variant?: "real" | "sample";
  sampleDemand?: SampleDemand;
}) {
  if (variant === "sample") {
    return <SampleMatchCard match={match} sampleDemand={sampleDemand} />;
  }
  return (
    <RealMatchCard
      match={match}
      rank={rank}
      onCartToggle={onCartToggle}
    />
  );
}

function RealMatchCard({
  match,
  rank,
  onCartToggle,
}: {
  match: MatchCardData;
  rank?: number;
  onCartToggle?: (inCart: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const e = match.evidence ?? {};
  const isTop = rank === 1;
  const strong = match.tier === "STRONG";
  const publicId = refPublicId(match.candidateRef);
  const track = trackMeta(match.source);
  const isChallenge = track.kind === "challenge";
  const isHackathon = track.kind === "hackathon";
  const needles = match.highlightSkills ?? [];
  const skills = orderedSkills(e.skills ?? [], needles);
  const totalDays = e.totalTrackDays ?? track.totalDays;
  // The same number means different work on the two tracks, so it is never
  // labelled the same way. A cohort mission is graded on submission; a challenge
  // day is a shipped task with a GitHub URL recorded against it.
  const workLabel = isChallenge ? "days shipped" : "missions passed";

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-card p-5",
        "shadow-card transition-all duration-300 ease-out",
        "hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-card-hover",
        // The best match keeps the glow instead of waiting for a hover.
        isTop && "border-primary/40 shadow-primary",
      )}
    >
      {/* A one-pixel sheen along the top edge — the "lit" feel, without
          painting a second background that would fight the theme. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-px",
          "bg-gradient-to-r from-transparent via-primary/50 to-transparent",
          isTop ? "opacity-100" : "opacity-0 transition-opacity group-hover:opacity-100",
        )}
      />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {rank != null && (
              <span className="font-display text-base font-bold text-muted-foreground">
                #{rank}
              </span>
            )}
            <h3 className="font-display text-xl font-semibold">
              {match.jobRole}
            </h3>
            {track.label && (
              <span className="rounded-full border px-2 py-0.5 text-sm font-medium text-muted-foreground">
                {track.label}
              </span>
            )}
            {isTop && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-sm font-semibold text-primary">
                Top match
              </span>
            )}
          </div>
          <p className="mt-0.5 text-base text-muted-foreground">
            {[match.locationLabel, publicId].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <p
              className={cn(
                "font-display text-3xl leading-none font-bold tabular-nums",
                strong ? "text-primary" : "text-foreground",
              )}
            >
              {match.score}
            </p>
            <p className="mt-1 text-sm font-medium tracking-wide text-muted-foreground uppercase">
              out of 100
            </p>
          </div>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-sm font-semibold tracking-wide uppercase",
              strong
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            {match.tier}
          </span>
        </div>
      </header>

      {/* Enough to decide whether to open it, and no more. Verified counts sit
          in filled chips, self-declared skills in outlined ones — the
          difference between the two is the point of the card. */}
      <ul className="mt-3 flex flex-wrap gap-1.5 text-base">
        {isHackathon && (
          <li
            className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-900 dark:text-emerald-100"
            title="Shipped a hackathon repo the platform recorded."
          >
            Shipped project
          </li>
        )}
        {!isHackathon && typeof e.missionsPassed === "number" && (
          <li
            className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-900 dark:text-emerald-100"
            title={
              isChallenge
                ? "Days of the 60-day challenge submitted and recorded, each against a GitHub URL."
                : "Missions passed against the platform's own checks. Excludes the first three days, which are waived for everyone at enrolment."
            }
          >
            {e.missionsPassed}
            {totalDays ? ` of ${totalDays}` : ""} {workLabel}
          </li>
        )}
        {e.certificateIssued && (
          <li
            className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-900 dark:text-emerald-100"
            title="Finished the full track and had the certificate issued."
          >
            certified
          </li>
        )}
        {typeof e.quizAverage === "number" && (
          <li
            className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-900 dark:text-emerald-100"
            title="Mean score across the weekly assessments they sat. Shown for context — it is not part of the ranking, because most of the pool was never offered one."
          >
            quiz {e.quizAverage}
          </li>
        )}
        {typeof e.cleanPassCount === "number" && e.cleanPassCount > 0 && (
          <li
            className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-900 dark:text-emerald-100"
            title="Passed on the first verification run."
          >
            {e.cleanPassCount} first-attempt
          </li>
        )}
        {!isHackathon &&
          (e.workingLanguages ?? []).map((l) => (
          <li
            key={l}
            className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-900 lowercase dark:text-emerald-100"
            title="Language of the mission days this candidate passed."
          >
            {l.toLowerCase()}
          </li>
        ))}
        {typeof e.yearsExperience === "number" && e.yearsExperience > 0 && (
          <li className="rounded-full bg-muted px-2 py-0.5">
            {e.yearsExperience} yrs
          </li>
        )}
        {skills.slice(0, 4).map((s) => {
          const hit = skillHighlighted(s, needles);
          return (
            <li
              key={s}
              className={
                hit
                  ? "rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary"
                  : "rounded-full border px-2 py-0.5"
              }
              title={hit ? "Matches the stack you asked for." : undefined}
            >
              {s}
            </li>
          );
        })}
        {skills.length > 4 && (
          <li className="px-1 py-0.5 text-muted-foreground">
            +{skills.length - 4}
          </li>
        )}
        {match.compensationBand && (
          <li
            className="rounded-full border border-dashed px-2 py-0.5 text-muted-foreground"
            title={COMPENSATION_DISCLAIMER}
          >
            est. {match.compensationBand}
          </li>
        )}
        {match.availabilityUnknown && (
          <li
            className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-900 dark:text-amber-100"
            title="Salary, notice period and location are unconfirmed until the candidate shares them."
          >
            <Info className="size-3" aria-hidden="true" />
            Availability unconfirmed
          </li>
        )}
      </ul>

      {match.coverageNote && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {match.coverageNote}
        </p>
      )}


      {/* Two actions, always both: put it in the cart, or look closer. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {match.candidateRef && (
          <ShortlistButton
            candidateRef={match.candidateRef}
            programMemberId={match.programMemberId}
            initialShortlisted={match.shortlisted ?? false}
            jobRole={match.jobRole}
            totalScore={match.score}
            onToggle={onCartToggle}
          />
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            // The quiet third action, but still a real border rather than one
            // that dissolves into the card on a dark background.
            "gap-1.5 border-foreground/20 hover:border-foreground/35",
          )}
        >
          {open ? "Hide details" : "View"}
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
        <RequestIntroButton
          candidateRef={match.candidateRef}
          existingStatus={match.engagementStatus ?? null}
          publicId={publicId}
        />
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t pt-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Stat label="AB score" value={`${match.score}/100`} />
            <Stat label="Tier" value={match.tier} />
            <Stat
              label="Experience"
              value={
                typeof e.yearsExperience === "number"
                  ? `${e.yearsExperience} yrs`
                  : "—"
              }
            />
            <Stat
              label={
                isHackathon
                  ? "Hackathon"
                  : isChallenge
                    ? "Days shipped"
                    : "Missions passed"
              }
              value={
                isHackathon
                  ? "Shipped"
                  : typeof e.missionsPassed === "number"
                    ? isChallenge
                      ? `${e.missionsPassed} of ${totalDays ?? 60}`
                      : typeof e.missionsAttempted === "number"
                        ? `${e.missionsPassed} of ${e.missionsAttempted} tried`
                        : String(e.missionsPassed)
                    : "—"
              }
            />
            {!isHackathon && (
              <Stat
                label={isChallenge ? "Assessments" : "First-attempt"}
                value={
                  isChallenge
                    ? typeof e.quizAverage === "number"
                      ? `${e.quizAverage} avg`
                      : "Not sat"
                    : typeof e.cleanPassCount === "number"
                      ? `${e.cleanPassCount} passes`
                      : "—"
                }
              />
            )}
            {!isHackathon && (
              <Stat
                label={isChallenge ? "Longest streak" : "Commit days"}
                value={
                  typeof e.commitDayCount === "number"
                    ? isChallenge
                      ? `${e.commitDayCount} days`
                      : String(e.commitDayCount)
                    : "—"
                }
              />
            )}
            {!isHackathon && (
              <Stat
                label={isChallenge ? "Certificate" : "Projects"}
                value={
                  isChallenge
                    ? e.certificateIssued
                      ? "Issued"
                      : "Not yet"
                    : e.projectScores?.length
                      ? e.projectScores.join(" / ")
                      : "None"
                }
              />
            )}
            <Stat
              label="Est. compensation"
              value={match.compensationBand ?? "—"}
            />
            <Stat label="Reference" value={publicId} />
          </dl>

          <p className="text-sm leading-relaxed text-muted-foreground">
            {isHackathon
              ? "Shipped a hackathon project the platform recorded. Skills and role are self-declared — there is no daily track behind this card."
              : isChallenge
                ? "Days shipped, streak, assessment scores and the certificate are verified by ABTalks — every day was submitted against a GitHub URL recorded at the time. Experience and skills are self-declared."
                : "Mission, first-attempt, commit and project figures are verified by ABTalks. Experience, skills and role are self-declared."}
            {match.compensationBand ? ` ${COMPENSATION_DISCLAIMER}` : ""}
          </p>

          {(isChallenge || isHackathon) && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {isHackathon
                ? "This candidate came through the hackathon rather than the cohort, so there is no evidence profile page and no shortlist — request an introduction and our team will take it from there."
                : "This candidate came through the 60-day challenge rather than the cohort, so there is no evidence profile page and no shortlist — request an introduction and our team will take it from there."}
            </p>
          )}

          {skills.length > 0 && (
            <div>
              <p className="text-sm tracking-wide text-muted-foreground uppercase">
                Skills — declared by the candidate
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {skills.map((s) => {
                  const hit = skillHighlighted(s, needles);
                  return (
                    <span
                      key={s}
                      className={
                        hit
                          ? "rounded-full bg-primary/10 px-2 py-0.5 text-sm font-medium text-primary"
                          : "rounded-full border px-2 py-0.5 text-sm"
                      }
                    >
                      {s}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {match.rationale && (
            <div>
              <p className="text-sm tracking-wide text-muted-foreground uppercase">
                Why this ranking
              </p>
              <p className="mt-1 text-base leading-relaxed text-foreground/90">
                {match.rationale}
              </p>
            </div>
          )}

          {match.gaps.length > 0 && (
            <div>
              <p className="text-sm tracking-wide text-muted-foreground uppercase">
                Gaps
              </p>
              <ul className="mt-1 list-inside list-disc text-base text-muted-foreground">
                {match.gaps.slice(0, 6).map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          )}

          {match.programMemberId && (
            <Link
              href={`/talent/members/${match.programMemberId}`}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "gap-1.5",
              )}
            >
              Full evidence profile
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Reduced card for an unmet requirement. Same shell as the real card; score,
 * tier, rank, reference id, evidence stats, shortlist, intro and member link
 * are simply not here. Do not add them — a recruiter who believes this is a
 * person is the failure this component exists to prevent.
 */
function SampleMatchCard({
  match,
  sampleDemand,
}: {
  match: MatchCardData;
  sampleDemand?: SampleDemand;
}) {
  const skills = match.evidence.skills ?? [];
  const years = match.evidence.yearsExperience;
  const subtitle = [
    typeof years === "number" && years > 0 ? `${years}+ years` : null,
    sampleDemand ? niceToHaveLine(sampleDemand.spec) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-5",
        "shadow-card",
      )}
    >
      <div className="space-y-3">
        {sampleDemand && <SampleCardNotice {...sampleDemand} />}
        <div>
          <h3 className="font-display text-xl font-semibold">{match.jobRole}</h3>
          {subtitle ? (
            <p className="mt-0.5 text-base text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {skills.length > 0 && (
          <p className="text-sm text-muted-foreground">
            You asked for:{" "}
            <span className="font-medium text-foreground">
              {skills.join(" · ")}
            </span>
          </p>
        )}
        <p className="text-sm leading-relaxed text-muted-foreground">
          This is what a match would look like. Nobody in the pool fits it yet.
        </p>
      </div>
    </article>
  );
}

function niceToHaveLine(spec: SampleDemand["spec"]): string | null {
  const nice = (spec.niceToHaveStack ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  return nice.length ? nice.join(" · ") : null;
}
