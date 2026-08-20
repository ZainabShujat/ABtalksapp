import Link from "next/link";
import { Mic } from "lucide-react";
import type { TalentPoolRow } from "@/features/talent-pool/pool";
import { ShortlistButton } from "@/components/talent/shortlist-button";
import { ScoreBreakdown } from "@/components/talent/score-breakdown";

export function MemberCard({ member }: { member: TalentPoolRow }) {
  return (
    <article className="rounded-xl border p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-bold text-muted-foreground">
              #{member.rank}
            </span>
            <Link
              href={`/talent/members/${member.memberId}`}
              className="font-semibold hover:underline"
            >
              {member.fullName}
            </Link>
            {member.interviewOverall !== null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                <Mic className="size-3" />
                {member.interviewOverall}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {member.jobRole} · {member.company} · {member.yearsExperience} yrs
          </p>
          {member.skills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {member.skills.slice(0, 6).map((skill) => (
                <span
                  key={skill}
                  className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {skill}
                </span>
              ))}
            </div>
          )}
        </div>
        <ShortlistButton
          memberId={member.memberId}
          initialShortlisted={member.shortlisted}
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_140px]">
        <ScoreBreakdown
          missionPoints={member.missionPoints}
          conceptPoints={member.conceptPoints}
          commitPoints={member.commitPoints}
          projectPoints={member.projectPoints}
          totalScore={member.totalScore}
          compact
        />
        <div className="text-right text-sm">
          <p className="font-display text-xl font-bold">{member.totalScore}</p>
          <p className="text-xs text-muted-foreground">
            {member.cleanPassPct}% clean passes
          </p>
        </div>
      </div>
    </article>
  );
}
