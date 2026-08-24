import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink, Flame } from "lucide-react";
import { UserType } from "@prisma/client";
import { auth } from "@/auth";
import { SubmissionHeatmap } from "@/components/dashboard/submission-heatmap";
import { AppHeader } from "@/components/shared/app-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateIST } from "@/lib/date-utils";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/utils";
import { getHeatmapData } from "@/features/dashboard/get-heatmap-data";
import {
  getPublicEnrollmentId,
  getPublicProfile,
} from "@/features/profile/get-public-profile";
import { formatExperienceBucket } from "@/lib/profile-display";
import { isClaudeEnabled } from "@/lib/feature-flags";
import { shouldShowClaudeBanner } from "@/features/user/check-claude-enrollment";
import { ClaudeEnrollmentBanner } from "@/components/shared/claude-enrollment-banner";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function domainBadgeClass(domain: string): string {
  if (domain === "AI") return "border-domains-ai/50 bg-domains-ai-bg text-domains-ai";
  if (domain === "DS") return "border-domains-ds/50 bg-domains-ds-bg text-domains-ds";
  return "border-domains-se/50 bg-domains-se-bg text-domains-se";
}

export default async function PublicStudentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;
  if (session.user.id === id) {
    redirect("/profile");
  }

  const claudeEnabled = isClaudeEnabled();
  const [publicProfile, enrollmentId, image, claudeBanner] = await Promise.all([
    getPublicProfile(id),
    getPublicEnrollmentId(id),
    prisma.user.findUnique({ where: { id }, select: { image: true } }),
    claudeEnabled
      ? shouldShowClaudeBanner(session.user.id)
      : Promise.resolve({ show: false, startsAt: null as Date | null }),
  ]);
  if (!publicProfile) {
    notFound();
  }

  const heatmapData = enrollmentId
    ? await getHeatmapData(enrollmentId, { includeSubmissionDetails: false })
    : [];

  const headerUser = {
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    image: session.user.image ?? null,
    role: session.user.role ?? "STUDENT",
    isAdmin: session.user.isAdmin ?? false,
  };

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <AppHeader user={headerUser} />
      {claudeBanner.show && claudeBanner.startsAt ? (
        <ClaudeEnrollmentBanner claudeStartsAt={claudeBanner.startsAt} />
      ) : null}
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6">
        <Link
          href="/dashboard"
          className={cn(buttonVariants({ variant: "outline" }), "inline-flex")}
        >
          Back to Dashboard
        </Link>

        <Card>
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
            <Avatar className="size-20 border">
              {image?.image ? <AvatarImage src={image.image} alt={publicProfile.fullName} /> : null}
              <AvatarFallback className="text-xl">
                {initials(publicProfile.fullName)}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <h1 className="font-display text-3xl font-semibold">{publicProfile.fullName}</h1>
              <div className="flex flex-wrap items-center gap-2">
                {publicProfile.domain ? (
                  <Badge variant="outline" className={domainBadgeClass(publicProfile.domain)}>
                    {publicProfile.domain}
                  </Badge>
                ) : (
                  <Badge variant="outline">—</Badge>
                )}
                {publicProfile.isReadyForInterview ? (
                  <Badge variant="secondary">Ready for Interview</Badge>
                ) : null}
              </div>
              {publicProfile.userType === UserType.STUDENT ? (
                <p className="text-sm text-muted-foreground">
                  {publicProfile.college}
                  {publicProfile.graduationYear != null
                    ? ` · Class of ${publicProfile.graduationYear}`
                    : null}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {publicProfile.role}
                  {publicProfile.organization
                    ? ` at ${publicProfile.organization}`
                    : null}
                  {publicProfile.yearsExperience != null
                    ? ` · ${formatExperienceBucket(publicProfile.yearsExperience)} experience`
                    : null}
                </p>
              )}
              <div className="flex flex-wrap gap-3 pt-1">
                {publicProfile.linkedinUrl ? (
                  <Link
                    href={publicProfile.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary underline"
                  >
                    LinkedIn <ExternalLink className="size-3.5" />
                  </Link>
                ) : null}
                {publicProfile.githubUsername ? (
                  <Link
                    href={`https://github.com/${publicProfile.githubUsername}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary underline"
                  >
                    GitHub <ExternalLink className="size-3.5" />
                  </Link>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">
                Member since {formatDateIST(publicProfile.joinedAt)}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Days Completed</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 font-display text-3xl font-semibold">
              {publicProfile.daysCompleted} / 60
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Current Streak</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="font-display text-3xl font-semibold">{publicProfile.currentStreak}</p>
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Flame className="size-3.5 text-orange-500" /> Ongoing streak
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Longest Streak</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 font-display text-3xl font-semibold">
              {publicProfile.longestStreak}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Skills</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {publicProfile.skills.length > 0 ? (
              publicProfile.skills.map((skill) => (
                <Badge key={skill} variant="outline">
                  {skill}
                </Badge>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No skills listed.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>60-Day Journey</CardTitle>
          </CardHeader>
          <CardContent>
            <SubmissionHeatmap data={heatmapData} interactive={false} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
