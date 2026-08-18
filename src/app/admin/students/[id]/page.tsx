import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ExternalLink } from "lucide-react";
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
import { RejectSubmissionButton } from "@/components/admin/reject-submission-button";
import { StudentActionPanel } from "@/components/admin/student-action-panel";
import { GrantSynergyDialog } from "@/components/admin/grant-synergy-dialog";
import { StudentRemarksPanel } from "@/components/admin/student-remarks-panel";
import { formatDateIST, formatDateTimeIST } from "@/lib/date-utils";
import { RecruiterReviewPanel } from "@/components/admin/recruiter-review-panel";
import { getStudentDetail } from "@/features/admin/get-student-detail";
import { getRecruiterReview } from "@/features/recruiter/get-recruiter-review";
import { userTypeLabel } from "@/lib/profile-display";
import { cn } from "@/lib/utils";
import { UserType } from "@prisma/client";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function domainBadgeClass(domain: string): string {
  if (domain === "AI") return "border-domains-ai/50 bg-domains-ai-bg text-domains-ai";
  if (domain === "DS") return "border-domains-ds/50 bg-domains-ds-bg text-domains-ds";
  if (domain === "HACKATHON")
    return "border-border bg-muted text-muted-foreground";
  return "border-domains-se/50 bg-domains-se-bg text-domains-se";
}

export default async function AdminStudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getStudentDetail(id);
  if (!data) notFound();

  if (data.kind === "hackathon") {
    return (
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-4 rounded-xl border p-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <Avatar className="size-14">
              {data.user.image ? <AvatarImage src={data.user.image} alt="" /> : null}
              <AvatarFallback>{initials(data.user.name)}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="font-display text-2xl font-bold">{data.user.name}</h1>
              <p className="text-sm text-muted-foreground">
                {data.user.email} · Joined {formatDateIST(data.user.joinedAt)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline" className={domainBadgeClass("HACKATHON")}>
                  HACKATHON
                </Badge>
                <Badge>{data.hackathon.entryType}</Badge>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <p className="text-sm">
              <span className="text-muted-foreground">Synergy Points:</span>{" "}
              <span className="font-semibold tabular-nums">
                {data.user.synergyPoints}
              </span>
            </p>
            <GrantSynergyDialog
              studentId={data.user.id}
              studentName={data.user.name}
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Hackathon registration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Full name:</span>{" "}
              {data.hackathon.fullName}
            </p>
            <p>
              <span className="text-muted-foreground">Email:</span>{" "}
              {data.hackathon.email}
            </p>
            <p>
              <span className="text-muted-foreground">Phone:</span>{" "}
              <a
                className="text-primary underline"
                href={`tel:${encodeURIComponent(data.hackathon.phone)}`}
              >
                {data.hackathon.phone}
              </a>
            </p>
            <p>
              <span className="text-muted-foreground">College:</span>{" "}
              {data.hackathon.college}
            </p>
            <p>
              <span className="text-muted-foreground">Graduation year:</span>{" "}
              {data.hackathon.graduationYear}
            </p>
            <p>
              <span className="text-muted-foreground">Entry type:</span>{" "}
              {data.hackathon.entryType}
            </p>
            {data.hackathon.entryType === "TEAM" ? (
              <p>
                <span className="text-muted-foreground">Team name:</span>{" "}
                {data.hackathon.teamName ?? "-"}
              </p>
            ) : null}
            <p>
              <span className="text-muted-foreground">Team code:</span>{" "}
              {data.hackathon.teamCode}
            </p>
            <p>
              <span className="text-muted-foreground">Registered:</span>{" "}
              {formatDateIST(data.hackathon.createdAt)}
            </p>
          </CardContent>
        </Card>

        <div>
          <Link
            href="/admin/students"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Back to Students
          </Link>
        </div>
      </div>
    );
  }

  const review = await getRecruiterReview(id);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-xl border p-4 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <Avatar className="size-14">
            {data.user.image ? <AvatarImage src={data.user.image} alt="" /> : null}
            <AvatarFallback>{initials(data.user.name)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="font-display text-2xl font-bold">{data.user.name}</h1>
            <p className="text-sm text-muted-foreground">
              {data.user.email} · Joined {formatDateIST(data.user.joinedAt)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline" className={domainBadgeClass(data.profile.domain)}>
                {data.profile.domain}
              </Badge>
              <Badge>{data.enrollment?.status ?? "UNASSIGNED"}</Badge>
              {data.profile.isReadyForInterview ? (
                <Badge variant="secondary">Ready for Interview</Badge>
              ) : null}
            </div>
          </div>
        </div>
        <StudentActionPanel
          studentId={data.student.userId}
          studentName={data.student.fullName}
          isReadyForInterview={data.student.isReadyForInterview}
          isActive={data.student.enrollmentStatus === "ACTIVE"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Type:</span>{" "}
              {userTypeLabel(data.profile.userType)}
            </p>
            {data.profile.userType === UserType.STUDENT ? (
              <>
                <p>
                  <span className="text-muted-foreground">College:</span>{" "}
                  {data.profile.college ?? "-"}
                </p>
                <p>
                  <span className="text-muted-foreground">Graduation Year:</span>{" "}
                  {data.profile.graduationYear ?? "-"}
                </p>
              </>
            ) : (
              <>
                <p>
                  <span className="text-muted-foreground">Organization:</span>{" "}
                  {data.profile.organization ?? "-"}
                </p>
                <p>
                  <span className="text-muted-foreground">Role:</span>{" "}
                  {data.profile.role ?? "-"}
                </p>
                <p>
                  <span className="text-muted-foreground">Years of Experience:</span>{" "}
                  {data.profile.yearsExperience ?? "-"}
                </p>
              </>
            )}
            <p>
              <span className="text-muted-foreground">Referral Code:</span>{" "}
              {data.profile.referralCode}
            </p>
            <p>
              <span className="text-muted-foreground">Phone:</span>{" "}
              {data.profile.phone ? (
                <a
                  className="text-primary underline"
                  href={`tel:${encodeURIComponent(data.profile.phone)}`}
                >
                  {data.profile.phone}
                </a>
              ) : (
                <span className="text-muted-foreground">Not provided</span>
              )}
              {data.profile.phone ? (
                data.profile.phoneVerified ? (
                  <Badge className="ml-2 gap-1 bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="size-3.5" aria-hidden />
                    Verified
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="ml-2 text-muted-foreground"
                  >
                    Not verified
                  </Badge>
                )
              ) : null}
            </p>
            <div className="flex flex-wrap gap-2">
              {data.profile.skills.map((skill: string) => (
                <Badge key={skill} variant="outline">
                  {skill}
                </Badge>
              ))}
            </div>
            {data.profile.linkedinUrl ? (
              <Link className="inline-flex items-center gap-1 text-primary underline" href={data.profile.linkedinUrl} target="_blank" rel="noreferrer">
                LinkedIn <ExternalLink className="size-3" />
              </Link>
            ) : null}
            {data.profile.githubUsername ? (
              <p>
                <span className="text-muted-foreground">GitHub:</span> @{data.profile.githubUsername}
              </p>
            ) : null}
            <p>
              <span className="text-muted-foreground">Resume:</span>{" "}
              {data.profile.resumeUrl ? (
                <Link
                  className="inline-flex items-center gap-1 text-primary underline"
                  href={data.profile.resumeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View Resume <ExternalLink className="size-3" />
                </Link>
              ) : (
                <span className="text-muted-foreground">No resume link</span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Progress Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Days Completed:</span>{" "}
              {data.progress.daysCompleted} / {data.progress.totalDays}
            </p>
            <p>
              <span className="text-muted-foreground">Current Streak:</span>{" "}
              {data.progress.currentStreak}
            </p>
            <p>
              <span className="text-muted-foreground">Longest Streak:</span>{" "}
              {data.progress.longestStreak}
            </p>
            <p>
              <span className="text-muted-foreground">On-time submissions:</span>{" "}
              {data.progress.onTimeCount}
            </p>
            <p>
              <span className="text-muted-foreground">Last Submitted Day:</span>{" "}
              {data.progress.lastSubmittedDay ?? "-"}
            </p>
            <p>
              <span className="text-muted-foreground">Synergy Points:</span>{" "}
              {data.user.synergyPoints}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="submissions">
        <TabsList>
          <TabsTrigger value="submissions">Submissions</TabsTrigger>
          <TabsTrigger value="quizzes">Quiz Attempts</TabsTrigger>
          <TabsTrigger value="admin-actions">Admin Actions</TabsTrigger>
          <TabsTrigger value="recruiter">Recruiter Profile</TabsTrigger>
          <TabsTrigger value="remarks">Remarks</TabsTrigger>
        </TabsList>

        <TabsContent value="submissions">
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>GitHub</TableHead>
                  <TableHead>LinkedIn</TableHead>
                  <TableHead>Submitted At</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.submissions.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.dayNumber}</TableCell>
                    <TableCell>{row.status}</TableCell>
                    <TableCell>
                      {row.githubUrl ? (
                        <a href={row.githubUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                          Open <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.linkedinUrl ? (
                        <a href={row.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
                          Open <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{formatDateTimeIST(row.submittedAt)}</TableCell>
                    <TableCell className="text-right">
                      <RejectSubmissionButton
                        submissionId={row.id}
                        dayNumber={row.dayNumber}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="quizzes">
          {data.quizAttempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No quizzes attempted yet</p>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Week</TableHead>
                    <TableHead>Quiz</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.quizAttempts.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.weekNumber}</TableCell>
                      <TableCell>{row.quizTitle}</TableCell>
                      <TableCell>{row.score}</TableCell>
                      <TableCell>{formatDateTimeIST(row.attemptedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="admin-actions">
          {data.adminActions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No admin actions for this user</p>
          ) : (
            <div className="space-y-2">
              {data.adminActions.map((row) => (
                <Card key={row.id}>
                  <CardContent className="space-y-1 pt-4 text-sm">
                    <p className="font-medium">
                      {row.adminName} · {row.actionType}
                    </p>
                    <p className="text-muted-foreground">
                      Reason: {row.reason?.trim() || "-"}
                    </p>
                    <p className="text-muted-foreground">
                      Metadata: {row.metadata ? JSON.stringify(row.metadata) : "-"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTimeIST(row.createdAt)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="recruiter">
          <RecruiterReviewPanel
            studentId={data.student.userId}
            studentName={data.student.fullName}
            review={review}
          />
        </TabsContent>

        <TabsContent value="remarks">
          <StudentRemarksPanel
            studentId={data.student.userId}
            studentName={data.student.fullName}
            remarks={data.remarks}
          />
        </TabsContent>
      </Tabs>

      <div>
        <Link
          href="/admin/students"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Back to Students
        </Link>
      </div>
    </div>
  );
}
