import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { auth } from "@/auth";
import { requireRecruiter } from "@/lib/program-auth";
import { getTalentProfile } from "@/features/talent-pool/pool";
import { MissionHeatmap } from "@/components/program/mission-heatmap";
import { ShortlistButton } from "@/components/talent/shortlist-button";
import { ShortlistNoteForm } from "@/components/talent/shortlist-note-form";
import { ScoreBreakdown } from "@/components/talent/score-breakdown";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ id: string }> };

const MISSION_LABEL: Record<string, string> = {
  CODE_SPRINT: "Code Sprint",
  SHIP_IT: "Ship It",
  DATA_ROOM: "Data Room",
  PROMPT_FORGE: "Prompt Forge",
  BOSS_BUILD: "Boss Build",
};

export default async function TalentMemberPage({ params }: Props) {
  await requireRecruiter();
  const session = await auth();
  const { id } = await params;

  const profileResult = await getTalentProfile(session!.user!.id, id);
  if (!profileResult.ok) notFound();
  const profile = profileResult.data;

  const portfolioDays = profile.missionPortfolio.filter(
    (d) => d.state === "PASSED",
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-center gap-3">
        <Link
          href="/talent"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
        >
          <ArrowLeft className="size-4" />
          Pool
        </Link>
        <ShortlistButton
          memberId={profile.memberId}
          initialShortlisted={profile.shortlisted}
        />
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-display text-sm font-bold text-muted-foreground">
            #{profile.rank}
          </span>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {profile.fullName}
          </h1>
        </div>
        <p className="text-muted-foreground">
          {profile.jobRole} · {profile.company} · {profile.yearsExperience} years
        </p>
        {profile.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {profile.skills.map((s) => (
              <span
                key={s}
                className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-semibold">Contact</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd>
                <a
                  href={`mailto:${profile.email}`}
                  className="text-primary hover:underline"
                >
                  {profile.email}
                </a>
              </dd>
            </div>
            {profile.linkedinUrl && (
              <div>
                <dt className="text-muted-foreground">LinkedIn</dt>
                <dd>
                  <a
                    href={profile.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Profile <ExternalLink className="size-3" />
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">GitHub</dt>
              <dd>
                <a
                  href={profile.githubRepoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  {profile.githubUsername} <ExternalLink className="size-3" />
                </a>
              </dd>
            </div>
            {profile.resumeUrl && (
              <div>
                <dt className="text-muted-foreground">Resume</dt>
                <dd>
                  <a
                    href={profile.resumeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    View resume <ExternalLink className="size-3" />
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </div>
        <div className="rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-semibold">Score breakdown</h2>
          <ScoreBreakdown
            missionPoints={profile.scoreBreakdown.missionPoints}
            conceptPoints={profile.scoreBreakdown.conceptPoints}
            commitPoints={profile.scoreBreakdown.commitPoints}
            projectPoints={profile.scoreBreakdown.projectPoints}
            totalScore={profile.scoreBreakdown.totalScore}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            {profile.cleanPassPct}% clean first-attempt passes
          </p>
        </div>
      </section>

      <ShortlistNoteForm
        memberId={profile.memberId}
        initialNote={profile.shortlistNote}
        shortlisted={profile.shortlisted}
      />

      {profile.aiRecommendation && (
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <h2 className="text-sm font-semibold">AI mentor note</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {profile.aiRecommendation}
          </p>
        </section>
      )}

      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">Mission progress</h2>
        <MissionHeatmap cells={profile.missionHeatmap} variant="compact" />
      </section>

      {profile.projects.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Boss Build projects</h2>
          <ul className="space-y-3">
            {profile.projects.map((p) => (
              <li key={p.moduleNumber} className="rounded-xl border p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">Module {p.moduleNumber}</span>
                  {p.score !== null && (
                    <span className="font-display font-bold">{p.score}/100</span>
                  )}
                </div>
                <a
                  href={p.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Repository <ExternalLink className="size-3" />
                </a>
                {p.feedback && (
                  <p className="mt-2 text-muted-foreground">{p.feedback}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.interview && profile.interview.status === "COMPLETED" && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">Exit voice interview</h2>
          {profile.interview.overallScore !== null && (
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="font-display text-xl font-bold">
                {profile.interview.overallScore}/100 overall
              </span>
              <span className="text-muted-foreground">
                Comm {profile.interview.commScore ?? "—"} · Tech{" "}
                {profile.interview.techScore ?? "—"} · Problem{" "}
                {profile.interview.problemScore ?? "—"}
              </span>
            </div>
          )}
          {profile.interview.summary && (
            <p className="text-sm text-muted-foreground">
              {profile.interview.summary}
            </p>
          )}
          {profile.interview.transcript.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">
                Transcript ({profile.interview.transcript.length} lines)
              </summary>
              <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                {profile.interview.transcript.map((line, i) => (
                  <li key={i}>
                    <span className="font-medium">
                      {line.role === "ai" ? "Interviewer" : "Candidate"}:
                    </span>{" "}
                    <span className="text-muted-foreground">{line.text}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Mission portfolio</h2>
        <p className="text-xs text-muted-foreground">
          What they built and verified across 31 days — mentor notes included.
        </p>
        <ul className="space-y-2">
          {portfolioDays.map((day) => (
            <li key={day.dayNumber} className="rounded-lg border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  Day {day.dayNumber}: {day.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {MISSION_LABEL[day.missionType] ?? day.missionType}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Passed
                {day.state === "PASSED" && (
                  <>
                    {" "}
                    · {day.runsUsed} run{day.runsUsed === 1 ? "" : "s"}
                    {day.cleanPass ? " · clean pass" : ""}
                  </>
                )}
              </p>
              {day.mentorNote && (
                <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                  Mentor: {day.mentorNote.replace(/^###.*$/gm, "").trim()}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
