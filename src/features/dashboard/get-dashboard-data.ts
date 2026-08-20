import type {
  Domain,
  EnrollmentStatus,
  Role,
  SubmissionStatus,
} from "@prisma/client";
import { getCurrentDayNumber } from "@/lib/date-utils";
import { resolveDashboardEnrollment } from "@/features/enrollment/resolve-dashboard-enrollment";
import { getUserWithProfile } from "@/features/user/get-user-with-profile";
import { getDailyTasksCached } from "@/features/challenge/get-daily-tasks-cached";
import { prisma } from "@/lib/db";

/** User row missing (deleted) — the page should sign the session out. */
export type DashboardDataNoUser = {
  hasUser: false;
};

export type DashboardDataNoEnrollment = {
  hasUser: true;
  hasEnrollment: false;
  profile: DashboardDataWithEnrollment["profile"] | null;
  enrollment: DashboardDataWithEnrollment["enrollment"] | null;
};

export type DashboardDataWithEnrollment = {
  hasUser: true;
  hasEnrollment: true;
  user: {
    id: string;
    name: string | null;
    email: string;
    role: Role;
  };
  profile: {
    fullName: string;
    domain: string;
    userType: "STUDENT" | "PROFESSIONAL";
    college: string | null;
    organization: string | null;
    role: string | null;
    referralCode: string;
    isReadyForInterview: boolean;
    isCampusAmbassadorCandidate: boolean;
    ambassadorDismissedAt: Date | null;
    phone: string | null;
    phoneVerified: boolean;
  };
  enrollment: {
    id: string;
    userId: string;
    challengeId: string;
    domain: Domain;
    startedAt: Date;
    currentDay: number;
    totalDays: number;
    daysCompleted: number;
    currentStreak: number;
    longestStreak: number;
    status: EnrollmentStatus;
    challenge: {
      title: string;
      startsAt: Date | null;
    };
  };
  todayTask: {
    id: string;
    dayNumber: number;
    title: string;
    difficulty: string;
    estimatedMinutes: number;
  } | null;
  isTodayCompleted: boolean;
  recentSubmissions: Array<{
    id: string;
    dayNumber: number;
    status: SubmissionStatus;
    submittedAt: Date;
  }>;
  referralCount: number;
  /** All submissions for the resolved enrollment (single fetch, threaded into the heatmap). */
  submissions: Array<{
    id: string;
    dayNumber: number;
    status: SubmissionStatus;
    submittedAt: Date;
    githubUrl: string | null;
    linkedinUrl: string | null;
  }>;
};

export type DashboardData =
  | DashboardDataNoUser
  | DashboardDataNoEnrollment
  | DashboardDataWithEnrollment;

export async function getDashboardData(
  userId: string,
  enrollmentId?: string | null,
): Promise<DashboardData> {
  const user = await getUserWithProfile(userId);

  if (!user) {
    return { hasUser: false };
  }

  if (!user.studentProfile) {
    return { hasUser: true, hasEnrollment: false, profile: null, enrollment: null };
  }

  const profileSnapshot: DashboardDataWithEnrollment["profile"] = {
    fullName: user.studentProfile.fullName,
    domain: user.studentProfile.domain,
    userType: user.studentProfile.userType,
    college: user.studentProfile.college,
    organization: user.studentProfile.organization,
    role: user.studentProfile.role,
    referralCode: user.studentProfile.referralCode,
    isReadyForInterview: user.studentProfile.isReadyForInterview,
    isCampusAmbassadorCandidate: user.studentProfile.isCampusAmbassadorCandidate,
    ambassadorDismissedAt: user.studentProfile.ambassadorDismissedAt,
    phone: user.studentProfile.phone,
    phoneVerified: user.studentProfile.phoneVerified,
  };

  const enrollment = await resolveDashboardEnrollment(
    userId,
    enrollmentId ?? undefined,
    user.studentProfile.domain,
  );

  if (!enrollment) {
    return {
      hasUser: true,
      hasEnrollment: false,
      profile: profileSnapshot,
      enrollment: null,
    };
  }

  const currentDay = getCurrentDayNumber(enrollment, enrollment.challenge);
  const totalDays = enrollment.challenge.totalDays;

  // Single submissions fetch — derives today-completed, recent-7, and the heatmap day map.
  const allSubmissions = await prisma.submission.findMany({
    where: { enrollmentId: enrollment.id },
    orderBy: { submittedAt: "desc" },
    select: {
      id: true,
      dayNumber: true,
      status: true,
      submittedAt: true,
      githubUrl: true,
      linkedinUrl: true,
    },
  });

  const isTodayCompleted =
    currentDay >= 1 && allSubmissions.some((s) => s.dayNumber === currentDay);

  const recentSubmissions = allSubmissions.slice(0, 7).map((s) => ({
    id: s.id,
    dayNumber: s.dayNumber,
    status: s.status,
    submittedAt: s.submittedAt,
  }));

  let todayTask: DashboardDataWithEnrollment["todayTask"] = null;
  const isChallengeComplete =
    enrollment.status === "COMPLETED" || enrollment.daysCompleted >= totalDays;

  if (!isChallengeComplete && !isTodayCompleted) {
    const tasks = await getDailyTasksCached(enrollment.challengeId);
    const task = tasks.find((t) => t.dayNumber === currentDay);
    if (task) {
      const titleRow = await prisma.dailyTask.findUnique({
        where: {
          challengeId_dayNumber: {
            challengeId: enrollment.challengeId,
            dayNumber: currentDay,
          },
        },
        select: { title: true },
      });
      if (titleRow) {
        todayTask = {
          id: task.id,
          dayNumber: task.dayNumber,
          title: titleRow.title,
          difficulty: task.difficulty,
          estimatedMinutes: task.estimatedMinutes,
        };
      }
    }
  }

  const referralCount = await prisma.referral.count({
    where: { referrerId: userId },
  });

  return {
    hasUser: true,
    hasEnrollment: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    profile: profileSnapshot,
    enrollment: {
      id: enrollment.id,
      userId: enrollment.userId,
      challengeId: enrollment.challengeId,
      domain: enrollment.domain,
      startedAt: enrollment.startedAt,
      currentDay,
      totalDays,
      daysCompleted: enrollment.daysCompleted,
      currentStreak: enrollment.currentStreak,
      longestStreak: enrollment.longestStreak,
      status: enrollment.status,
      challenge: {
        title: enrollment.challenge.title,
        startsAt: enrollment.challenge.startsAt,
      },
    },
    todayTask,
    isTodayCompleted,
    recentSubmissions,
    referralCount,
    submissions: allSubmissions,
  };
}
