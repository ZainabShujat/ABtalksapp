import type { RecommendationLevel } from "@prisma/client";
import { notFound } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getRecruiterProfileByToken } from "@/features/recruiter/get-recruiter-profile";
import { cn } from "@/lib/utils";
import { PrintButton } from "./print-button";

export const metadata = {
  title: "Candidate Profile | ABTalks",
  robots: { index: false },
};

// Local navy + gold palette (template match). Literal Tailwind arbitrary values only —
// do not change global tokens. Score-card accent colors use inline style via SCORE_COLORS.

const SCORE_COLORS = {
  communication: "#2f6fb0",
  programming: "#8e3b8e",
  behavior: "#1a9e8f",
} as const;

const PASSED_BADGE =
  "border-[#d99c2c]/50 bg-[#fbf6e9] text-[#8a6310] print:bg-[#fbf6e9]";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function recommendationLabel(level: RecommendationLevel): string {
  switch (level) {
    case "STRONGLY_RECOMMEND":
      return "Strongly Recommend";
    case "RECOMMEND":
      return "Recommend";
    case "NEUTRAL":
      return "Neutral";
    case "DO_NOT_RECOMMEND":
      return "Do Not Recommend";
  }
}

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="mb-3 border-b border-[#1e3a5f]/15 pb-1 font-display text-sm font-bold uppercase tracking-wide text-[#1e3a5f] print:mb-1.5">
      {title}
    </h3>
  );
}

function SidebarHeading({ title }: { title: string }) {
  return (
    <h3 className="mb-3 border-b border-[#d99c2c]/40 pb-1 font-display text-xs font-bold uppercase tracking-[0.12em] text-[#b9831f] print:mb-1.5">
      {title}
    </h3>
  );
}

function MetaList({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="space-y-2 text-sm break-inside-avoid">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex justify-between gap-3 border-b border-border/40 pb-2 last:border-0 last:pb-0"
        >
          <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words text-right font-medium text-foreground">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function toRows(
  pairs: readonly (readonly [string, string])[],
): { label: string; value: string }[] {
  return pairs
    .filter(([, value]) => value.trim().length > 0)
    .map(([label, value]) => ({ label, value }));
}

function ScoreProgressBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.min(100, Math.max(0, score))}%`,
          backgroundColor: color,
        }}
      />
    </div>
  );
}

export default async function RecruiterProfilePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const profile = await getRecruiterProfileByToken(token);
  if (!profile) notFound();

  const hasFullAssessmentScores =
    profile.communicationScore != null &&
    profile.programmingScore != null &&
    profile.behaviorScore != null;

  const hasResumeContent =
    profile.skillGroups.length > 0 ||
    profile.education.length > 0 ||
    profile.certifications.length > 0 ||
    profile.languagesSpoken.length > 0 ||
    profile.achievements.length > 0 ||
    !!profile.summary?.trim() ||
    profile.experience.length > 0 ||
    profile.projects.length > 0;

  const logisticsRows = toRows([
    ["Open to Relocation", profile.logistics.openToRelocation],
    ["Preferred Locations", profile.logistics.preferredLocations],
    ["Current Location", profile.logistics.currentLocation],
    ["Available From", profile.logistics.availableFrom],
    ["Notice Period", profile.logistics.noticePeriod],
    ["Work Authorization", profile.logistics.workAuthorization],
    ["Preferred Work Mode", profile.logistics.preferredWorkMode],
  ]);

  const compensationRows = toRows([
    ["Current CTC", profile.compensation.currentCtc],
    ["Expected CTC", profile.compensation.expectedCtc],
    ["Negotiated Offer", profile.compensation.negotiatedOffer],
    ["Equity / ESOPs", profile.compensation.equity],
    ["Benefits Required", profile.compensation.benefitsRequired],
    ["Currency Preference", profile.compensation.currencyPreference],
  ]);

  const hasAssessmentContent =
    hasFullAssessmentScores ||
    !!profile.communicationFeedback?.trim() ||
    !!profile.programmingFeedback?.trim() ||
    !!profile.behaviorFeedback?.trim() ||
    profile.codingChallenges.length > 0 ||
    profile.strengths.length > 0 ||
    profile.areasForGrowth.length > 0 ||
    profile.recommendation != null ||
    logisticsRows.length > 0 ||
    compensationRows.length > 0;

  const showComingSoon = !hasResumeContent && !hasAssessmentContent;

  const contactParts = [
    profile.email,
    profile.phone,
    profile.linkedinUrl
      ? profile.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "")
      : null,
    profile.githubUsername ? `github.com/${profile.githubUsername}` : null,
    profile.logistics.currentLocation || null,
  ].filter((part): part is string => !!part && part.trim().length > 0);

  const assessmentMeta = [
    profile.assessmentDate ? `Assessment Date: ${profile.assessmentDate}` : null,
    profile.interviewerName ? `Interviewer: ${profile.interviewerName}` : null,
    profile.challengeRound ? `Challenge Round: ${profile.challengeRound}` : null,
    `ABTalks ID: ${profile.abtalksId}`,
  ].filter((part): part is string => !!part);

  const scoreCards = hasFullAssessmentScores
    ? ([
        {
          label: "Communication",
          score: profile.communicationScore!,
          caption: "Verbal clarity & articulation",
          color: SCORE_COLORS.communication,
        },
        {
          label: "Programming",
          score: profile.programmingScore!,
          caption: "Algorithms & code quality",
          color: SCORE_COLORS.programming,
        },
        {
          label: "Behavior",
          score: profile.behaviorScore!,
          caption: "Culture fit & collaboration",
          color: SCORE_COLORS.behavior,
        },
      ] as const)
    : [];

  const rec = profile.recommendation
    ? recommendationLabel(profile.recommendation)
    : null;

  const eduMeta = (year: string, score: string) =>
    [year, score].filter((s) => s.trim().length > 0).join("  ·  ");

  return (
    <div
      className={cn(
        "report-light min-h-svh bg-muted/30 text-foreground print:min-h-0 print:bg-white",
        "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
      )}
    >
      <div className="mx-auto flex max-w-4xl items-center justify-end px-4 pt-6 print:hidden">
        <PrintButton token={token} />
      </div>

      <div className="mx-auto my-6 max-w-4xl overflow-hidden rounded-2xl border bg-card shadow-sm print:my-0 print:box-border print:w-full print:rounded-none print:border-0 print:shadow-none">
        {/* Brand bar */}
        <div className="bg-[#16293f] px-6 py-2 text-right text-[11px] print:bg-[#16293f]">
          <span className="font-display font-bold text-[#d99c2c]">AB TALKS</span>
          <span className="text-white/70"> | AI Conversations That Matter</span>
        </div>

        {/* ============ PAGE ONE — RESUME ============ */}
        <section>
          {/* Navy hero header */}
          <header className="bg-[#1e3a5f] px-6 py-7 text-white print:bg-[#1e3a5f] print:py-4">
            <h1 className="font-display text-3xl font-bold text-white">
              {profile.fullName}
            </h1>
            {profile.targetRole ? (
              <p className="mt-1 text-base font-semibold text-[#d99c2c]">
                {profile.targetRole}
              </p>
            ) : null}
            {contactParts.length > 0 ? (
              <p className="mt-2 break-all text-xs text-white/80">
                {contactParts.join("  |  ")}
              </p>
            ) : null}
          </header>

          {/* Light sidebar + white main */}
          <div className="grid grid-cols-1 md:grid-cols-[32%_1fr] print:grid-cols-[30%_minmax(0,1fr)]">
            <aside className="min-w-0 space-y-6 border-r border-[#e5e7eb] bg-[#f3f4f6] px-5 py-6 print:space-y-3 print:bg-[#f3f4f6] print:py-4 print:text-[11px] print:leading-snug">
              <div className="aspect-square w-full max-w-[200px] break-inside-avoid print:max-w-[120px]">
                <Avatar className="size-full rounded-lg">
                  {profile.image ? (
                    <AvatarImage src={profile.image} alt={profile.fullName} />
                  ) : null}
                  <AvatarFallback className="rounded-lg bg-[#1e3a5f]/10 font-display text-3xl font-bold text-[#1e3a5f]">
                    {initials(profile.fullName)}
                  </AvatarFallback>
                </Avatar>
              </div>

              {profile.skillGroups.length > 0 ? (
                <section>
                  <SidebarHeading title="Technical Skills" />
                  <div className="space-y-3">
                    {profile.skillGroups.map((group) => (
                      <div key={group.category}>
                        <p className="text-xs font-semibold text-[#1e3a5f]">
                          {group.category}
                        </p>
                        {group.skills.length > 0 ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {group.skills.join(", ")}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {profile.education.length > 0 ? (
                <section>
                  <SidebarHeading title="Education" />
                  <div className="space-y-3">
                    {profile.education.map((row) => (
                      <div key={`${row.degree}-${row.institution}`}>
                        <p className="text-xs font-semibold text-[#1e3a5f]">
                          {row.degree}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.institution}
                        </p>
                        {eduMeta(row.year, row.score) ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {eduMeta(row.year, row.score)}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {profile.certifications.length > 0 ? (
                <section>
                  <SidebarHeading title="Certifications" />
                  <div className="space-y-2">
                    {profile.certifications.map((cert) => (
                      <div key={`${cert.name}-${cert.issuer}`}>
                        <p className="text-xs font-semibold text-[#1e3a5f]">
                          {cert.name}
                        </p>
                        {[cert.issuer, cert.year].filter(Boolean).length > 0 ? (
                          <p className="text-xs text-muted-foreground">
                            {[cert.issuer, cert.year].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {profile.languagesSpoken.length > 0 ? (
                <section>
                  <SidebarHeading title="Languages Spoken" />
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {profile.languagesSpoken.map((lang) => (
                      <li key={lang}>{lang}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {profile.achievements.length > 0 ? (
                <section>
                  <SidebarHeading title="Achievements" />
                  <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    {profile.achievements.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </aside>

            <div className="min-w-0 space-y-6 bg-white px-6 py-7 print:space-y-3 print:bg-white print:py-4 print:text-[11px] print:leading-snug">
              {showComingSoon ? (
                <p className="text-sm text-muted-foreground">
                  Profile coming soon
                </p>
              ) : null}

              {profile.summary ? (
                <section>
                  <SectionHeading title="Professional Summary" />
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {profile.summary}
                  </p>
                </section>
              ) : null}

              {profile.experience.length > 0 ? (
                <section>
                  <SectionHeading title="Professional Experience" />
                  <div className="space-y-4">
                    {profile.experience.map((exp) => (
                      <div
                        key={`${exp.title}-${exp.company}-${exp.period}`}
                        className="break-inside-avoid"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <p className="font-semibold text-[#1e3a5f]">
                            {exp.title}
                          </p>
                          {exp.period ? (
                            <p className="text-xs text-[#b9831f]">{exp.period}</p>
                          ) : null}
                        </div>
                        {(exp.company || exp.location) && (
                          <p className="text-sm font-medium text-[#b9831f]">
                            {[exp.company, exp.location]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        {exp.bullets.length > 0 ? (
                          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
                            {exp.bullets.map((bullet) => (
                              <li key={bullet}>{bullet}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {profile.projects.length > 0 ? (
                <section>
                  <SectionHeading title="Key Projects" />
                  <div className="space-y-3">
                    {profile.projects.map((project) => (
                      <div key={project.title} className="break-inside-avoid">
                        <p className="font-semibold text-[#1e3a5f]">
                          {project.title}
                        </p>
                        {project.tech ? (
                          <p className="mt-0.5 font-mono text-xs text-[#b9831f]">
                            {project.tech}
                          </p>
                        ) : null}
                        {project.description ? (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {project.description}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </section>

        {/* ============ PAGE TWO+ — ASSESSMENT REPORT ============ */}
        {hasAssessmentContent ? (
          <section className="border-t print:break-before-page print:text-[11px] print:leading-snug print:[zoom:0.85]">
            <div className="bg-[#1e3a5f] px-6 py-6 text-white print:bg-[#1e3a5f] print:py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em]">
                <span className="text-[#d99c2c]">AB TALKS</span>{" "}
                <span className="text-white">CANDIDATE ASSESSMENT REPORT</span>
              </p>
              <h2 className="mt-2 font-display text-2xl font-bold">
                {profile.fullName}
              </h2>
              {assessmentMeta.length > 0 ? (
                <p className="mt-2 text-xs text-white/70">
                  {assessmentMeta.join(" · ")}
                </p>
              ) : null}
            </div>

            {hasFullAssessmentScores && profile.assessmentComposite != null ? (
              <div className="mx-6 mt-6 break-inside-avoid rounded-lg border-l-4 border-[#d99c2c] bg-[#fbf6e9] px-5 py-4 print:mt-4 print:bg-[#fbf6e9] print:py-2">
                <p className="text-sm">
                  <span className="font-bold text-[#1e3a5f]">
                    ABTalks Synergy Score:{" "}
                  </span>
                  <span className="font-bold text-[#b9831f]">
                    {profile.assessmentComposite}
                  </span>
                  <span className="font-bold text-[#1e3a5f]">
                    {" "}
                    / {profile.assessmentMax} Points
                  </span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Composite across Communication, Programming, and Behavior. A
                  score above 240 indicates strong readiness.
                </p>
              </div>
            ) : null}

            {scoreCards.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 px-6 pt-4 print:gap-2 print:pt-3 sm:grid-cols-3">
                {scoreCards.map((card) => (
                  <div
                    key={card.label}
                    className="break-inside-avoid rounded-xl border bg-card p-4 shadow-sm print:p-2"
                  >
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {card.label}
                    </p>
                    <p className="mt-1 font-display text-3xl font-bold print:text-2xl">
                      <span style={{ color: card.color }}>{card.score}</span>
                      <span className="text-base font-semibold text-muted-foreground">
                        /100
                      </span>
                    </p>
                    <ScoreProgressBar score={card.score} color={card.color} />
                    <p className="mt-2 text-xs italic text-muted-foreground">
                      {card.caption}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-6 px-6 py-6 md:grid-cols-[1fr_300px] print:grid-cols-[minmax(0,1fr)_34%] print:gap-4 print:py-4">
              <div className="min-w-0 space-y-6 print:space-y-3">
                {(profile.communicationFeedback ||
                  profile.programmingFeedback ||
                  profile.behaviorFeedback) && (
                  <section>
                    <SectionHeading title="Detailed Assessment Feedback" />
                    <div className="space-y-4 print:space-y-3">
                      {profile.communicationFeedback ? (
                        <div>
                          <h4
                            className="text-sm font-semibold"
                            style={{ color: SCORE_COLORS.communication }}
                          >
                            Communication
                          </h4>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                            {profile.communicationFeedback}
                          </p>
                        </div>
                      ) : null}
                      {profile.programmingFeedback ? (
                        <div>
                          <h4
                            className="text-sm font-semibold"
                            style={{ color: SCORE_COLORS.programming }}
                          >
                            Programming &amp; Technical Skills
                          </h4>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                            {profile.programmingFeedback}
                          </p>
                        </div>
                      ) : null}
                      {profile.behaviorFeedback ? (
                        <div>
                          <h4
                            className="text-sm font-semibold"
                            style={{ color: SCORE_COLORS.behavior }}
                          >
                            Behavior &amp; Culture Fit
                          </h4>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                            {profile.behaviorFeedback}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </section>
                )}

                {profile.codingChallenges.length > 0 ? (
                  <section>
                    <SectionHeading title="Coding Challenge Results" />
                    <div className="space-y-3 md:hidden print:hidden">
                      {profile.codingChallenges.map((row) => (
                        <div
                          key={row.name}
                          className="rounded-xl border p-3 text-sm"
                        >
                          <p className="font-medium">{row.name}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {row.status ? (
                              <Badge
                                variant="outline"
                                className={
                                  row.status.toLowerCase().includes("passed")
                                    ? PASSED_BADGE
                                    : undefined
                                }
                              >
                                {row.status}
                              </Badge>
                            ) : null}
                            {row.score ? (
                              <span className="text-muted-foreground">
                                {row.score}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden break-inside-avoid md:block print:block [&_[data-slot=table-container]]:print:overflow-visible">
                      <Table className="print:table-fixed">
                        <TableHeader>
                          <TableRow className="bg-[#1e3a5f] hover:bg-[#1e3a5f] print:bg-[#1e3a5f]">
                            <TableHead className="text-white print:whitespace-normal print:break-words">
                              Challenge
                            </TableHead>
                            <TableHead className="text-white print:whitespace-normal print:break-words">
                              Status
                            </TableHead>
                            <TableHead className="text-white print:whitespace-normal print:break-words">
                              Score
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {profile.codingChallenges.map((row) => (
                            <TableRow key={row.name}>
                              <TableCell className="font-medium print:whitespace-normal print:break-words">
                                {row.name}
                              </TableCell>
                              <TableCell className="print:whitespace-normal print:break-words">
                                {row.status ? (
                                  <Badge
                                    variant="outline"
                                    className={
                                      row.status
                                        .toLowerCase()
                                        .includes("passed")
                                        ? PASSED_BADGE
                                        : undefined
                                    }
                                  >
                                    {row.status}
                                  </Badge>
                                ) : (
                                  "—"
                                )}
                              </TableCell>
                              <TableCell className="print:whitespace-normal print:break-words">
                                {row.score || "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </section>
                ) : null}

                {profile.strengths.length > 0 ? (
                  <section>
                    <SectionHeading title="Key Strengths" />
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {profile.strengths.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {profile.areasForGrowth.length > 0 ? (
                  <section>
                    <SectionHeading title="Areas for Growth" />
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {profile.areasForGrowth.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>

              <aside className="min-w-0 space-y-6 print:space-y-3">
                {logisticsRows.length > 0 ? (
                  <section className="break-inside-avoid">
                    <SectionHeading title="Candidate Logistics" />
                    <MetaList rows={logisticsRows} />
                  </section>
                ) : null}

                {compensationRows.length > 0 ? (
                  <section className="break-inside-avoid">
                    <SectionHeading title="Compensation Details" />
                    <MetaList rows={compensationRows} />
                  </section>
                ) : null}

                {rec ? (
                  <section className="break-inside-avoid rounded-xl bg-[#1e3a5f] p-4 text-white print:bg-[#1e3a5f]">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#d99c2c]">
                      ABTalks Recommendation
                    </p>
                    <p className="mt-1 font-display text-lg font-bold">{rec}</p>
                  </section>
                ) : null}
              </aside>
            </div>
          </section>
        ) : null}

        <footer className="border-t px-6 py-5 print:break-inside-avoid">
          <p className="text-center text-[11px] tracking-wide text-muted-foreground">
            ABTalks Coding Challenge &nbsp;·&nbsp; AI Conversations That Matter
            &nbsp;·&nbsp; CONFIDENTIAL — For Hiring Organizations Only
          </p>
        </footer>
      </div>
    </div>
  );
}
