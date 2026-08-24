import Link from "next/link";
import { auth } from "@/auth";
import { requireRecruiter } from "@/lib/program-auth";
import { getShortlist } from "@/features/talent-pool/pool";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function TalentShortlistPage() {
  await requireRecruiter();
  const session = await auth();

  const result = await getShortlist(session!.user!.id);

  if (!result.ok) {
    return (
      <p className="text-sm text-muted-foreground">{result.message}</p>
    );
  }

  const rows = result.data;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Your shortlist
        </h1>
        <p className="text-sm text-muted-foreground">
          Private to your account — {rows.length} candidate
          {rows.length === 1 ? "" : "s"}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Star candidates from the talent pool to build your shortlist.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.memberId} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    href={`/talent/members/${row.memberId}`}
                    className="font-semibold hover:underline"
                  >
                    {row.fullName}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {row.jobRole ?? "—"} · {row.company ?? "—"}
                  </p>
                </div>
                <span className="font-display font-bold">{row.totalScore} pts</span>
              </div>
              {row.note && (
                <p className="mt-2 text-sm text-muted-foreground">{row.note}</p>
              )}
              <Link
                href={`/talent/members/${row.memberId}`}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "mt-3 inline-flex",
                )}
              >
                View profile
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
