import { formatDistanceToNow } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db";
import {
  countRegisteredUsers,
  getRegistrationDatesSince,
} from "@/features/admin/get-registration-dates";

const IST = "Asia/Kolkata";

function getIstDayBounds(now: Date = new Date()) {
  const istDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const start = new Date(`${istDay}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function getIstRollingWeekBounds(now: Date = new Date()) {
  const { start: todayStart } = getIstDayBounds(now);
  const thisWeekStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    thisWeekStart,
    thisWeekEnd: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000),
    lastWeekStart,
    lastWeekEnd: thisWeekStart,
  };
}

function getLast14IstDayKeys(now: Date = new Date()): string[] {
  const { start: todayStart } = getIstDayBounds(now);
  const keys: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const dayStart = new Date(todayStart.getTime() - i * 24 * 60 * 60 * 1000);
    keys.push(formatInTimeZone(dayStart, IST, "yyyy-MM-dd"));
  }
  return keys;
}

export function formatAdminActionType(actionType: string): string {
  return actionType
    .toLowerCase()
    .split("_")
    .map((part, index) => {
      if (index === 0) return `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`;
      return part;
    })
    .join(" ");
}

export async function getOverviewStats() {
  const { start, end } = getIstDayBounds();
  const { thisWeekStart, thisWeekEnd, lastWeekStart, lastWeekEnd } =
    getIstRollingWeekBounds();
  const last14Keys = getLast14IstDayKeys();
  const seriesStart = new Date(`${last14Keys[0]}T00:00:00+05:30`);
  const windowStart = new Date(
    Math.min(seriesStart.getTime(), lastWeekStart.getTime()),
  );

  const [
    totalStudents,
    activeToday,
    day30Reached,
    day60Reached,
    activeThisWeek,
    activeLastWeek,
    registrationDates,
    liveSubmissionsRaw,
    recentAdminActionsRaw,
    pendingRecruitersRaw,
  ] = await Promise.all([
    countRegisteredUsers(),
    prisma.submission.findMany({
      where: { submittedAt: { gte: start, lt: end } },
      distinct: ["userId"],
      select: { userId: true },
    }),
    prisma.enrollment.count({ where: { daysCompleted: { gte: 30 } } }),
    prisma.enrollment.count({ where: { daysCompleted: { gte: 60 } } }),
    prisma.submission.findMany({
      where: { submittedAt: { gte: thisWeekStart, lt: thisWeekEnd } },
      distinct: ["userId"],
      select: { userId: true },
    }),
    prisma.submission.findMany({
      where: { submittedAt: { gte: lastWeekStart, lt: lastWeekEnd } },
      distinct: ["userId"],
      select: { userId: true },
    }),
    getRegistrationDatesSince(windowStart),
    prisma.submission.findMany({
      orderBy: { submittedAt: "desc" },
      take: 10,
      include: {
        enrollment: { select: { domain: true } },
        user: {
          select: {
            id: true,
            email: true,
            studentProfile: { select: { fullName: true } },
          },
        },
      },
    }),
    prisma.adminAction.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        admin: {
          select: {
            email: true,
            studentProfile: { select: { fullName: true } },
          },
        },
        target: {
          select: {
            id: true,
            email: true,
            studentProfile: { select: { fullName: true } },
          },
        },
      },
    }),
    prisma.recruiterProfile.findMany({
      where: { approved: false },
      orderBy: { createdAt: "asc" },
      take: 5,
      select: {
        id: true,
        fullName: true,
        company: true,
        createdAt: true,
        user: { select: { email: true } },
      },
    }),
  ]);

  const newStudentsThisWeek = registrationDates.filter(
    (date) => date >= thisWeekStart && date < thisWeekEnd,
  ).length;
  const newStudentsLastWeek = registrationDates.filter(
    (date) => date >= lastWeekStart && date < lastWeekEnd,
  ).length;

  const seriesBuckets = new Map<string, number>();
  for (const key of last14Keys) {
    seriesBuckets.set(key, 0);
  }
  for (const date of registrationDates) {
    const key = formatInTimeZone(date, IST, "yyyy-MM-dd");
    if (seriesBuckets.has(key)) {
      seriesBuckets.set(key, (seriesBuckets.get(key) ?? 0) + 1);
    }
  }
  const totalStudentsSeries = last14Keys.map((key) => seriesBuckets.get(key) ?? 0);

  return {
    stats: {
      totalStudents,
      activeToday: activeToday.length,
      day30Reached,
      day60Reached,
      totalStudentsDelta: newStudentsThisWeek - newStudentsLastWeek,
      activeTodayDelta: activeThisWeek.length - activeLastWeek.length,
      day30ReachedDelta: null as number | null,
      day60ReachedDelta: null as number | null,
      totalStudentsSeries,
    },
    liveSubmissions: liveSubmissionsRaw.map((row) => ({
      id: row.id,
      userId: row.user.id,
      studentName:
        row.user.studentProfile?.fullName?.trim() || row.user.email || "Unknown",
      dayNumber: row.dayNumber,
      domain: row.enrollment.domain,
      linkedinUrl: row.linkedinUrl,
      submittedAt: row.submittedAt,
      submittedAtRelative: formatDistanceToNow(row.submittedAt, { addSuffix: true }),
    })),
    recentAdminActions: recentAdminActionsRaw.map((row) => ({
      id: row.id,
      adminName:
        row.admin.studentProfile?.fullName?.trim() || row.admin.email || "Admin",
      actionType: row.actionType,
      actionLabel: formatAdminActionType(row.actionType),
      targetUserId: row.target.id,
      targetName:
        row.target.studentProfile?.fullName?.trim() ||
        row.target.email ||
        "Unknown",
      createdAt: row.createdAt,
      createdAtRelative: formatDistanceToNow(row.createdAt, { addSuffix: true }),
    })),
    pendingRecruiters: pendingRecruitersRaw.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      company: row.company,
      email: row.user.email ?? "",
      createdAtRelative: formatDistanceToNow(row.createdAt, { addSuffix: true }),
    })),
  };
}
