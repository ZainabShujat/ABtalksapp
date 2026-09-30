import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Camera, ClipboardCheck, Laptop } from "lucide-react";
import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard-hub/dashboard-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  listCandidateAttempts,
  type AttemptListRow,
} from "@/features/assessment-attempts/service";
import { prismaAttemptStore } from "@/features/assessment-attempts/prisma-store";
import { formatDateIST, formatDateTimeIST } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Assessments | ABTalks" };

// No score or pass/fail anywhere on this page: the candidate sees "Submitted"
// only (plan 129, D-1). Whoever sent the assessment sees the result.

type Tab = "platform" | "recruiter";
type RowState = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "MISSED";

const TABS: { value: Tab; label: string; blurb: string }[] = [
  {
    value: "platform",
    label: "Platform",
    blurb:
      "Sent by the ABTalks team. Finish before the deadline — an attempt still open when it passes is submitted automatically with the answers you saved.",
  },
  {
    value: "recruiter",
    label: "Recruiter",
    blurb:
      "Sent by recruiters who are looking at your profile. Your result goes to the recruiter who invited you.",
  },
];

const STATE: Record<
  RowState,
  { label: string; pill: string; action: string | null }
> = {
  NOT_STARTED: {
    label: "Not started",
    pill: "bg-[#F4F4F4] text-[#4B4B4B]",
    action: "Start",
  },
  IN_PROGRESS: {
    label: "In progress",
    pill: "bg-[#E7F2F3] text-[#03535F]",
    action: "Continue",
  },
  SUBMITTED: {
    label: "Submitted",
    pill: "bg-[#D6F7EC] text-[#197E23]",
    action: "View",
  },
  MISSED: {
    label: "Missed",
    pill: "bg-[#FDECEC] text-[#B42318]",
    action: null,
  },
};

function stateOf(row: AttemptListRow, now: Date): RowState {
  if (row.status === "SUBMITTED") return "SUBMITTED";
  if (row.closesAt && row.closesAt <= now) return "MISSED";
  return row.status === "STARTED" ? "IN_PROGRESS" : "NOT_STARTED";
}

const isOpen = (s: RowState) => s === "NOT_STARTED" || s === "IN_PROGRESS";

/** "Due in 3 days", "Due in 5 hours", "Due in 20 min" — with urgency tone. */
function dueLabel(
  closesAt: Date,
  now: Date,
): { text: string; tone: "normal" | "soon" | "urgent" } {
  const ms = closesAt.getTime() - now.getTime();
  const hours = ms / 3_600_000;
  const tone = hours <= 24 ? "urgent" : hours <= 72 ? "soon" : "normal";
  if (hours >= 48)
    return { text: `Due in ${Math.floor(hours / 24)} days`, tone };
  if (hours >= 1) {
    const h = Math.floor(hours);
    return { text: `Due in ${h} hour${h === 1 ? "" : "s"}`, tone };
  }
  return { text: `Due in ${Math.max(1, Math.floor(ms / 60_000))} min`, tone };
}

export default async function AssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const listed = await listCandidateAttempts(
    prismaAttemptStore(),
    session.user.id,
  );
  const rows = listed.ok ? listed.data : [];
  const now = new Date();

  const bySource: Record<Tab, AttemptListRow[]> = {
    platform: rows.filter((r) => r.source === "PLATFORM"),
    recruiter: rows.filter((r) => r.source === "RECRUITER"),
  };
  const openCount = (t: Tab) =>
    bySource[t].filter((r) => isOpen(stateOf(r, now))).length;

  const sp = await searchParams;
  // An explicit tab wins; otherwise open Platform, unless only recruiter
  // assessments exist.
  const tab: Tab =
    sp.tab === "platform" || sp.tab === "recruiter"
      ? sp.tab
      : bySource.platform.length === 0 && bySource.recruiter.length > 0
        ? "recruiter"
        : "platform";
  const active = TABS.find((t) => t.value === tab) ?? TABS[0];

  const tabRows = bySource[tab];
  const todo = tabRows
    .filter((r) => isOpen(stateOf(r, now)))
    // Soonest deadline first; no deadline (recruiter) by newest assignment.
    .sort(
      (a, b) =>
        (a.closesAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (b.closesAt?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
        b.assignedAt.getTime() - a.assignedAt.getTime(),
    );
  const done = tabRows
    .filter((r) => !isOpen(stateOf(r, now)))
    .sort(
      (a, b) =>
        (b.submittedAt ?? b.closesAt ?? b.assignedAt).getTime() -
        (a.submittedAt ?? a.closesAt ?? a.assignedAt).getTime(),
    );

  const shellUser = {
    name: session.user.name ?? session.user.email ?? "",
    email: session.user.email ?? "",
    image: session.user.image ?? null,
  };

  return (
    <DashboardShell
      user={shellUser}
      isAdmin={session.user.isAdmin ?? false}
      showSectionNav={false}
    >
      <main className="relative flex-1 bg-white">
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
          <header>
            <h1 className="font-display text-3xl font-bold tracking-tight text-[#1C1C1C]">
              Assessments
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[#626262]">
              Tests sent to you by ABTalks and by recruiters. Your answers save
              as you go, and scores aren&apos;t shown here.
            </p>
          </header>

          <nav
            aria-label="Assessment type"
            className="mt-8 flex gap-6 border-b border-[#E9E9E9]"
          >
            {TABS.map((t) => {
              const selected = t.value === tab;
              const count = openCount(t.value);
              return (
                <Link
                  key={t.value}
                  href={`/assessments?tab=${t.value}`}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-semibold transition-colors",
                    selected
                      ? "border-[#03535F] text-[#03535F]"
                      : "border-transparent text-[#787878] hover:text-[#353535]",
                  )}
                >
                  {t.label}
                  {count > 0 ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs tabular-nums",
                        selected
                          ? "bg-[#03535F] text-white"
                          : "bg-[#F4F4F4] text-[#4B4B4B]",
                      )}
                      aria-label={`${count} to do`}
                    >
                      {count}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <p className="mt-4 text-sm text-[#787878]">{active.blurb}</p>

          {tabRows.length === 0 ? (
            <EmptyState tab={tab} />
          ) : (
            <div className="mt-6 space-y-10">
              <Section
                title="To do"
                rows={todo}
                tab={tab}
                now={now}
                empty="You're all caught up."
              />
              {done.length > 0 ? (
                <Section title="Completed" rows={done} tab={tab} now={now} />
              ) : null}
            </div>
          )}
        </div>
      </main>
    </DashboardShell>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div className="mt-10 flex flex-col items-center gap-3 border-y border-[#E9E9E9] px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-[#E7F2F3] text-[#03535F]">
        <ClipboardCheck className="size-6" aria-hidden="true" />
      </span>
      <p className="font-display text-lg font-semibold">
        {tab === "platform"
          ? "No assessments from ABTalks yet"
          : "No recruiter assessments yet"}
      </p>
      <p className="max-w-sm text-sm text-[#787878]">
        {tab === "platform"
          ? "When the ABTalks team sends you an assessment, it appears here with its deadline."
          : "When a recruiter invites you to one, it appears here and in your notifications."}
      </p>
    </div>
  );
}

function Section({
  title,
  rows,
  tab,
  now,
  empty,
}: {
  title: string;
  rows: AttemptListRow[];
  tab: Tab;
  now: Date;
  empty?: string;
}) {
  const headingId = `section-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#8F8F8F]"
      >
        {title}
        <span className="tabular-nums">{rows.length}</span>
      </h2>

      {rows.length === 0 ? (
        <p className="mt-3 border-t border-[#E9E9E9] pt-4 text-sm text-[#787878]">
          {empty}
        </p>
      ) : (
        <>
          {/* Column labels — desktop only; rows stack on small screens. */}
          <div
            aria-hidden="true"
            className="mt-3 hidden grid-cols-[minmax(0,1fr)_11rem_12rem_7.5rem] gap-6 border-b border-[#E9E9E9] pb-2 text-xs text-[#8F8F8F] md:grid"
          >
            <span>Assessment</span>
            <span>Details</span>
            <span>{tab === "platform" ? "Deadline" : "Received"}</span>
            <span />
          </div>
          <ul className="mt-3 divide-y divide-[#E9E9E9] border-y border-[#E9E9E9] md:mt-0 md:border-t-0">
            {rows.map((row) => (
              <Row key={row.assignmentId} row={row} tab={tab} now={now} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Row({ row, tab, now }: { row: AttemptListRow; tab: Tab; now: Date }) {
  const state = stateOf(row, now);
  const s = STATE[state];
  const due =
    row.closesAt && isOpen(state) ? dueLabel(row.closesAt, now) : null;

  const details = [
    row.durationMinutes == null ? "Untimed" : `${row.durationMinutes} min`,
    `${row.questionCount} question${row.questionCount === 1 ? "" : "s"}`,
  ].join(" · ");

  const when =
    state === "SUBMITTED" && row.submittedAt
      ? `Submitted ${formatDateIST(row.submittedAt)}`
      : tab === "platform" && row.closesAt
        ? state === "MISSED"
          ? `Closed ${formatDateIST(row.closesAt)}`
          : formatDateTimeIST(row.closesAt)
        : `Received ${formatDateIST(row.assignedAt)}`;

  return (
    <li className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_11rem_12rem_7.5rem] md:items-center md:gap-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
              s.pill,
            )}
          >
            {s.label}
          </span>
          {due ? (
            <span
              className={cn(
                "text-xs font-medium",
                due.tone === "urgent"
                  ? "text-[#B42318]"
                  : due.tone === "soon"
                    ? "text-[#AA821D]"
                    : "text-[#787878]",
              )}
            >
              {due.text}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 font-display text-base font-semibold leading-snug text-[#1C1C1C]">
          {row.title}
        </p>
        {row.subheading ? (
          <p className="mt-0.5 line-clamp-1 text-sm text-[#787878]">
            {row.subheading}
          </p>
        ) : null}
      </div>

      <div className="text-sm text-[#4B4B4B]">
        <p>{details}</p>
        {row.strictMode ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#787878]">
            <span className="inline-flex items-center gap-1">
              <Laptop className="size-3.5" aria-hidden="true" />
              Laptop · fullscreen
            </span>
            {row.cameraRequired ? (
              <span className="inline-flex items-center gap-1">
                <Camera className="size-3.5" aria-hidden="true" />
                Camera
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <p className="text-sm text-[#4B4B4B]">
        <span className="text-[#8F8F8F] md:hidden">
          {tab === "platform" && state !== "SUBMITTED" && state !== "MISSED"
            ? "Due "
            : ""}
        </span>
        {when}
      </p>

      <div className="md:text-right">
        {s.action ? (
          <Link
            href={`/assessments/${row.assignmentId}`}
            className={cn(
              buttonVariants({
                variant: state === "SUBMITTED" ? "outline" : "default",
                size: "sm",
              }),
              "w-full md:w-auto",
            )}
          >
            {s.action}
            <ArrowRight aria-hidden="true" />
          </Link>
        ) : (
          <span className="text-sm text-[#8F8F8F]">Closed</span>
        )}
      </div>
    </li>
  );
}
