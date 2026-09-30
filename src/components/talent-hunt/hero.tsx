import { CalendarDays, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Props = {
  compact?: boolean;
  country?: string;
};

export function Hero({ compact = false, country = "USA" }: Props) {
  return (
    <section
      className={cn(
        "relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-background px-4 text-center",
        compact ? "py-6 md:py-10" : "py-16 md:py-24",
      )}
    >
      <div className="container mx-auto max-w-4xl">
        <Badge variant="secondary" className="mb-4 font-medium">
          AI Cohort Training Program
        </Badge>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
          AI Cohort Training Program for Working Professionals
        </h1>
        <p className="mt-4 font-display text-xl font-semibold text-primary sm:text-2xl">
          Learn. Build. Ship AI.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
          A 30-day intensive cohort designed for {country}-based working
          professionals who want to transition into high-impact AI roles with
          live projects, mentorship, and enterprise-grade skills.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-left shadow-[var(--shadow-card)]">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <CalendarDays className="size-4 text-primary" aria-hidden />
            </div>
            <span className="text-sm font-medium text-foreground">
              Start any day
            </span>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-left shadow-[var(--shadow-card)]">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <CalendarDays className="size-4 text-primary" aria-hidden />
            </div>
            <span className="text-sm font-medium text-foreground">
              31 days, paced from your start
            </span>
          </div>
        </div>

        <p className="mx-auto mt-6 flex max-w-md items-center justify-center gap-2 text-sm text-muted-foreground">
          <ClipboardCheck className="size-4 shrink-0 text-primary" aria-hidden />
          Pre-assessment required before cohort acceptance
        </p>
      </div>
    </section>
  );
}
