import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRecruiter } from "@/lib/program-auth";
import { MatchResults } from "@/components/hire/match-results";
import { loadRequestMatches } from "@/features/hire/load-request-matches";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ requestId: string }> };

export const metadata: Metadata = {
  title: "Matched candidates | ABTalks Hire",
};

export default async function HireCandidatesPage({ params }: Props) {
  const { requestId } = await params;
  const { userId } = await requireRecruiter();

  const data = await loadRequestMatches(requestId, userId);
  if (!data) notFound();

  return (
    <div className="space-y-6">
      <Link
        href={`/hire/${requestId}`}
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "-ml-2 gap-1.5",
        )}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the requirement
      </Link>

      <div className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-primary uppercase">
          Step 2 · Matched profiles
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {data.matches.length} matched{" "}
          {data.matches.length === 1 ? "candidate" : "candidates"}
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Ranked for {data.title || "your requirement"} on verified platform
          evidence — missions, commits, projects and interviews.
        </p>
      </div>

      {data.matches.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No matches for this requirement yet.
        </p>
      ) : (
        <>
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900 dark:text-amber-100">
            <strong className="font-semibold">Privacy protected.</strong>{" "}
            Candidates are shown by reference ID. Names and contact details stay
            hidden until you place a request and our team confirms the
            engagement.
          </p>
          {/* No viewAllHref — this page is where "all" means all. */}
          <MatchResults matches={data.matches} cartCount={data.cartCount} />
        </>
      )}
    </div>
  );
}
