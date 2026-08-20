import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Calendar,
  CheckCircle,
  CheckCircle2,
  Clock,
  Flame,
  Users,
} from "lucide-react";
import { auth } from "@/auth";
import { AppHeader } from "@/components/shared/app-header";
// import { CommunityLeaderboard } from "@/components/dashboard/community-leaderboard"; // hidden post-launch
import { EnrollmentEndedScreen } from "@/components/dashboard/enrollment-ended-screen";
import { QuizUnlockBanner } from "@/components/dashboard/quiz-unlock-banner";
import { ConsentRefreshBanner } from "@/components/legal/consent-refresh-banner";
import { needsReconsent } from "@/features/legal/needs-reconsent";
import { PastMissedChallengeToast } from "@/components/dashboard/past-missed-challenge-toast";
import { SubmissionHeatmap } from "@/components/dashboard/submission-heatmap";
import {
  getDashboardData,
  type DashboardDataWithEnrollment,
} from "@/features/dashboard/get-dashboard-data";
import { getHeatmapData } from "@/features/dashboard/get-heatmap-data";
// import { getLeaderboard } from "@/features/dashboard/get-leaderboard"; // hidden post-launch
import { getAvailableQuiz } from "@/features/quiz/get-available-quiz";
import { getQuizAttemptHistory } from "@/features/quiz/get-quiz-attempt-history";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateIST, isEnrollmentPreStart } from "@/lib/date-utils";
import { PreStartDashboard } from "@/components/dashboard/pre-start-dashboard";
import { prisma } from "@/lib/db";
import { hackathonRedirectForProfilelessUser, isUserRegistered } from "@/features/hackathon/registration-status";
import { Domain } from "@prisma/client";
import { ClaudeChallengeModal } from "@/components/dashboard/claude-challenge-modal";
import { getUserActiveEnrollments } from "@/features/enrollment/get-user-enrollments";
import { isClaudeEnabled, isOtpVerificationRequired } from "@/lib/feature-flags";
import { shouldShowClaudeBanner } from "@/features/user/check-claude-enrollment";
import { ClaudeEnrollmentBanner } from "@/components/shared/claude-enrollment-banner";
import { CampusAmbassadorBanner } from "@/components/dashboard/campus-ambassador-banner";
import { PhoneVerifyNudge } from "@/components/dashboard/phone-verify-nudge";
import { ClaudeFAQ } from "@/components/shared/claude-faq";
import { DashboardWalkthrough } from "@/components/dashboard/dashboard-walkthrough";
import { ClaudeDay0SharePrompt } from "@/components/claude/claude-day0-share-prompt";
import { HackathonPromoModal } from "@/components/dashboard/hackathon-promo-modal";

function readQueryParam(
  query: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const raw = query[key];
  if (Array.isArray(raw)) return raw[0]?.trim() ?? "";
  return raw?.trim() ?? "";
}

function stripQueryKeys(
  query: Record<string, string | string[] | undefined>,
  keys: string[],
): string {
  const remove = new Set(keys);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (remove.has(k)) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item) sp.append(k, item);
      }
    } else if (typeof v === "string" && v.trim() !== "") {
      sp.append(k, v);
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function challengeHref(enrollmentId: string, path: string): string {
  const q = new URLSearchParams();
  q.set("challenge", enrollmentId);
  return `${path}?${q.toString()}`;
}

// function parseLeaderboardDomain(
//   value: string,
// ): "AI" | "DS" | "SE" | "CLAUDE" | "ALL" {
//   if (
//     value === "AI" ||
//     value === "DS" ||
//     value === "SE" ||
//     value === "CLAUDE"
//   ) {
//     return value;
//   }
//   return "ALL";
// }

function difficultyPillClass(difficulty: string): string {
  const d = difficulty.toLowerCase();
  if (d.includes("easy"))
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400";
  if (d.includes("hard"))
    return "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400";
  return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const query = await searchParams;
  const showPastMissedToast =
    readQueryParam(query, "toast") === "past-missed";
  const dashboardPathWithoutToast = `/dashboard${stripQueryKeys(query, ["toast"])}`;
  const claudeEnabled = isClaudeEnabled();
  // Leaderboard hidden temporarily — to be optimized and re-enabled post-launch
  // let leaderboardDomain = parseLeaderboardDomain(
  //   readQueryParam(query, "lb_domain"),
  // );
  // if (!claudeEnabled && leaderboardDomain === "CLAUDE") {
  //   leaderboardDomain = "ALL";
  // }
  // const leaderboardSearch = readQueryParam(query, "lb_search");

  const selectedEnrollmentId =
    readQueryParam(query, "challenge") || undefined;

  const [allEnrollments, data, isHackathonRegistered] = await Promise.all([
    getUserActiveEnrollments(session.user.id),
    getDashboardData(session.user.id, selectedEnrollmentId),
    isUserRegistered(session.user.id),
  ]);

  if (!data.hasUser) {
    redirect("/api/auth/signout?callbackUrl=/login");
  }

  if (!data.profile || !data.enrollment) {
    const hx = await hackathonRedirectForProfilelessUser(session.user.id);
    if (hx) redirect(hx);
    redirect("/register");
  }

  const dashboardData = data as DashboardDataWithEnrollment;

  const headerUser = {
    name: dashboardData.profile.fullName,
    email: session.user.email ?? "",
    image: session.user.image ?? null,
    role: session.user.role ?? "STUDENT",
    isAdmin: session.user.isAdmin ?? false,
  };
  const { enrollment, profile, todayTask, isTodayCompleted } = dashboardData;

  const hasClaudeEnrollment = allEnrollments.some((e) => e.domain === "CLAUDE");
  const claudeEnrollment = allEnrollments.find((e) => e.domain === "CLAUDE");
  let hasClaudeDay1Submission = false;
  if (claudeEnrollment) {
    const day1 = await prisma.submission.findUnique({
      where: {
        enrollmentId_dayNumber: {
          enrollmentId: claudeEnrollment.id,
          dayNumber: 1,
        },
      },
      select: { id: true },
    });
    hasClaudeDay1Submission = day1 != null;
  }
  const shouldShowAmbassadorBanner = profile.userType === "STUDENT";

  const isPreStart = isEnrollmentPreStart(
    dashboardData.enrollment,
    dashboardData.enrollment.challenge,
  );

  const claudeBanner = claudeEnabled
    ? await shouldShowClaudeBanner(session.user.id, hasClaudeEnrollment)
    : { show: false, startsAt: null as Date | null };

  if (dashboardData.enrollment.status === "ABANDONED") {
    const endedAction = await prisma.adminAction.findFirst({
      where: {
        targetUserId: session.user.id,
        actionType: "REMOVE_FROM_CHALLENGE",
      },
      orderBy: { createdAt: "desc" },
      select: {
        reason: true,
        createdAt: true,
        admin: {
          select: {
            name: true,
            email: true,
            studentProfile: { select: { fullName: true } },
          },
        },
      },
    });
    const adminName =
      endedAction?.admin.studentProfile?.fullName?.trim() ||
      endedAction?.admin.name?.trim() ||
      endedAction?.admin.email ||
      "An admin";

    return (
      <div className="relative flex min-h-svh flex-col bg-muted/30">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[360px] bg-gradient-to-b from-primary/20 via-violet-500/10 to-transparent sm:h-[440px]"
        />
        <AppHeader
          user={headerUser}
          userEnrollments={allEnrollments}
          activeEnrollmentId={dashboardData.enrollment.id}
          isHackathonRegistered={isHackathonRegistered}
          headerDomain={dashboardData.enrollment.domain}
          domain={dashboardData.profile.domain as Domain}
        />
        {!hasClaudeEnrollment && claudeBanner.show && claudeBanner.startsAt ? (
          <ClaudeEnrollmentBanner
            claudeStartsAt={claudeBanner.startsAt}
            useSharedModal
          />
        ) : null}
        {shouldShowAmbassadorBanner ? (
          <CampusAmbassadorBanner
            alreadyApplied={profile.isCampusAmbassadorCandidate}
          />
        ) : null}
        <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1">
          <EnrollmentEndedScreen
            studentName={dashboardData.profile.fullName}
            adminName={adminName}
            reason={endedAction?.reason ?? null}
            endedAt={endedAction?.createdAt ?? new Date()}
          />
        </main>
      </div>
    );
  }

  const showClaudeModal = claudeBanner.show && !!claudeBanner.startsAt;
  const claudeModalStartsAt = claudeBanner.startsAt;

  if (isPreStart) {
    return (
      <div className="relative flex min-h-svh flex-col bg-muted/30">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[360px] bg-gradient-to-b from-primary/20 via-violet-500/10 to-transparent sm:h-[440px]"
        />
        <AppHeader
          user={headerUser}
          userEnrollments={allEnrollments}
          activeEnrollmentId={dashboardData.enrollment.id}
          isHackathonRegistered={isHackathonRegistered}
          headerDomain={dashboardData.enrollment.domain}
          domain={dashboardData.profile.domain as Domain}
        />
        {!hasClaudeEnrollment && claudeBanner.show && claudeBanner.startsAt ? (
          <ClaudeEnrollmentBanner
            claudeStartsAt={claudeBanner.startsAt}
            useSharedModal
          />
        ) : null}
        {shouldShowAmbassadorBanner ? (
          <CampusAmbassadorBanner
            alreadyApplied={profile.isCampusAmbassadorCandidate}
          />
        ) : null}
        {hasClaudeEnrollment ? (
          <ClaudeDay0SharePrompt hasDay1Submission={hasClaudeDay1Submission} />
        ) : null}
        {showPastMissedToast ? (
          <PastMissedChallengeToast
            trigger={showPastMissedToast}
            cleanPath={dashboardPathWithoutToast}
          />
        ) : null}
        <HackathonPromoModal />
        <div className="relative z-10 flex-1">
        <PreStartDashboard
          enrollment={{
            id: dashboardData.enrollment.id,
            domain: dashboardData.enrollment.domain,
          }}
          challenge={{
            title: dashboardData.enrollment.challenge.title,
            startsAt: dashboardData.enrollment.challenge.startsAt!,
          }}
        />
        </div>
      </div>
    );
  }

  const [heatmapData, quizAvailability, quizHistory] = await Promise.all([
    getHeatmapData(dashboardData.enrollment.id, {
      enrollment: dashboardData.enrollment,
      submissions: dashboardData.submissions,
    }),
    // getLeaderboard({ ... }), // disabled with leaderboard section
    getAvailableQuiz(session.user.id, dashboardData.enrollment),
    getQuizAttemptHistory(session.user.id, dashboardData.enrollment),
  ]);

  const mustReconsent = await needsReconsent(session.user.id);

  const progressPct = Math.min(
    100,
    Math.round((enrollment.currentDay / enrollment.totalDays) * 100),
  );
  const isChallengeComplete =
    enrollment.status === "COMPLETED" ||
    enrollment.daysCompleted >= enrollment.totalDays;

  return (
    <div className="relative flex min-h-svh flex-col bg-muted/30">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[360px] bg-gradient-to-b from-primary/20 via-violet-500/10 to-transparent sm:h-[440px]"
      />
      <AppHeader
        user={headerUser}
        userEnrollments={allEnrollments}
        activeEnrollmentId={dashboardData.enrollment.id}
        isHackathonRegistered={isHackathonRegistered}
        headerDomain={dashboardData.enrollment.domain}
        domain={dashboardData.profile.domain as Domain}
      />
      {!hasClaudeEnrollment && claudeBanner.show && claudeBanner.startsAt ? (
        <ClaudeEnrollmentBanner
          claudeStartsAt={claudeBanner.startsAt}
          useSharedModal
        />
      ) : null}
      {shouldShowAmbassadorBanner ? (
        <CampusAmbassadorBanner
          alreadyApplied={profile.isCampusAmbassadorCandidate}
        />
      ) : null}
      {showClaudeModal && claudeModalStartsAt ? (
        <ClaudeChallengeModal startsAt={claudeModalStartsAt} />
      ) : null}
      <HackathonPromoModal />
      {hasClaudeEnrollment ? (
        <ClaudeDay0SharePrompt hasDay1Submission={hasClaudeDay1Submission} />
      ) : null}
      {showPastMissedToast ? (
        <PastMissedChallengeToast
          trigger={showPastMissedToast}
          cleanPath={dashboardPathWithoutToast}
        />
      ) : null}
      {isOtpVerificationRequired() ? (
        <PhoneVerifyNudge
          phone={profile.phone}
          phoneVerified={profile.phoneVerified}
        />
      ) : null}
      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 sm:px-6">
        <ConsentRefreshBanner needsReconsent={mustReconsent} />
        {quizAvailability.banner ? (
          <div className="mb-6">
            <QuizUnlockBanner
              weekNumber={quizAvailability.banner.weekNumber}
              quizId={quizAvailability.banner.quizId}
              title={quizAvailability.banner.title}
              questionCount={quizAvailability.banner.questionCount}
            />
          </div>
        ) : null}

        <Card className="shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-2xl">Your 60-Day Journey</CardTitle>
            <CardDescription>
              {enrollment.daysCompleted} days complete · Day {enrollment.currentDay} of{" "}
              {enrollment.totalDays}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 px-5 pb-6">
            <SubmissionHeatmap
              data={heatmapData}
              challengeEnrollmentId={enrollment.id}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s Task</CardTitle>
            <CardDescription>
              {enrollment.domain} challenge · IST day {enrollment.currentDay}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isChallengeComplete ? (
              <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 p-6 text-center">
                <p className="font-display text-lg font-semibold">
                  🎉 Challenge complete! You&apos;re ready for interview!
                </p>
                {profile.isReadyForInterview ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Your profile is marked ready for interview opportunities.
                  </p>
                ) : null}
              </div>
            ) : isTodayCompleted ? (
              <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-muted/25 p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-6 shrink-0" aria-hidden />
                    <span className="font-display text-lg font-semibold">
                      Completed
                    </span>
                  </div>
                  <Badge
                    variant="secondary"
                    className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                  >
                    Done for today
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  You&apos;ve submitted for today (IST). Next task unlocks on
                  the next calendar day.
                </p>
                <Link
                  href={challengeHref(
                    enrollment.id,
                    "/challenge/today",
                  )}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "default" }),
                    "w-full justify-center sm:w-auto",
                  )}
                >
                  View submission
                </Link>
              </div>
            ) : todayTask ? (
              <div className="flex flex-col gap-6 sm:flex-row sm:items-stretch">
                <div className="flex shrink-0 items-start justify-center sm:w-24 sm:flex-col sm:items-center sm:justify-start">
                  <span className="font-display text-5xl font-bold leading-none text-primary tabular-nums">
                    {todayTask.dayNumber}
                  </span>
                  <span className="mt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase sm:text-center">
                    Day
                  </span>
                </div>
                <div className="min-w-0 flex-1 space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-semibold tracking-wide",
                        difficultyPillClass(todayTask.difficulty),
                      )}
                    >
                      {todayTask.difficulty}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Clock className="size-4 shrink-0" aria-hidden />~
                      {todayTask.estimatedMinutes} min
                    </span>
                  </div>
                  <h3 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                    {todayTask.title}
                  </h3>
                  <Link
                    href={challengeHref(
                      enrollment.id,
                      "/challenge/today",
                    )}
                    className={cn(
                      buttonVariants({ variant: "default" }),
                      "inline-flex h-11 w-full items-center justify-center gap-2 font-medium sm:w-auto sm:px-8",
                    )}
                  >
                    Start Today&apos;s Challenge
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No task found for this day. If this looks wrong, contact
                support.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-5 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 lg:gap-6">
          <Card className="relative overflow-hidden">
            <CardContent className="p-6 pt-6">
              <Calendar
                className="absolute top-5 right-5 size-5 text-muted-foreground/70"
                aria-hidden
              />
              <p className="font-display text-4xl font-bold tabular-nums">
                {enrollment.currentDay}
              </p>
              <p className="mt-2 text-sm font-medium tracking-wide text-muted-foreground uppercase">
                Day {enrollment.currentDay} of {enrollment.totalDays}
              </p>
              <div className="mt-4">
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPct}
                  aria-label="Calendar progress"
                  className="relative h-1 w-full overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Calendar progress (IST) from your start date
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <CardContent className="p-6 pt-6">
              <Flame
                className="absolute top-5 right-5 size-5 text-orange-500"
                aria-hidden
              />
              <p className="font-display text-4xl font-bold tabular-nums">
                {enrollment.currentStreak}
              </p>
              <p className="mt-2 text-sm font-medium tracking-wide text-muted-foreground uppercase">
                Current streak
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                Longest: {enrollment.longestStreak}
              </p>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <CardContent className="p-6 pt-6">
              <CheckCircle
                className="absolute top-5 right-5 size-5 text-emerald-500"
                aria-hidden
              />
              <p className="font-display text-4xl font-bold tabular-nums">
                {enrollment.daysCompleted}
              </p>
              <p className="mt-2 text-sm font-medium tracking-wide text-muted-foreground uppercase">
                Days completed
              </p>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <CardContent className="p-6 pt-6">
              <Users
                className="absolute top-5 right-5 size-5 text-domains-ai"
                aria-hidden
              />
              <p className="font-display text-4xl font-bold tabular-nums">
                {dashboardData.referralCount}
              </p>
              <p className="mt-2 text-sm font-medium tracking-wide text-muted-foreground uppercase">
                Referrals
              </p>
              <p className="mt-3 font-mono text-xs text-muted-foreground">
                Your code: {profile.referralCode}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Leaderboard hidden temporarily — to be optimized and re-enabled post-launch
        <CommunityLeaderboard
          rows={leaderboard.rows}
          totalCount={leaderboard.totalCount}
          claudeEnabled={claudeEnabled}
          filters={{
            domain: leaderboardDomain,
            search: leaderboardSearch,
          }}
        />
        */}

        {quizAvailability.reason === "ready" &&
        quizAvailability.quiz &&
        !quizAvailability.banner ? (
          <Card>
            <CardHeader>
              <CardTitle>
                Week {quizAvailability.quiz.weekNumber} quiz available!
              </CardTitle>
              <CardDescription>
                {quizAvailability.quiz.title} · {quizAvailability.quiz.domain}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href={`/quiz/${quizAvailability.quiz.id}`}
                className={cn(buttonVariants({ variant: "default" }), "inline-flex")}
              >
                Take quiz
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {quizAvailability.reason === "already_attempted" &&
        quizAvailability.attempt?.quiz ? (
          <Card className="border-muted-foreground/20 bg-muted/40">
            <CardHeader>
              <CardTitle className="text-base text-muted-foreground">
                Week {quizAvailability.attempt.quiz.weekNumber} quiz: scored{" "}
                {quizAvailability.attempt.score}/10
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {quizAvailability.attempt.quiz.title}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href={`/quiz/${quizAvailability.attempt.quiz.id}`}
                className={cn(
                  buttonVariants({ variant: "secondary" }),
                  "inline-flex text-muted-foreground",
                )}
              >
                View results
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {quizHistory.length > 0 ? (
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Your quiz history</CardTitle>
              <CardDescription>
                Past attempts: open to review results (current week&apos;s quiz is
                above when applicable).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {quizHistory.map((row) => (
                  <li
                    key={row.attemptId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/25 px-4 py-3 shadow-sm"
                  >
                    <span className="text-muted-foreground">
                      Week {row.weekNumber}: scored {row.score}/10
                      <span className="ml-1 text-xs">· {row.title}</span>
                    </span>
                    <Link
                      href={`/quiz/${row.quizId}`}
                      className={cn(
                        buttonVariants({ variant: "ghost", size: "sm" }),
                        "shrink-0",
                      )}
                    >
                      View results
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Last 7 submissions</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboardData.recentSubmissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No submissions yet. Complete Day 1 to get started.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {dashboardData.recentSubmissions.map((s) => (
                  <li key={s.id}>
                    <span className="font-medium">Day {s.dayNumber}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · completed on {formatDateIST(s.submittedAt)} ·{" "}
                    </span>
                    <span className="text-muted-foreground">
                      {s.status === "ON_TIME" || s.status === "LATE"
                        ? "on time"
                        : "late"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {enrollment.domain === "CLAUDE" ? <ClaudeFAQ /> : null}
      </main>
      <DashboardWalkthrough />
    </div>
  );
}
