import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { EngagementDecision } from "@/components/admin/engagement-decision";
import { getDemandBoard } from "@/features/hire/demand-board";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Hire | Admin",
};

const OPEN_FIRST = [
  "SUBMITTED",
  "IN_REVIEW",
  "CONTACT_SHARED",
  "DECLINED",
  "CLOSED",
];

export default async function AdminHirePage() {
  await requireAdmin();

  // Two views of the same funnel, and they were two pages: the requests are
  // what needs a decision today, the demand board is what those requests add up
  // to. Reading them apart meant deciding an introduction without seeing which
  // stacks keep being asked for.
  const demand = await getDemandBoard();

  const engagements = await prisma.talentEngagementRequest.findMany({
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      candidatePublicId: true,
      status: true,
      note: true,
      createdAt: true,
      submittedAt: true,
      source: true,
      recruiter: {
        select: {
          name: true,
          email: true,
          recruiterProfile: { select: { company: true } },
        },
      },
      request: { select: { title: true } },
      // Admin is the party that decides, so admin sees who the candidate is.
      programMember: {
        select: {
          id: true,
          fullName: true,
          jobRole: true,
          user: { select: { email: true } },
        },
      },
      // Challenge candidates have no ProgramMember row. Reading identity only
      // from that relation left the one person who has to phone the candidate
      // looking at "(candidate removed)".
      candidate: {
        select: {
          id: true,
          email: true,
          name: true,
          studentProfile: {
            select: { fullName: true, role: true, phone: true, college: true },
          },
        },
      },
      messages: {
        orderBy: { createdAt: "asc" },
        take: 30,
        select: { id: true, authorRole: true, body: true, createdAt: true },
      },
    },
  });

  const sorted = [...engagements].sort(
    (a, b) => OPEN_FIRST.indexOf(a.status) - OPEN_FIRST.indexOf(b.status),
  );
  const waiting = engagements.filter((e) => e.status === "SUBMITTED").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Hire</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {waiting > 0
            ? `${waiting} request${waiting === 1 ? "" : "s"} waiting on you.`
            : "No requests waiting right now."}{" "}
          Recruiters see only the reference ID until you share contact.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">
          Introduction requests
          {waiting > 0 ? ` (${waiting} new)` : ""}
        </h2>

        {sorted.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No requests yet.
          </p>
        ) : (
          <ul className="space-y-4">
            {sorted.map((e) => {
              // Whichever pool this person came from, admin needs a name, a way
              // to reach them, and somewhere to read the rest.
              const name =
                e.programMember?.fullName ??
                e.candidate?.studentProfile?.fullName ??
                e.candidate?.name ??
                null;
              const email = e.programMember?.user?.email ?? e.candidate?.email ?? null;
              const role =
                e.programMember?.jobRole ?? e.candidate?.studentProfile?.role ?? null;
              const profileHref = e.programMember?.id
                ? `/admin/program/members/${e.programMember.id}`
                : e.candidate?.id
                  ? `/students/${e.candidate.id}`
                  : null;
              return (
              <li
                key={e.id}
                className="space-y-3 rounded-xl border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold">
                      {e.candidatePublicId}
                      {name ? ` · ${name}` : " · (candidate removed)"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {role ?? "—"}
                      {e.request?.title
                        ? ` · for ${e.request.title}`
                        : ""} · {e.source}
                    </p>
                    {/* The email was selected and then never rendered, so the
                      person deciding whether to release a candidate's contact
                      could not see the contact they were releasing. */}
                    {email && (
                      <p className="mt-1 text-sm">
                        <a
                          href={`mailto:${email}`}
                          className="underline underline-offset-4"
                        >
                          {email}
                        </a>
                        {e.candidate?.studentProfile?.phone
                          ? ` · ${e.candidate.studentProfile.phone}`
                          : ""}
                      </p>
                    )}
                    {profileHref && (
                      <Link
                        href={profileHref}
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-4"
                      >
                        Open full profile
                      </Link>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Asked by {e.recruiter?.name ?? e.recruiter?.email ?? "—"}
                      {e.recruiter?.recruiterProfile?.company
                        ? ` (${e.recruiter.recruiterProfile.company})`
                        : ""}{" "}
                      ·{" "}
                      {(e.submittedAt ?? e.createdAt)
                        .toISOString()
                        .slice(0, 10)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
                      e.status === "SUBMITTED"
                        ? "bg-amber-500/10 text-amber-900 dark:text-amber-100"
                        : e.status === "CONTACT_SHARED"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {e.status.replace("_", " ")}
                  </span>
                </div>

                {e.messages.length > 0 && (
                  <ul className="space-y-1.5">
                    {e.messages.map((m) => (
                      <li
                        key={m.id}
                        className={cn(
                          "rounded-md px-3 py-2 text-sm",
                          m.authorRole === "admin"
                            ? "bg-primary/5"
                            : "bg-muted",
                        )}
                      >
                        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                          {m.authorRole}
                        </span>
                        <p className="whitespace-pre-wrap">{m.body}</p>
                      </li>
                    ))}
                  </ul>
                )}

                <EngagementDecision engagementId={e.id} status={e.status} />
              </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Demand</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            What recruiters keep asking Scout for, aggregated across every
            requirement — this is the curriculum signal.
          </p>
        </div>

        {!demand.ok ? (
          <p className="text-sm text-muted-foreground">{demand.message}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label="Total requirements"
                value={demand.data.totalRequests}
              />
              <Stat label="Active / draft" value={demand.data.activeRequests} />
              <Stat label="Matched" value={demand.data.matchedRequests} />
            </div>

            {demand.data.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Scout requirements yet. When recruiters describe a role at
                /hire, the stacks they ask for appear here.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Stack</th>
                      <th className="px-3 py-2 font-medium">Requests</th>
                      <th className="px-3 py-2 font-medium">Open</th>
                      <th className="px-3 py-2 font-medium">Median salary</th>
                      <th className="px-3 py-2 font-medium">Seniority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {demand.data.rows.map((r) => (
                      <tr key={r.stackToken} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium">
                          {r.stackToken}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {r.requestCount}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {r.activeCount}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {r.medianSalary != null
                            ? `₹${r.medianSalary.toLocaleString("en-IN")}`
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.seniorities.join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
