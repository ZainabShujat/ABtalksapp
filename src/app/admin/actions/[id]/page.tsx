import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { buttonVariants } from "@/components/ui/button";
import { getAdminActionDetail } from "@/features/admin/get-admin-actions-feed";
import { requireAdmin } from "@/lib/admin-auth";
import { formatDateTimeIST } from "@/lib/date-utils";

export const metadata: Metadata = { title: "Audit entry | ABTalks Admin" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

export default async function AdminActionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const detail = await getAdminActionDetail(id);
  if (!detail) notFound();

  const who = detail.deletedUser;

  return (
    <div className="space-y-4 md:space-y-6">
      <AdminPageHeader
        title={who?.name || who?.email || detail.actionLabel}
        description={`${detail.actionLabel} · ${formatDateTimeIST(detail.createdAt)}`}
        actions={
          <Link
            href="/admin/actions"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Back to audit log
          </Link>
        }
      />

      {who ? (
        <section className="space-y-4 rounded-xl border bg-card p-4 md:p-6">
          <div>
            <h2 className="font-semibold">Deleted account</h2>
            <p className="text-sm text-muted-foreground">
              This user deleted their own account. Their profile no longer
              exists; these are the details saved at deletion.
            </p>
          </div>
          <dl className="space-y-3">
            <Field label="Name">{who.name || "-"}</Field>
            <Field label="Email">
              <a href={`mailto:${who.email}`} className="text-primary hover:underline">
                {who.email}
              </a>
            </Field>
            <Field label="Why they left">{detail.leaveReason || "-"}</Field>
            <Field label="Feedback">
              {detail.feedback ? (
                <span className="whitespace-pre-wrap">{detail.feedback}</span>
              ) : (
                "-"
              )}
            </Field>
            <Field label="Deleted at">{formatDateTimeIST(detail.createdAt)}</Field>
            <Field label="Former user id">
              <span className="font-mono text-xs">{detail.entity}</span>
            </Field>
          </dl>
        </section>
      ) : (
        <section className="rounded-xl border bg-card p-4 md:p-6">
          <dl className="space-y-3">
            <Field label="Action">{detail.actionLabel}</Field>
            <Field label="Entity">
              <span className="font-mono text-xs">{detail.entity || "-"}</span>
            </Field>
            <Field label="Email domain">{detail.emailDomain || "-"}</Field>
            <Field label="Reason">
              <span className="whitespace-pre-wrap">{detail.reason?.trim() || "-"}</span>
            </Field>
          </dl>
        </section>
      )}
    </div>
  );
}
