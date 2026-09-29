import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { searchAdminConsole } from "@/features/admin/search-admin-console";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = { title: "Global Search | Admin" };

export default async function AdminSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q: raw } = await searchParams;
  const q = raw?.trim() ?? "";
  const results = await searchAdminConsole(q);
  const total =
    results.candidates.length +
    results.recruiters.length +
    results.jobs.length +
    results.assessments.length;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Global Search"
        description="Search across candidates, recruiters, jobs and assessments."
      />

      <form action="/admin/search" className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Name, email, job title, company…"
          className="h-12 min-w-[16rem] flex-1 rounded-lg border border-[#D2D2D2] bg-white px-4 text-base"
        />
        <button
          type="submit"
          className={cn(buttonVariants({ variant: "default" }), "h-12 px-6")}
        >
          Search
        </button>
      </form>

      {q.length > 0 && q.length < 2 ? (
        <p className="text-sm text-[#787878]">Type at least two characters.</p>
      ) : null}

      {q.length >= 2 ? (
        <p className="text-sm text-[#787878]">
          {total} result{total === 1 ? "" : "s"} for “{q}”
        </p>
      ) : null}

      {q.length >= 2 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ResultList
            title="Candidates"
            empty="No candidates"
            items={results.candidates.map((row) => ({
              href: `/admin/students/${row.id}`,
              title:
                row.studentProfile?.fullName?.trim() ||
                row.name?.trim() ||
                row.email,
              meta: `${row.email}${row.disabledAt ? " · Disabled" : ""}`,
              action: row.hasResumeFile
                ? {
                    href: `/api/admin/candidates/${encodeURIComponent(row.id)}/resume`,
                    label: "Résumé",
                    title: row.resumeFileName ?? undefined,
                  }
                : undefined,
            }))}
          />
          <ResultList
            title="Recruiters"
            empty="No recruiters"
            items={results.recruiters.map((row) => ({
              href: "/admin/recruiters",
              title: row.fullName,
              meta: `${row.company} · ${row.user.email ?? ""}${
                row.user.disabledAt ? " · Disabled" : ""
              }`,
            }))}
          />
          <ResultList
            title="Jobs"
            empty="No jobs"
            items={results.jobs.map((row) => ({
              href: `/admin/jobs/${row.id}`,
              title: row.title,
              meta: `${row.company} · ${row.isOpen ? "Open" : "Closed"}`,
            }))}
          />
          <ResultList
            title="Assessments"
            empty="No assessments"
            items={results.assessments.map((row) => ({
              href: "/admin/assessments",
              title: row.title,
              meta: `${row.status} · ${row.createdBy.name ?? row.createdBy.email}`,
            }))}
          />
        </div>
      ) : null}
    </div>
  );
}

function ResultList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{
    href: string;
    title: string;
    meta: string;
    /** Optional trailing link, rendered beside the row rather than inside it. */
    action?: { href: string; label: string; title?: string };
  }>;
}) {
  return (
    <section className="rounded-xl border border-[#E9E9E9] bg-white p-5">
      <h2 className="font-display text-base font-semibold text-[#353535]">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-[#787878]">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-[#E9E9E9]">
          {items.map((item) => (
            <li
              key={`${item.href}-${item.title}`}
              className="flex items-center gap-3"
            >
              <Link href={item.href} className="block flex-1 py-3 hover:underline">
                <p className="text-sm font-medium text-[#353535]">{item.title}</p>
                <p className="text-xs text-[#787878]">{item.meta}</p>
              </Link>
              {item.action ? (
                <a
                  href={item.action.href}
                  title={item.action.title}
                  className="shrink-0 text-xs text-[#03535F] underline"
                >
                  {item.action.label}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
