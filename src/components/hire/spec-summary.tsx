import type { JobSpec } from "@/lib/validations/hire";

export function SpecSummary({
  summary,
  spec,
}: {
  summary: string;
  spec: JobSpec;
}) {
  const chips: string[] = [];
  if (spec.title) chips.push(spec.title);
  if (spec.seniority) chips.push(spec.seniority);
  if (spec.mustHaveStack?.length) {
    chips.push(...spec.mustHaveStack.slice(0, 6));
  }
  if (spec.evidencePriority?.length) {
    chips.push(`prio: ${spec.evidencePriority[0]}`);
  }
  if (spec.salaryMin != null || spec.salaryMax != null) {
    chips.push(`₹${spec.salaryMin ?? "?"}–${spec.salaryMax ?? "?"}`);
  }
  if (spec.workMode) chips.push(spec.workMode);
  if (spec.locationCity) chips.push(spec.locationCity);

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Live requirement
      </p>
      <p className="mt-1 text-sm text-foreground">{summary || "Not started"}</p>
      {chips.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <li
              key={c}
              className="rounded-full border bg-background px-2.5 py-0.5 text-xs text-foreground"
            >
              {c}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
