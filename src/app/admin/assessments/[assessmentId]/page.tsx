import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PlatformAssessmentDeleteButton } from "@/components/admin/platform-assessment-delete-button";
import { PlatformBuilderFrame } from "@/components/admin/platform-builder-frame";
import { AssessmentBuilder } from "@/components/hire/assessment/assessment-builder";
import type { AssessmentDraft } from "@/components/hire/assessment/assessment-types";
import { MAX_PARAGRAPH_WORDS } from "@/lib/validations/assessment";
import { prismaAttemptStore } from "@/features/assessment-attempts/prisma-store";
import {
  endReasonCopy,
  isPenalty,
} from "@/features/recruiter-assessments/service";
import {
  describeAudience,
  getPlatformMonitor,
  type PlatformAssessmentRow,
  type PlatformAttemptRow,
} from "@/features/platform-assessments/service";
import { prismaPlatformStore } from "@/features/platform-assessments/prisma-store";
import { formatDateTimeIST } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export const metadata = { title: "Assessment | Admin" };

type Props = {
  params: Promise<{ assessmentId: string }>;
  searchParams: Promise<{ page?: string }>;
};

/** The stored draft in the builder's shape — per type, no extra keys. */
function rowToDraft(row: PlatformAssessmentRow): AssessmentDraft {
  return {
    assessmentId: row.id,
    title: row.title,
    subheading: row.subheading,
    instructions: row.instructions,
    durationMinutes: row.durationMinutes,
    passMarkPercent: row.passMarkPercent,
    cameraRequired: row.cameraRequired,
    shortlistRefs: [],
    questions: row.questions.map((q) => {
      const base = {
        title: q.title,
        helpText: q.helpText,
        isRequired: q.isRequired,
        points: q.points,
      };
      if (q.type === "MULTIPLE_CHOICE") {
        return {
          ...base,
          type: "MULTIPLE_CHOICE" as const,
          allowMultipleCorrect: q.allowMultipleCorrect,
          options: q.options.map((o) => ({
            body: o.body,
            isCorrect: o.isCorrect,
          })),
        };
      }
      if (q.type === "PARAGRAPH") {
        return {
          ...base,
          type: "PARAGRAPH" as const,
          maxWords: q.maxWords ?? MAX_PARAGRAPH_WORDS,
        };
      }
      return {
        ...base,
        type: "FILE_UPLOAD" as const,
        uploadDestinationUrl: q.uploadDestinationUrl ?? "",
      };
    }),
  };
}

export default async function AdminPlatformAssessmentPage({
  params,
  searchParams,
}: Props) {
  await requireAdmin();
  const { assessmentId } = await params;
  const { page } = await searchParams;
  const store = prismaPlatformStore();

  const row = await store.find(assessmentId);
  if (!row) notFound();

  if (row.status === "DRAFT") {
    const audienceOptions = await store.audienceOptions();
    return (
      // `relative` keeps the builder's sr-only nodes inside admin <main>'s
      // scroll area (see ../new/page.tsx).
      <div className="relative space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/admin/assessments"
            className="text-sm font-medium text-[#03535F] hover:underline"
          >
            ← All assessments
          </Link>
          <PlatformAssessmentDeleteButton assessmentId={row.id} />
        </div>
        <PlatformBuilderFrame>
          <AssessmentBuilder
            candidates={[]}
            existingDraft={rowToDraft(row)}
            platform={{ audienceOptions }}
          />
        </PlatformBuilderFrame>
      </div>
    );
  }

  const now = new Date();
  const monitor = await getPlatformMonitor(
    store,
    prismaAttemptStore(),
    assessmentId,
    Number(page ?? "1"),
    now,
  );
  if (!monitor.ok) notFound();
  const { summary, attempts, pageCount } = monitor.data;
  const current = monitor.data.page;
  const closed = row.deadlineAt !== null && row.deadlineAt <= now;

  const facts = [
    describeAudience(row.audience),
    `${row.questions.length} question${row.questions.length === 1 ? "" : "s"}`,
    row.durationMinutes == null ? "Untimed" : `${row.durationMinutes} min`,
    `Pass mark ${row.passMarkPercent}%`,
    row.cameraRequired ? "Camera required" : null,
  ].filter(Boolean);

  const stats = [
    { label: "Sent", value: summary.sent },
    { label: "Started", value: summary.started },
    { label: "Submitted", value: summary.submitted },
    { label: "Missed", value: summary.missed },
    { label: "Passed", value: summary.passed },
    { label: "Failed", value: summary.failed },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/admin/assessments"
        className="text-sm font-medium text-[#03535F] hover:underline"
      >
        ← All assessments
      </Link>

      <AdminPageHeader
        title={row.title}
        description={row.subheading ?? undefined}
        actions={
          <span
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold",
              closed
                ? "bg-[#F4F4F4] text-[#4B4B4B]"
                : "bg-[#18D39B]/10 text-[#197E23]",
            )}
          >
            {closed ? "Closed" : "Live"}
          </span>
        }
      />

      <section className="rounded-xl border border-[#E9E9E9] bg-white">
        <dl className="grid gap-px overflow-hidden rounded-t-xl bg-[#E9E9E9] sm:grid-cols-2">
          <div className="bg-white px-5 py-4">
            <dt className="text-xs uppercase tracking-[0.06em] text-[#8F8F8F]">
              Deadline
            </dt>
            <dd className="mt-1 text-sm font-medium text-[#353535]">
              {row.deadlineAt ? formatDateTimeIST(row.deadlineAt) : "—"}
              {closed ? " · closed" : ""}
            </dd>
          </div>
          <div className="bg-white px-5 py-4">
            <dt className="text-xs uppercase tracking-[0.06em] text-[#8F8F8F]">
              Sent
            </dt>
            <dd className="mt-1 text-sm font-medium text-[#353535]">
              {row.publishedAt ? formatDateTimeIST(row.publishedAt) : "—"} · by{" "}
              {row.createdByLabel}
            </dd>
          </div>
        </dl>
        <p className="border-t border-[#E9E9E9] px-5 py-3 text-sm text-[#787878]">
          {facts.join(" · ")}
        </p>
        <dl className="grid grid-cols-3 border-t border-[#E9E9E9] sm:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label} className="px-5 py-4">
              <dt className="text-xs text-[#8F8F8F]">{s.label}</dt>
              <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-[#353535]">
                {s.value.toLocaleString("en-IN")}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {!closed ? (
        <p className="text-sm text-[#787878]">
          Scores for attempts still in progress appear once they submit or the
          deadline passes. Candidates never see their score.
        </p>
      ) : null}

      <section className="overflow-x-auto rounded-xl border border-[#E9E9E9] bg-white">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="border-b border-[#E9E9E9] text-xs uppercase tracking-[0.06em] text-[#8F8F8F]">
            <tr>
              <th className="px-5 py-3 font-medium">Candidate</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Submitted</th>
              <th className="px-5 py-3 font-medium">Score</th>
              <th className="px-5 py-3 font-medium">
                <span className="sr-only">Review</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {attempts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-[#787878]">
                  Nobody received this assessment.
                </td>
              </tr>
            ) : (
              attempts.map((a) => (
                <AttemptRow key={a.assignmentId} a={a} closed={closed} />
              ))
            )}
          </tbody>
        </table>
      </section>

      {pageCount > 1 ? (
        <nav
          className="flex items-center justify-between text-sm"
          aria-label="Pages"
        >
          <span className="text-[#787878]">
            Page {current} of {pageCount}
          </span>
          <div className="flex gap-2">
            {current > 1 ? (
              <Link
                href={`/admin/assessments/${row.id}?page=${current - 1}`}
                className="rounded-md border px-3 py-1.5 hover:bg-[#F7FBFB]"
              >
                Previous
              </Link>
            ) : null}
            {current < pageCount ? (
              <Link
                href={`/admin/assessments/${row.id}?page=${current + 1}`}
                className="rounded-md border px-3 py-1.5 hover:bg-[#F7FBFB]"
              >
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function AttemptRow({ a, closed }: { a: PlatformAttemptRow; closed: boolean }) {
  const status =
    a.status === "SUBMITTED"
      ? { label: "Submitted", tone: "bg-[#D6F7EC] text-[#197E23]" }
      : a.status === "STARTED"
        ? { label: "In progress", tone: "bg-[#E7F2F3] text-[#03535F]" }
        : closed
          ? { label: "Missed", tone: "bg-[#FDECEC] text-[#B42318]" }
          : { label: "Not started", tone: "bg-[#F4F4F4] text-[#4B4B4B]" };
  const note = endReasonCopy(a.endReason);

  return (
    <tr className="border-b border-[#E9E9E9] last:border-0">
      <td className="px-5 py-3">
        <p className="font-medium text-[#353535]">{a.name}</p>
        <p className="text-xs text-[#8F8F8F]">{a.email}</p>
      </td>
      <td className="px-5 py-3">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            status.tone,
          )}
        >
          {status.label}
        </span>
        {note ? (
          <p
            className={cn(
              "mt-1 text-xs",
              isPenalty(a.endReason) ? "text-[#B42318]" : "text-[#8F8F8F]",
            )}
          >
            {note}
          </p>
        ) : null}
      </td>
      <td className="px-5 py-3 text-[#787878]">
        {a.submittedAt ? formatDateTimeIST(a.submittedAt) : "—"}
      </td>
      <td className="px-5 py-3 tabular-nums">
        {a.scorePercent == null ? (
          "—"
        ) : (
          <span className={a.passed ? "text-[#197E23]" : "text-[#B42318]"}>
            {a.scorePercent}% · {a.passed ? "Pass" : "Fail"}
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-right">
        {a.status !== "ASSIGNED" ? (
          <Link
            href={`/admin/students/${a.candidateUserId}/assessments/${a.assignmentId}`}
            className="text-sm font-medium text-[#03535F] hover:underline"
          >
            Review
          </Link>
        ) : null}
      </td>
    </tr>
  );
}
