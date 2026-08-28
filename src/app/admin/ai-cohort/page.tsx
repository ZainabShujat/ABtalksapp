import Link from "next/link";
import { CohortApplicationsView } from "@/components/admin/cohort-applications-view";
import { cn } from "@/lib/utils";
import {
  getCohortApplications,
  type CohortRegion,
} from "@/lib/workshop-supabase";

const REGIONS: { value: CohortRegion; label: string }[] = [
  { value: "us", label: "US" },
  { value: "india", label: "India" },
];

export default async function AdminAICohortPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>;
}) {
  const sp = await searchParams;
  const region: CohortRegion = sp.region === "india" ? "india" : "us";
  const rows = await getCohortApplications(region);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold md:text-3xl">
          AI Cohort Applications
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} application{rows.length === 1 ? "" : "s"} ·{" "}
          {region === "india" ? "India" : "US"} cohort
        </p>
      </div>

      {/* Region tabs */}
      <div className="inline-flex rounded-lg border bg-card p-1">
        {REGIONS.map((r) => {
          const active = r.value === region;
          return (
            <Link
              key={r.value}
              href={`/admin/ai-cohort?region=${r.value}`}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-[#E05226] text-primary-foreground shadow-[var(--shadow-card)]"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {r.label}
            </Link>
          );
        })}
      </div>

      <CohortApplicationsView rows={rows} region={region} />
    </div>
  );
}
