import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getMemberAdminDetail } from "@/features/program/admin";
import { ProgramMemberActionPanel } from "@/components/program/program-member-action-panel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateIST, formatDateTimeIST } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cohortId?: string }>;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function dayStateClass(state: string): string {
  if (state === "PASSED") return "bg-emerald-500/80";
  if (state === "SKIPPED") return "bg-amber-500/80";
  if (state === "AVAILABLE") return "bg-sky-500/50";
  return "bg-muted";
}

export default async function AdminProgramMemberDetailPage({
  params,
  searchParams,
}: Props) {
  const { id } = await params;
  const { cohortId } = await searchParams;
  const member = await getMemberAdminDetail(id);
  if (!member) notFound();

  const membersHref = cohortId
    ? `/admin/program/members?cohortId=${encodeURIComponent(cohortId)}`
    : `/admin/program/members?cohortId=${encodeURIComponent(member.cohortId)}`;

  return (
    <div className="space-y-6">
      <Link
        href={membersHref}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
      >
        <ArrowLeft className="size-4" />
        Members
      </Link>

      <div className="flex flex-col justify-between gap-4 rounded-xl border p-4 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <Avatar className="size-14">
            {member.user.image ? (
              <AvatarImage src={member.user.image} alt="" />
            ) : null}
            <AvatarFallback>{initials(member.fullName)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="font-display text-2xl font-bold">{member.fullName}</h1>
            <p className="text-sm text-muted-foreground">
              {member.user.email}
              {member.enrolledAt
                ? ` · Enrolled ${formatDateIST(member.enrolledAt)}`
                : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{member.cohort.name}</Badge>
              <Badge>{member.status}</Badge>
              {member.behindBy > 0 && (
                <Badge variant="destructive">Behind {member.behindBy}d</Badge>
              )}
              {member.atRiskReasons.length > 0 && (
                <Badge variant="secondary">At risk</Badge>
              )}
            </div>
          </div>
        </div>
        <ProgramMemberActionPanel
          memberId={member.id}
          memberName={member.fullName}
          status={member.status}
          skipTokensUsed={member.skipTokensUsed}
        />
      </div>

      {member.atRiskReasons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>At-risk reasons</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {member.atRiskReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Role:</span>{" "}
              {member.jobRole ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Company:</span>{" "}
              {member.company ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Experience:</span>{" "}
              {member.yearsExperience ?? "—"} yrs
            </p>
            <p>
              <span className="text-muted-foreground">Education:</span>{" "}
              {member.education ?? "—"}
              {member.university ? ` · ${member.university}` : ""}
              {member.graduationYear ? ` · ${member.graduationYear}` : ""}
            </p>
            <p>
              <span className="text-muted-foreground">Phone:</span>{" "}
              {member.phone ? (
                <a
                  className="text-primary underline"
                  href={`tel:${encodeURIComponent(member.phone)}`}
                >
                  {member.phone}
                </a>
              ) : (
                "—"
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {member.skills.map((skill) => (
                <Badge key={skill} variant="outline">
                  {skill}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              {member.linkedinUrl && (
                <a
                  href={member.linkedinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline"
                >
                  LinkedIn <ExternalLink className="size-3" />
                </a>
              )}
              <a
                href={member.githubRepoUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline"
              >
                Repo <ExternalLink className="size-3" />
              </a>
              {member.resumeUrl && (
                <a
                  href={member.resumeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline"
                >
                  Resume <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            <p>
              <span className="text-muted-foreground">GitHub:</span> @
              {member.githubUsername}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scores & progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Total:</span>{" "}
              <span className="font-semibold">{member.totalScore}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Missions:</span>{" "}
              {member.missionPoints} · Commits{" "}
              {member.commitPoints} · Projects {member.projectPoints}
            </p>
            <p>
              <span className="text-muted-foreground">Unlocked day:</span>{" "}
              {member.highestUnlockedDay}
            </p>
            <p>
              <span className="text-muted-foreground">Progress day:</span>{" "}
              {member.progressDay} · Calendar day {member.calendarDay}
            </p>
            <p>
              <span className="text-muted-foreground">Behind by:</span>{" "}
              {member.behindBy} day(s)
            </p>
            <p>
              <span className="text-muted-foreground">Clean passes:</span>{" "}
              {member.cleanPassCount}
            </p>
            <p>
              <span className="text-muted-foreground">Skip tokens used:</span>{" "}
              {member.skipTokensUsed}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Day progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1">
            {member.dayStates.map((d) => (
              <div
                key={d.dayNumber}
                title={`Day ${d.dayNumber}: ${d.state}`}
                className={cn(
                  "flex size-7 items-center justify-center rounded text-[10px] font-medium text-foreground",
                  dayStateClass(d.state),
                )}
              >
                {d.dayNumber}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Green = passed · Amber = skipped · Blue = unlocked · Grey = locked
          </p>
        </CardContent>
      </Card>

      {member.aiRecommendation && (
        <Card>
          <CardHeader>
            <CardTitle>AI recommendation</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {member.aiRecommendation}
            </p>
            {member.aiRecommendationAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                Generated {formatDateTimeIST(member.aiRecommendationAt)}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="missions">
        <TabsList>
          <TabsTrigger value="missions">Missions</TabsTrigger>
          <TabsTrigger value="commits">Commits</TabsTrigger>
          <TabsTrigger value="arena">Arena</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="interview">Interview</TabsTrigger>
          <TabsTrigger value="entry">Entry</TabsTrigger>
        </TabsList>

        <TabsContent value="missions">
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {member.missionSubmissions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No mission runs yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  member.missionSubmissions.map((s, i) => (
                    <TableRow key={`${s.dayNumber}-${s.attemptNumber}-${i}`}>
                      <TableCell>{s.dayNumber}</TableCell>
                      <TableCell>{s.attemptNumber}</TableCell>
                      <TableCell>
                        {s.passed ? "Passed" : "Failed"}
                        {s.verdict ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({String(s.verdict)})
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>+{s.pointsAwarded}</TableCell>
                      <TableCell>{formatDateTimeIST(s.createdAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="commits">
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Commits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {member.commitDays.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-muted-foreground">
                      No qualifying commit days.
                    </TableCell>
                  </TableRow>
                ) : (
                  member.commitDays.map((d) => (
                    <TableRow key={d.date.toISOString()}>
                      <TableCell>{formatDateIST(d.date)}</TableCell>
                      <TableCell>{d.commitCount}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="arena">
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Exercise</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {member.exerciseCompletions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">
                      No arena completions.
                    </TableCell>
                  </TableRow>
                ) : (
                  member.exerciseCompletions.map((e, i) => (
                    <TableRow key={`${e.exercise.slug}-${i}`}>
                      <TableCell>{e.exercise.title}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.exercise.slug}
                      </TableCell>
                      <TableCell>
                        {formatDateTimeIST(e.completedAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="projects">
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Repo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {member.projects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      No projects submitted.
                    </TableCell>
                  </TableRow>
                ) : (
                  member.projects.map((p) => (
                    <TableRow key={p.moduleNumber}>
                      <TableCell>{p.moduleNumber}</TableCell>
                      <TableCell>{p.status}</TableCell>
                      <TableCell>
                        {p.adminScore ?? p.aiScore
                          ? `${p.adminScore ?? p.aiScore}/100`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {p.repoUrl ? (
                          <a
                            href={p.repoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary underline"
                          >
                            Open <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="interview">
          <Card>
            <CardContent className="space-y-2 pt-6 text-sm">
              {!member.interview ? (
                <p className="text-muted-foreground">No interview yet.</p>
              ) : (
                <>
                  <p>
                    <span className="text-muted-foreground">Status:</span>{" "}
                    {member.interview.status}
                  </p>
                  {member.interview.overallScore !== null && (
                    <p>
                      <span className="text-muted-foreground">Overall:</span>{" "}
                      {member.interview.overallScore}/100 (C
                      {member.interview.commScore} T{member.interview.techScore}{" "}
                      P{member.interview.problemScore})
                    </p>
                  )}
                  {member.interview.durationSec != null && (
                    <p>
                      <span className="text-muted-foreground">Duration:</span>{" "}
                      {Math.round(member.interview.durationSec / 60)} min
                    </p>
                  )}
                  {member.interview.summary && (
                    <p className="text-muted-foreground">
                      {member.interview.summary}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="entry">
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Aptitude</TableHead>
                  <TableHead>Technical</TableHead>
                  <TableHead>Passed</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {member.entryAttempts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No entry attempts (assessment may have been bypassed).
                    </TableCell>
                  </TableRow>
                ) : (
                  member.entryAttempts.map((a) => (
                    <TableRow key={a.attemptNumber}>
                      <TableCell>{a.attemptNumber}</TableCell>
                      <TableCell>{a.aptitudeScore ?? "—"}</TableCell>
                      <TableCell>{a.technicalScore ?? "—"}</TableCell>
                      <TableCell>
                        {a.passed === null
                          ? "—"
                          : a.passed
                            ? "Yes"
                            : "No"}
                      </TableCell>
                      <TableCell>
                        {a.submittedAt
                          ? formatDateTimeIST(a.submittedAt)
                          : "In progress"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
