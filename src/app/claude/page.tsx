import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard-hub/dashboard-shell";
import {
  ClaudeChallengeView,
  type ClaudeContinueInfo,
} from "@/components/claude/claude-challenge-view";
import { CLAUDE_SECTION_NAV_HASH } from "@/components/claude/claude-section-nav";
import { EnrollmentEndedScreen } from "@/components/dashboard/enrollment-ended-screen";
import { PreStartDashboard } from "@/components/dashboard/pre-start-dashboard";
import { ConsentRefreshBanner } from "@/components/legal/consent-refresh-banner";
import {
  getDashboardData,
  type DashboardDataWithEnrollment,
} from "@/features/dashboard/get-dashboard-data";
import { getHeatmapData } from "@/features/dashboard/get-heatmap-data";
import { needsReconsent } from "@/features/legal/needs-reconsent";
import { getAvailableQuiz } from "@/features/quiz/get-available-quiz";
import { getQuizAttemptHistory } from "@/features/quiz/get-quiz-attempt-history";
import { isEnrollmentPreStart, formatDateIST } from "@/lib/date-utils";
import { prisma } from "@/lib/db";
import { mapHeatmapCellToUiState } from "@/features/claude/map-day-ui-state";
import { findChallengeEnrollment } from "@/repositories/learning";

function buildContinueInfo(
  data: DashboardDataWithEnrollment,
  cells: Awaited<ReturnType<typeof getHeatmapData>>,
): ClaudeContinueInfo {
  const { enrollment, todayTask, isTodayCompleted } = data;
  const isChallengeComplete =
    enrollment.status === "COMPLETED" ||
    enrollment.daysCompleted >= enrollment.totalDays;

  if (isChallengeComplete) {
    return {
      mode: "complete",
      dayNumber: null,
      title: null,
    };
  }

  if (!isTodayCompleted && todayTask) {
    return {
      mode: enrollment.daysCompleted === 0 ? "start" : "continue",
      dayNumber: todayTask.dayNumber,
      title: todayTask.title,
    };
  }

  const available = cells.find(
    (c) => mapHeatmapCellToUiState(c, enrollment.currentDay) === "available",
  );
  if (available) {
    return {
      mode: enrollment.daysCompleted === 0 ? "start" : "continue",
      dayNumber: available.dayNumber,
      title: available.taskTitle,
    };
  }

  return {
    mode: "caught_up",
    dayNumber: enrollment.currentDay,
    title: null,
  };
}

export default async function ClaudeTrackPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const enrollmentForDomain = await findChallengeEnrollment(session.user.id, {
    domain: "CLAUDE",
  });

  if (!enrollmentForDomain) {
    redirect("/dashboard");
  }

  const data = await getDashboardData(
    session.user.id,
    enrollmentForDomain.id,
  );

  if (!data.hasUser) {
    redirect("/api/auth/signout?callbackUrl=/login");
  }

  if (!data.profile || !data.enrollment) {
    redirect("/dashboard");
  }

  const dashboardData = data as DashboardDataWithEnrollment;
  const shellUser = {
    name: dashboardData.profile.fullName,
    email: session.user.email ?? "",
    image: session.user.image ?? null,
  };
  const isAdmin = session.user.isAdmin ?? false;

  const isPreStart = isEnrollmentPreStart(
    dashboardData.enrollment,
    dashboardData.enrollment.challenge,
  );

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
      <DashboardShell
        user={shellUser}
        isAdmin={isAdmin}
        collapsible
        sectionNavItems={CLAUDE_SECTION_NAV_HASH}
      >
        <EnrollmentEndedScreen
          studentName={dashboardData.profile.fullName}
          adminName={adminName}
          reason={endedAction?.reason ?? null}
          endedAt={endedAction?.createdAt ?? new Date()}
        />
      </DashboardShell>
    );
  }

  if (isPreStart) {
    return (
      <DashboardShell
        user={shellUser}
        isAdmin={isAdmin}
        collapsible
        sectionNavItems={CLAUDE_SECTION_NAV_HASH}
      >
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
      </DashboardShell>
    );
  }

  const [heatmapData, quizAvailability, quizHistory] = await Promise.all([
    getHeatmapData(dashboardData.enrollment.id, {
      enrollment: dashboardData.enrollment,
      submissions: dashboardData.submissions,
    }),
    getAvailableQuiz(session.user.id, dashboardData.enrollment),
    getQuizAttemptHistory(session.user.id, dashboardData.enrollment),
  ]);

  const mustReconsent = await needsReconsent(session.user.id);
  const continueInfo = buildContinueInfo(dashboardData, heatmapData);
  const recentSubmissions = dashboardData.recentSubmissions.map((s) => ({
    id: s.id,
    dayNumber: s.dayNumber,
    status: s.status,
    submittedAtLabel: formatDateIST(s.submittedAt),
  }));

  return (
    <DashboardShell
      user={shellUser}
      isAdmin={isAdmin}
      collapsible
      sectionNavItems={CLAUDE_SECTION_NAV_HASH}
    >
      <div className="px-5 pt-4 sm:px-8">
        <ConsentRefreshBanner needsReconsent={mustReconsent} />
      </div>
      <ClaudeChallengeView
        enrollmentId={dashboardData.enrollment.id}
        currentDay={dashboardData.enrollment.currentDay}
        totalDays={dashboardData.enrollment.totalDays}
        daysCompleted={dashboardData.enrollment.daysCompleted}
        cells={heatmapData}
        continueInfo={continueInfo}
        recentSubmissions={recentSubmissions}
        quizAvailability={quizAvailability}
        quizHistory={quizHistory}
        isReadyForInterview={dashboardData.profile.isReadyForInterview}
      />
    </DashboardShell>
  );
}
