import type { StudentProfile } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ChallengeStudentDetail = {
  kind: "challenge";
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    joinedAt: Date;
    synergyPoints: number;
  };
  profile: StudentProfile;
  enrollment: {
    domain: string;
    status: string;
    daysCompleted: number;
    currentStreak: number;
    longestStreak: number;
    lastSubmittedDay: number | null;
    challenge: { totalDays: number };
  } | null;
  student: {
    userId: string;
    fullName: string;
    isReadyForInterview: boolean;
    enrollmentStatus: string | null;
  };
  progress: {
    totalDays: number;
    daysCompleted: number;
    currentStreak: number;
    longestStreak: number;
    lastSubmittedDay: number | null;
    onTimeCount: number;
    lateCount: number;
  };
  submissions: Array<{
    id: string;
    dayNumber: number;
    status: string;
    githubUrl: string | null;
    linkedinUrl: string | null;
    submittedAt: Date;
  }>;
  quizAttempts: Array<{
    id: string;
    weekNumber: number;
    quizTitle: string;
    score: number;
    attemptedAt: Date;
  }>;
  adminActions: Array<{
    id: string;
    actionType: string;
    metadata: unknown;
    reason: string | null;
    createdAt: Date;
    adminName: string;
  }>;
  remarks: Array<{
    id: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    adminName: string;
  }>;
};

export type HackathonStudentDetail = {
  kind: "hackathon";
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    joinedAt: Date;
    synergyPoints: number;
  };
  hackathon: {
    fullName: string;
    email: string;
    phone: string;
    college: string;
    graduationYear: number;
    entryType: "SOLO" | "TEAM";
    teamName: string | null;
    teamCode: string;
    createdAt: Date;
  };
};

export type StudentDetail = ChallengeStudentDetail | HackathonStudentDetail;

export async function getStudentDetail(
  userId: string,
): Promise<StudentDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      studentProfile: true,
      enrollments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          domain: true,
          status: true,
          daysCompleted: true,
          currentStreak: true,
          longestStreak: true,
          lastSubmittedDay: true,
          challenge: { select: { totalDays: true } },
        },
      },
      hackathonParticipant: {
        select: {
          fullName: true,
          email: true,
          phone: true,
          college: true,
          graduationYear: true,
          createdAt: true,
          team: {
            select: {
              entryType: true,
              teamName: true,
              teamCode: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  if (!user.studentProfile) {
    if (!user.hackathonParticipant) {
      return null;
    }

    const participant = user.hackathonParticipant;
    const entryType = participant.team.entryType === "SOLO" ? "SOLO" : "TEAM";

    return {
      kind: "hackathon",
      user: {
        id: user.id,
        name: participant.fullName.trim() || user.email,
        email: user.email,
        image: user.image,
        joinedAt: participant.createdAt,
        synergyPoints: user.synergyPoints,
      },
      hackathon: {
        fullName: participant.fullName,
        email: participant.email,
        phone: participant.phone,
        college: participant.college,
        graduationYear: participant.graduationYear,
        entryType,
        teamName: entryType === "SOLO" ? null : participant.team.teamName,
        teamCode: participant.team.teamCode,
        createdAt: participant.createdAt,
      },
    };
  }

  const [submissions, quizAttempts, adminActions, remarks] = await Promise.all([
    prisma.submission.findMany({
      where: { userId },
      orderBy: [{ dayNumber: "asc" }, { submittedAt: "desc" }],
      select: {
        id: true,
        dayNumber: true,
        status: true,
        githubUrl: true,
        linkedinUrl: true,
        submittedAt: true,
      },
    }),
    prisma.quizAttempt.findMany({
      where: { userId },
      orderBy: { attemptedAt: "desc" },
      include: {
        quiz: { select: { weekNumber: true, title: true } },
      },
    }),
    prisma.adminAction.findMany({
      where: { targetUserId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        admin: {
          select: {
            email: true,
            studentProfile: { select: { fullName: true } },
          },
        },
      },
    }),
    prisma.adminRemark.findMany({
      where: { studentUserId: userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        admin: {
          select: {
            email: true,
            studentProfile: { select: { fullName: true } },
          },
        },
      },
    }),
  ]);

  const enrollment = user.enrollments[0] ?? null;
  const onTimeCount = submissions.filter(
    (s) => s.status === "ON_TIME" || s.status === "LATE",
  ).length;
  const lateCount = 0;

  return {
    kind: "challenge",
    user: {
      id: user.id,
      name: user.studentProfile.fullName,
      email: user.email,
      image: user.image,
      joinedAt: user.createdAt,
      synergyPoints: user.synergyPoints,
    },
    profile: user.studentProfile,
    enrollment,
    student: {
      userId: user.id,
      fullName: user.studentProfile.fullName,
      isReadyForInterview: user.studentProfile.isReadyForInterview,
      enrollmentStatus: enrollment?.status ?? null,
    },
    progress: {
      totalDays: enrollment?.challenge.totalDays ?? 60,
      daysCompleted: enrollment?.daysCompleted ?? 0,
      currentStreak: enrollment?.currentStreak ?? 0,
      longestStreak: enrollment?.longestStreak ?? 0,
      lastSubmittedDay: enrollment?.lastSubmittedDay ?? null,
      onTimeCount,
      lateCount,
    },
    submissions,
    quizAttempts: quizAttempts.map((attempt) => ({
      id: attempt.id,
      weekNumber: attempt.quiz.weekNumber,
      quizTitle: attempt.quiz.title,
      score: attempt.score,
      attemptedAt: attempt.attemptedAt,
    })),
    adminActions: adminActions.map((action) => ({
      id: action.id,
      actionType: action.actionType,
      metadata: action.metadata,
      reason: action.reason,
      createdAt: action.createdAt,
      adminName:
        action.admin.studentProfile?.fullName?.trim() ||
        action.admin.email ||
        "Admin",
    })),
    remarks: remarks.map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      adminName:
        r.admin.studentProfile?.fullName?.trim() || r.admin.email || "Admin",
    })),
  };
}
