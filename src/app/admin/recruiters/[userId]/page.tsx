import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { RecruiterAccountOps } from "@/components/admin/account-ops-dialog";
import {
  UnlockDiagnosisPanel,
  type UnlockCandidateOption,
} from "@/components/admin/unlock-diagnosis-panel";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminRecruiterDetail } from "@/features/admin/get-admin-recruiter-detail";
import { getUnlockDiagnosis } from "@/features/admin/get-unlock-diagnosis";
import { formatCreditsMinor } from "@/lib/credits-format";
import { formatDateIST, formatDateTimeIST } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Recruiter detail | Admin",
};

/**
 * T-266 — one page that tells ABTalks support the truth about a recruiter.
 *
 * Server Component, read-only apart from the disable/restore control that
 * already exists on the recruiter list (`RecruiterAccountOps`, client). Every
 * number is loaded by `getAdminRecruiterDetail`, which calls the feature each
 * section belongs to rather than re-deriving anything here.
 *
 * T-267's unlock diagnosis lives at the bottom, against a candidate chosen from
 * this recruiter's own history — which is where support is already standing
 * when the question "why can't they unlock her?" gets asked.
 */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#E9E9E9] bg-white p-5">
      <h2 className="font-display text-base font-semibold text-[#353535]">
        {title}
      </h2>
      {description ? (
        <p className="mt-1 text-sm text-[#787878]">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-[0.06em] text-[#8F8F8F]">
        {label}
      </p>
      <p className="mt-0.5 break-words text-sm text-[#353535]">{value}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[#787878]">{children}</p>;
}

export default async function AdminRecruiterDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ candidate?: string }>;
}) {
  await requireAdmin();
  const { userId } = await params;
  const { candidate } = await searchParams;

  const detail = await getAdminRecruiterDetail(userId);
  if (!detail) notFound();

  const { account, recruiter, company, plan, credits } = detail;

  const options: UnlockCandidateOption[] = detail.relatedCandidates;
  const selectedUserId =
    candidate && options.some((o) => o.userId === candidate)
      ? candidate
      : (options[0]?.userId ?? null);
  const diagnosis = selectedUserId
    ? await getUnlockDiagnosis(userId, selectedUserId)
    : null;

  const stateBadge =
    account.state === "ACTIVE" ? (
      <Badge>Active</Badge>
    ) : account.state === "DISABLED" ? (
      <Badge variant="destructive">Disabled</Badge>
    ) : (
      <Badge variant="secondary">Deleted</Badge>
    );

  return (
    <div className="space-y-6">
      <Link
        href="/admin/recruiters"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
      >
        <ArrowLeft className="size-4" />
        Recruiters
      </Link>

      <AdminPageHeader
        title={recruiter?.fullName ?? account.name}
        description={`${account.email}${company ? ` · ${company.name}` : ""} · Registered ${formatDateIST(account.createdAt)}`}
        actions={
          <RecruiterAccountOps
            userId={account.userId}
            name={recruiter?.fullName ?? account.name}
            disabledAt={account.disabledAt ? account.disabledAt.toISOString() : null}
          />
        }
      />

      <Section
        title="Account and sign-in"
        description="What this account can do right now, and how it gets in."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="State" value={stateBadge} />
          <Field label="Role" value={account.role} />
          <Field
            label="Email verified"
            value={
              account.emailVerified ? formatDateIST(account.emailVerified) : "No"
            }
          />
          <Field
            label="Sign-in methods"
            value={
              [
                ...account.signInProviders,
                ...(account.hasPassword ? ["password"] : []),
              ].join(", ") || "Email code only"
            }
          />
          <Field
            label="Live sessions"
            value={
              account.liveSessions === 0
                ? "None"
                : `${account.liveSessions} (newest expires ${formatDateIST(account.lastSessionExpires!)})`
            }
          />
          <Field
            label="Sessions invalidated"
            value={
              account.sessionInvalidatedAt
                ? formatDateTimeIST(account.sessionInvalidatedAt)
                : "Never"
            }
          />
          <Field
            label="Disabled"
            value={
              account.disabledAt
                ? `${formatDateTimeIST(account.disabledAt)}${account.disabledReason ? ` — ${account.disabledReason}` : ""}`
                : "No"
            }
          />
          <Field
            label="Deleted"
            value={
              account.deletedAt ? formatDateTimeIST(account.deletedAt) : "No"
            }
          />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Recruiter identity">
          {recruiter ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" value={recruiter.fullName} />
              <Field label="Company on profile" value={recruiter.company} />
              <Field label="Phone" value={recruiter.phone ?? "—"} />
              <Field
                label="Setup completed"
                value={
                  recruiter.setupCompletedAt
                    ? formatDateIST(recruiter.setupCompletedAt)
                    : "Not completed"
                }
              />
            </div>
          ) : (
            <Empty>
              No RecruiterProfile row. This account is not registered to hire, so
              every recruiter surface refuses it.
            </Empty>
          )}
        </Section>

        <Section
          title="Company identity"
          description="The T-226 workspace: one organization per recruiter."
        >
          {company ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Organization" value={company.name} />
              <Field
                label="Verified"
                value={company.isVerified ? "Yes" : "No"}
              />
              <Field label="Website" value={company.websiteUrl ?? "—"} />
              <Field label="Industry" value={company.industry ?? "—"} />
              <Field label="Size" value={company.sizeBucket ?? "—"} />
              <Field label="Location" value={company.location ?? "—"} />
              <Field
                label="Membership"
                value={`${company.memberRole} · ${company.memberStatus}`}
              />
              <Field label="Workspace slug" value={company.slug} />
            </div>
          ) : (
            <Empty>
              No active OrganizationMember row, so there is no workspace to hold
              credits, projects or assessments.
            </Empty>
          )}
        </Section>
      </div>

      <Section
        title="Plan, limits and credits"
        description="There are no plan tiers yet: the limits in force are these PlatformConfig numbers and the balance itself."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Balance"
            value={
              credits ? formatCreditsMinor(credits.balanceMinor) : "No workspace"
            }
          />
          <Field
            label="Unlock cost"
            value={formatCreditsMinor(plan.unlockCostMinor)}
          />
          <Field
            label="Lifetime granted"
            value={credits ? formatCreditsMinor(credits.earnedMinor) : "—"}
          />
          <Field
            label="Lifetime spent"
            value={credits ? formatCreditsMinor(credits.spentMinor) : "—"}
          />
          <Field
            label="Starting grant"
            value={formatCreditsMinor(plan.startingGrantMinor)}
          />
          <Field
            label="Low-balance warning"
            value={formatCreditsMinor(plan.lowBalanceMinor)}
          />
          <Field
            label="Very-low warning"
            value={formatCreditsMinor(plan.veryLowBalanceMinor)}
          />
          <Field
            label="Plan entitlement check"
            value="checkPlanLimit is a stub (NOT_IMPLEMENTED) and the unlock path does not call it."
          />
        </div>
      </Section>

      <Section
        title="Credit ledger"
        description="The append-only source of truth. The balance above is derived from these rows."
      >
        {detail.ledger.length === 0 ? (
          <Empty>No credit movements.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Balance after</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Candidate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.ledger.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTimeIST(row.createdAt)}
                  </TableCell>
                  <TableCell>{row.type}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      row.amount < 0 ? "text-[#D92D20]" : "text-[#197E23]",
                    )}
                  >
                    {row.amount > 0 ? "+" : ""}
                    {formatCreditsMinor(row.amount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCreditsMinor(row.balanceAfter)}
                  </TableCell>
                  <TableCell>{row.reason}</TableCell>
                  <TableCell>{row.candidateLabel ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title="Contact unlocks"
        description="Engagement requests: CONTACT_SHARED is what actually grants access to a candidate's details."
      >
        {detail.unlocks.length === 0 ? (
          <Empty>This recruiter has never asked for or bought a contact.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Decided</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.unlocks.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    {u.candidatePublicId}
                    {u.candidateName ? ` · ${u.candidateName}` : ""}
                  </TableCell>
                  <TableCell>
                    {u.status === "CONTACT_SHARED" ? (
                      <Badge>Unlocked</Badge>
                    ) : (
                      <Badge variant="secondary">{u.status}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateIST(u.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {u.decidedAt ? formatDateIST(u.decidedAt) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Projects" description="Talent requests and the searches inside them.">
          {detail.projects.length === 0 ? (
            <Empty>No projects.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {detail.projects.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9E9E9] pb-2 last:border-0"
                >
                  <span className="text-[#353535]">
                    {p.name}
                    {p.archivedAt ? " (archived)" : ""}
                  </span>
                  <span className="text-[#787878]">
                    {p.status} · {p.sessionCount} search
                    {p.sessionCount === 1 ? "" : "es"} · {p.matchCount} match
                    {p.matchCount === 1 ? "" : "es"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Jobs">
          {detail.jobs.length === 0 ? (
            <Empty>No jobs posted by this recruiter.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {detail.jobs.map((j) => (
                <li
                  key={j.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9E9E9] pb-2 last:border-0"
                >
                  <span className="text-[#353535]">{j.title}</span>
                  <span className="text-[#787878]">
                    {j.status}
                    {j.isOpen ? "" : " · closed"} · {j.applicationCount}{" "}
                    application{j.applicationCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Assessments">
          {detail.assessments.length === 0 ? (
            <Empty>No assessments in this workspace.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {detail.assessments.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9E9E9] pb-2 last:border-0"
                >
                  <span className="text-[#353535]">{a.title}</span>
                  <span className="text-[#787878]">
                    {a.status} · {a.questionCount} question
                    {a.questionCount === 1 ? "" : "s"} · {a.assignedCount}{" "}
                    assigned · {a.submittedCount} submitted
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Outreach">
          {detail.outreach.length === 0 ? (
            <Empty>No outreach threads.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {detail.outreach.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9E9E9] pb-2 last:border-0"
                >
                  <span className="text-[#353535]">
                    {t.candidatePublicId} · {t.subject}
                  </span>
                  <span className="text-[#787878]">
                    {t.messageCount} message{t.messageCount === 1 ? "" : "s"} ·
                    last by {t.lastMessageBy} {formatDateIST(t.lastMessageAt)}
                    {t.failedEmails > 0 ? ` · ${t.failedEmails} failed email` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title="Notification activity"
        description="Everything the platform sent to this address, from the Delivery Log."
      >
        {detail.deliveries.length === 0 ? (
          <Empty>Nothing has been sent to this recruiter.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>What</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.deliveries.slice(0, 10).map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTimeIST(new Date(d.createdAt))}
                  </TableCell>
                  <TableCell>{d.channel}</TableCell>
                  <TableCell>
                    {d.source === "notification" ? d.eventType : d.kind}
                  </TableCell>
                  <TableCell>
                    {d.state === "failed" ? (
                      <Badge variant="destructive">failed</Badge>
                    ) : (
                      <Badge variant="secondary">{d.state}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title="Recent failures"
        description="Delivery and outreach failures recorded against this recruiter. A refused unlock writes nothing, so it never appears here — the diagnosis below is the live answer."
      >
        {detail.failures.length === 0 ? (
          <Empty>No recorded failures.</Empty>
        ) : (
          <ul className="space-y-3 text-sm">
            {detail.failures.map((f) => (
              <li
                key={f.id}
                className="border-b border-[#E9E9E9] pb-3 last:border-0"
              >
                <p className="font-medium text-[#353535]">{f.label}</p>
                <p className="text-[#5C5C5C]">{f.reason}</p>
                <p className="text-xs text-[#8F8F8F]">
                  {formatDateTimeIST(f.at)} · {f.kind}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <UnlockDiagnosisPanel
        basePath={`/admin/recruiters/${userId}`}
        candidates={options}
        selectedUserId={selectedUserId}
        diagnosis={diagnosis}
      />
    </div>
  );
}
