import Link from "next/link";
import { Lock, Mic, Trophy } from "lucide-react";
import { requireProgramMember } from "@/lib/program-auth";
import { getInterviewMemberView } from "@/features/program/interview";
import { InterviewClient } from "@/components/program/interview-client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function ProgramInterviewPage() {
  const { member } = await requireProgramMember();
  const view = await getInterviewMemberView(member.id);
  const { eligibility, interview } = view;

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100svh-4.25rem)] bg-[#040A12] px-4 py-6 text-white md:px-6">
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Exit interview
        </h1>
        <p className="text-sm text-muted-foreground">
          A one-time 15-minute voice conversation — scored separately from your
          leaderboard total.
        </p>
      </header>

      {eligibility.state === "locked" && (
        <div className="flex items-start gap-3 rounded-xl border p-6">
          <Lock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">Not available yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {eligibility.reason}
            </p>
            <Link
              href="/program/curriculum"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4 inline-flex")}
            >
              View curriculum
            </Link>
          </div>
        </div>
      )}

      {eligibility.state === "exhausted" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-sm">
          {eligibility.message}
        </div>
      )}

      {(eligibility.state === "ready" || eligibility.state === "in_progress") && (
        <>
          {eligibility.state === "in_progress" && (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm">
              You have an interview marked in progress. Starting again will use
              one restart attempt ({eligibility.resetsRemaining} remaining).
            </div>
          )}
          <InterviewClient memberName={member.fullName} />
        </>
      )}

      {eligibility.state === "completed" && (
        <div className="space-y-6">
          {interview.overallScore !== null ? (
            <div className="rounded-xl border p-6">
              <div className="flex items-center gap-2">
                <Trophy className="size-5 text-amber-500" />
                <p className="font-display text-3xl font-bold">
                  {interview.overallScore}/100
                </p>
                <span className="text-sm text-muted-foreground">overall</span>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <ScorePill label="Communication" value={interview.commScore} />
                <ScorePill label="Technical" value={interview.techScore} />
                <ScorePill label="Problem solving" value={interview.problemScore} />
              </div>
              {interview.summary && (
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {interview.summary}
                </p>
              )}
              {interview.evaluatedAt && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Evaluated{" "}
                  {new Date(interview.evaluatedAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border p-6">
              <Mic className="mt-0.5 size-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Evaluation pending</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your transcript was saved. Scores will appear once evaluation
                  completes.
                </p>
              </div>
            </div>
          )}

          {interview.transcript.length > 0 && (
            <section className="space-y-3 rounded-xl border p-4">
              <h2 className="text-sm font-semibold">Your transcript</h2>
              <ul className="max-h-96 space-y-3 overflow-y-auto text-sm">
                {interview.transcript.map((line, i) => (
                  <li key={i}>
                    <span
                      className={
                        line.role === "ai"
                          ? "font-medium text-primary"
                          : "font-medium"
                      }
                    >
                      {line.role === "ai" ? "Interviewer" : "You"}:
                    </span>{" "}
                    <span className="text-muted-foreground">{line.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
    </div>
  );
}

function ScorePill({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="rounded-lg border px-3 py-2 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display text-lg font-bold">
        {value !== null ? value : "—"}
      </p>
    </div>
  );
}
