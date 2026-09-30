import type { Metadata } from "next";
import Link from "next/link";
import { ChartColumn, PencilLine, Plus } from "lucide-react";
import { requireRecruiter } from "@/lib/program-auth";
import { requireRecruiterWorkspace } from "@/features/recruiter-workspace/workspace";
import {
  listAssessments,
  type AssessmentListRow,
} from "@/features/recruiter-assessments/service";
import { prismaAssessmentStore } from "@/features/recruiter-assessments/prisma-store";
import { dsButtonVariants } from "@/components/design/ds-button";
import { CLAY_CTA } from "@/components/jobs/job-ui";
import { AssessmentRowMenu } from "@/components/hire/assessment/assessment-row-menu";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Assessments | ABTalks Hire",
};

const STATUS_LABEL: Record<AssessmentListRow["status"], string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "6 questions · 25 min · 60% pass mark" — the setup, read as one line. */
function setupLine(row: AssessmentListRow): string {
  return [
    plural(row.questionCount, "question"),
    row.durationMinutes == null ? "Untimed" : `${row.durationMinutes} min`,
    `${row.passMarkPercent}% pass mark`,
  ].join(" · ");
}

function formatDate(d: Date, withYear: boolean): string {
  return d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function formatStamp(d: Date): string {
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Draft → keep building it. Published / archived → see how candidates did. */
function PrimaryAction({
  row,
  className,
}: {
  row: AssessmentListRow;
  className?: string;
}) {
  if (row.status === "DRAFT") {
    return (
      <Link
        href={`/hire/create-test?id=${row.id}`}
        className={cn("hire-assess-action", className)}
        title="Continue editing"
      >
        <PencilLine aria-hidden="true" />
        <span className="hire-assess-action__label">Continue editing</span>
      </Link>
    );
  }
  return (
    <Link
      href={`/hire/assessments/${row.id}#results`}
      className={cn("hire-assess-action", className)}
      title="View results"
    >
      <ChartColumn aria-hidden="true" />
      <span className="hire-assess-action__label">View results</span>
    </Link>
  );
}

function StatusBadge({ status }: { status: AssessmentListRow["status"] }) {
  return (
    <span
      className="hire-assess-badge"
      data-status={status.toLowerCase()}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Candidates / passed / failed as one group. Drafts have nothing to count. */
function Results({ row }: { row: AssessmentListRow }) {
  if (!row.results) {
    return <span className="hire-assess-results__none">Publish to assign</span>;
  }
  const { students, passed, failed } = row.results;
  return (
    <span className="hire-assess-results">
      <span className="hire-assess-results__item">
        <b>{students}</b> {students === 1 ? "candidate" : "candidates"}
      </span>
      <span className="hire-assess-results__item" data-tone={passed > 0 ? "pass" : undefined}>
        <b>{passed}</b> passed
      </span>
      <span className="hire-assess-results__item" data-tone={failed > 0 ? "fail" : undefined}>
        <b>{failed}</b> failed
      </span>
    </span>
  );
}

export default async function HireAssessmentsPage() {
  await requireRecruiter();
  const workspace = await requireRecruiterWorkspace();
  if (!workspace.ok) {
    return (
      <div className="hire-assess-list hire-assess-list--index">
        <p>{workspace.message}</p>
      </div>
    );
  }

  const listed = await listAssessments(prismaAssessmentStore(), {
    organizationId: workspace.data.organizationId,
    createdByUserId: workspace.data.userId,
  });
  const rows = listed.ok ? listed.data : [];
  const drafts = rows.filter((r) => r.status === "DRAFT").length;
  const published = rows.filter((r) => r.status === "PUBLISHED").length;
  const currentYear = new Date().getFullYear();

  return (
    <div className="hire-assess-page">
      <Link href="/hire" className="hire-back">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 19 8 12l7-7" />
        </svg>
        <span>Back to Scout</span>
      </Link>

    <div className="hire-assess-list hire-assess-list--index">
      <div className="hire-assess-list__head">
        <div className="hire-assess-list__heading">
          <p className="hire-assess__kicker">Recruiter assessments</p>
          <h1>Assessments</h1>
          {rows.length > 0 && (
            <p className="hire-assess-list__count">
              {plural(rows.length, "assessment")} · {published} published ·{" "}
              {plural(drafts, "draft")}
            </p>
          )}
        </div>
        <Link
          href="/hire/create-test"
          className={cn(
            dsButtonVariants(),
            CLAY_CTA,
            "hire-assess-list__cta gap-2",
          )}
        >
          <Plus aria-hidden="true" className="size-4" />
          Create assessment
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="hire-assess-list__empty">
          <p>No assessments yet</p>
          <Link href="/hire/create-test" className="hire-assess-linkbtn">
            Create your first assessment
          </Link>
        </div>
      ) : (
        <>
          {/* Desktop / tablet: a compact management table. Scrolls inside its
              own container when the columns can't fit — never the page. */}
          <div className="hire-assess-list__table-wrap hire-assess-index__table-wrap">
            <table className="hire-assess-list__table hire-assess-index__table">
              <thead>
                <tr>
                  <th scope="col">Assessment</th>
                  <th scope="col">Status</th>
                  <th scope="col">Results</th>
                  <th scope="col">Last edited</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="hire-assess-index__main">
                      <Link
                        href={`/hire/assessments/${row.id}`}
                        className="hire-assess-list__title"
                      >
                        {row.title}
                      </Link>
                      <span className="hire-assess-index__setup">
                        {setupLine(row)}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>
                      <Results row={row} />
                    </td>
                    <td>
                      <time
                        className="hire-assess-index__date"
                        dateTime={row.updatedAt.toISOString()}
                        title={formatStamp(row.updatedAt)}
                      >
                        {formatDate(
                          row.updatedAt,
                          row.updatedAt.getFullYear() !== currentYear,
                        )}
                      </time>
                    </td>
                    <td>
                      <div className="hire-assess-index__actions">
                        <PrimaryAction row={row} />
                        <AssessmentRowMenu
                          assessmentId={row.id}
                          title={row.title}
                          status={row.status}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: one card per assessment, same hierarchy as the table. */}
          <ul className="hire-assess-cards">
            {rows.map((row) => (
              <li key={row.id} className="hire-assess-card">
                <div className="hire-assess-card__top">
                  <Link
                    href={`/hire/assessments/${row.id}`}
                    className="hire-assess-card__title"
                  >
                    {row.title}
                  </Link>
                  <AssessmentRowMenu
                    assessmentId={row.id}
                    title={row.title}
                    status={row.status}
                  />
                </div>
                <div className="hire-assess-card__status">
                  <StatusBadge status={row.status} />
                  <time
                    dateTime={row.updatedAt.toISOString()}
                    title={formatStamp(row.updatedAt)}
                  >
                    Edited{" "}
                    {formatDate(
                      row.updatedAt,
                      row.updatedAt.getFullYear() !== currentYear,
                    )}
                  </time>
                </div>
                <p className="hire-assess-card__setup">{setupLine(row)}</p>
                <div className="hire-assess-card__results">
                  <Results row={row} />
                </div>
                <PrimaryAction row={row} className="hire-assess-card__action" />
              </li>
            ))}
          </ul>

          <p className="hire-assess-list__footnote">
            Candidates counts the people you assigned. Passed and failed count
            completed attempts against the pass mark.
          </p>
        </>
      )}
    </div>
    </div>
  );
}
