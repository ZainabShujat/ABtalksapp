import { Suspense } from "react";
import Link from "next/link";
import type { ProgramMemberStatus } from "@prisma/client";
import {
  getCohortMembers,
  resolveAdminProgramCohort,
} from "@/features/program/admin";
import { ProgramMembersFilters } from "@/components/program/program-members-filters";

type Props = {
  searchParams: Promise<{ q?: string; status?: string; cohortId?: string }>;
};

export default async function AdminProgramMembersPage({ searchParams }: Props) {
  const params = await searchParams;
  const cohort = await resolveAdminProgramCohort(params.cohortId);

  if (!cohort) {
    return (
      <p className="text-sm text-muted-foreground">
        Create a cohort on the overview page first.
      </p>
    );
  }

  const status = params.status as ProgramMemberStatus | undefined;
  const members = await getCohortMembers(cohort.id, {
    q: params.q,
    status: status || undefined,
  });
  const cohortQs = `?cohortId=${encodeURIComponent(cohort.id)}`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Members
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {cohort.name} · {members.length} shown
        </p>
      </header>

      <Suspense fallback={<div className="h-20 rounded-xl border" />}>
        <ProgramMembersFilters />
      </Suspense>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Day</th>
              <th className="px-4 py-3">Behind</th>
              <th className="px-4 py-3">Entry</th>
              <th className="px-4 py-3">Interview</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/program/members/${m.id}${cohortQs}`}
                    className="font-medium hover:underline"
                  >
                    {m.fullName}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {m.jobRole ?? "—"} · {m.company ?? "—"}
                  </p>
                </td>
                <td className="px-4 py-3">{m.status}</td>
                <td className="px-4 py-3 font-medium">{m.totalScore}</td>
                <td className="px-4 py-3">{m.highestUnlockedDay}</td>
                <td className="px-4 py-3">{m.behindBy}</td>
                <td className="px-4 py-3">{m.entryTotalScore ?? "—"}</td>
                <td className="px-4 py-3">
                  {m.interviewOverall !== null
                    ? `${m.interviewOverall}/100`
                    : m.interviewStatus ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
