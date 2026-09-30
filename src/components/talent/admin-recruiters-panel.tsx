import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { RecruiterAccountOps } from "@/components/admin/account-ops-dialog";
import { DeleteRecruiterDialog } from "@/components/admin/delete-recruiter-dialog";

type RecruiterRow = {
  id: string;
  userId: string;
  fullName: string;
  company: string;
  phone: string | null;
  createdAt: string;
  email: string;
  disabledAt: string | null;
  hasWorkspace: boolean;
  openCandidateAsks: number;
};

/**
 * The recruiter directory.
 *
 * Server Component: each row mounts RecruiterAccountOps (client) for disable /
 * restore / secure, and DeleteRecruiterDialog for permanent deletion. Disable
 * is the reversible operation; the delete is not. No password field — an
 * admin-issued password is shown once at creation and never again.
 */
export function AdminRecruitersPanel({
  recruiters,
}: {
  recruiters: RecruiterRow[];
}) {
  if (recruiters.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No recruiters have registered yet.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {recruiters.map((row) => (
        <li key={row.id} className="rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{row.fullName}</p>
              <p className="text-muted-foreground">{row.company}</p>
              <p className="mt-1 break-all text-muted-foreground">{row.email}</p>
              {row.disabledAt ? (
                <p className="mt-1 text-xs text-destructive">Disabled</p>
              ) : null}
              {row.phone && (
                <p className="text-xs text-muted-foreground">
                  Phone: {row.phone}
                </p>
              )}
              {row.openCandidateAsks > 0 && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#AA821D]/10 px-2.5 py-1 text-xs font-medium text-[#AA821D] dark:text-[#FFEDB0]">
                  {row.openCandidateAsks} open introduction request
                  {row.openCandidateAsks === 1 ? "" : "s"} — see Hire
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Registered{" "}
                {new Date(row.createdAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <RecruiterAccountOps
                  userId={row.userId}
                  name={row.fullName}
                  disabledAt={row.disabledAt}
                />
                <DeleteRecruiterDialog
                  userId={row.userId}
                  name={row.fullName}
                  company={row.company}
                />
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge variant={row.hasWorkspace ? "default" : "secondary"}>
                {row.hasWorkspace ? "Workspace ready" : "No workspace yet"}
              </Badge>
              {/* T-266: the one page that tells support the truth about them. */}
              <Link
                href={`/admin/recruiters/${row.userId}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                View detail
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
