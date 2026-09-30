import Link from "next/link";
import { ClipboardList, FileText, Pencil, Plus } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { StatCard } from "@/components/admin/stat-card";
import { buttonVariants } from "@/components/ui/button";
import { getAssessmentsConsole } from "@/features/admin/get-assessments-console";
import { describeAudience } from "@/features/platform-assessments/service";
import { prismaPlatformStore } from "@/features/platform-assessments/prisma-store";
import { formatDateIST, formatDateTimeIST } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export const metadata = { title: "Assessments | Admin" };

const TABS = [
  { value: "platform", label: "Platform" },
  { value: "recruiter", label: "Recruiter" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

const STATUS_PILL: Record<string, string> = {
  PUBLISHED: "bg-[#18D39B]/10 text-[#197E23]",
  DRAFT: "bg-[#E7F2F3] text-[#03535F]",
  CLOSED: "bg-[#F4F4F4] text-[#4B4B4B]",
  ARCHIVED: "bg-muted text-muted-foreground",
};

function StatusPill({ status }: { status: string }) {
  const label =
    status === "PUBLISHED"
      ? "Live"
      : status === "CLOSED"
        ? "Closed"
        : status === "DRAFT"
          ? "Draft"
          : status;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_PILL[status] ?? STATUS_PILL.ARCHIVED,
      )}
    >
      {label}
    </span>
  );
}

export default async function AdminAssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const tab: TabValue = sp.tab === "recruiter" ? "recruiter" : "platform";

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Assessments"
        description="Create assessments for candidates, and see every assessment recruiters have built."
        actions={
          <Link href="/admin/assessments/new" className={buttonVariants()}>
            <Plus aria-hidden="true" />
            Create assessment
          </Link>
        }
      />

      <div className="inline-flex rounded-lg border bg-card p-1">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={`/admin/assessments?tab=${t.value}`}
            aria-current={t.value === tab ? "page" : undefined}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              t.value === tab
                ? "bg-[#03535F] text-primary-foreground shadow-[var(--shadow-card)]"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "platform" ? <PlatformTab /> : <RecruiterTab />}
    </div>
  );
}

async function PlatformTab() {
  const rows = await prismaPlatformStore().list();
  const now = new Date();

  return (
    <section className="overflow-x-auto rounded-xl border border-[#E9E9E9] bg-white">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <thead className="border-b border-[#E9E9E9] text-xs uppercase tracking-[0.06em] text-[#8F8F8F]">
          <tr>
            <th className="px-5 py-3 font-medium">Assessment</th>
            <th className="px-5 py-3 font-medium">Audience</th>
            <th className="px-5 py-3 font-medium">Deadline</th>
            <th className="px-5 py-3 font-medium">Submitted</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-5 py-10 text-center text-[#787878]">
                No platform assessments yet.{" "}
                <Link
                  href="/admin/assessments/new"
                  className="font-medium text-[#03535F] underline"
                >
                  Create the first one
                </Link>
                .
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const closed =
                row.status === "PUBLISHED" &&
                row.deadlineAt !== null &&
                row.deadlineAt <= now;
              return (
                <tr
                  key={row.id}
                  className="border-b border-[#E9E9E9] last:border-0 hover:bg-[#FAFAFA]"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/admin/assessments/${row.id}`}
                      className="font-medium text-[#353535] hover:text-[#03535F] hover:underline"
                    >
                      {row.title}
                    </Link>
                    <p className="text-xs text-[#8F8F8F]">
                      {row.questionCount} question
                      {row.questionCount === 1 ? "" : "s"} · by{" "}
                      {row.createdByLabel}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-[#787878]">
                    {row.status === "DRAFT"
                      ? "—"
                      : describeAudience(row.audience)}
                  </td>
                  <td className="px-5 py-3 text-[#787878]">
                    {row.deadlineAt ? formatDateTimeIST(row.deadlineAt) : "—"}
                  </td>
                  <td className="px-5 py-3 tabular-nums">
                    {row.status === "DRAFT"
                      ? "—"
                      : `${row.submitted} / ${row.sent}`}
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill status={closed ? "CLOSED" : row.status} />
                  </td>
                  <td className="px-5 py-3 text-[#787878]">
                    {formatDateIST(row.updatedAt)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}

async function RecruiterTab() {
  const data = await getAssessmentsConsole();

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Recruiter assessments"
          value={data.total}
          accent="blue"
          icon={<ClipboardList className="h-4 w-4" />}
        />
        <StatCard
          label="Published"
          value={data.published}
          accent="green"
          icon={<FileText className="h-4 w-4" />}
        />
        <StatCard
          label="Drafts"
          value={data.drafts}
          accent="orange"
          icon={<Pencil className="h-4 w-4" />}
        />
      </div>

      <section className="overflow-x-auto rounded-xl border border-[#E9E9E9] bg-white">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b border-[#E9E9E9] text-xs uppercase tracking-[0.06em] text-[#8F8F8F]">
            <tr>
              <th className="px-5 py-3 font-medium">Assessment</th>
              <th className="px-5 py-3 font-medium">Created by</th>
              <th className="px-5 py-3 font-medium">Questions</th>
              <th className="px-5 py-3 font-medium">Assigned</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-[#787878]">
                  No recruiter assessments yet.
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[#E9E9E9] last:border-0"
                >
                  <td className="px-5 py-3 font-medium text-[#353535]">
                    {row.title}
                  </td>
                  <td className="px-5 py-3 text-[#787878]">
                    {row.createdBy.name || row.createdBy.email}
                  </td>
                  <td className="px-5 py-3">{row._count.questions}</td>
                  <td className="px-5 py-3">{row._count.assignments}</td>
                  <td className="px-5 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        STATUS_PILL[row.status] ?? STATUS_PILL.ARCHIVED,
                      )}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-[#787878]">
                    {formatDateIST(row.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
