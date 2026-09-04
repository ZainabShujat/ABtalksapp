"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveCandidateAvailabilityAction } from "@/app/actions/hire-actions";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type AvailabilityFormInitial = {
  openToWork: boolean;
  expectedSalaryMin: number | null;
  expectedSalaryMax: number | null;
  salaryCurrency: string;
  noticePeriodDays: number | null;
  preferredWorkMode: string | null;
  preferredCities: string[];
  openToRelocate: boolean;
};

const NOTICE_CHIPS = [0, 15, 30, 60, 90] as const;
const MODES = [
  { value: "REMOTE", label: "Remote" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "ONSITE", label: "Onsite" },
  { value: "FLEXIBLE", label: "Flexible" },
] as const;

export function AvailabilityForm({
  initial,
}: {
  initial: AvailabilityFormInitial | null;
}) {
  const [openToWork, setOpenToWork] = useState(initial?.openToWork ?? false);
  const [minSal, setMinSal] = useState(
    initial?.expectedSalaryMin != null ? String(initial.expectedSalaryMin) : "",
  );
  const [maxSal, setMaxSal] = useState(
    initial?.expectedSalaryMax != null ? String(initial.expectedSalaryMax) : "",
  );
  const [notice, setNotice] = useState<number | null>(
    initial?.noticePeriodDays ?? null,
  );
  const [mode, setMode] = useState<string | null>(
    initial?.preferredWorkMode ?? null,
  );
  const [cities, setCities] = useState(
    (initial?.preferredCities ?? []).join(", "),
  );
  const [relocate, setRelocate] = useState(initial?.openToRelocate ?? false);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await saveCandidateAvailabilityAction({
        openToWork,
        expectedSalaryMin: minSal ? Number(minSal) : null,
        expectedSalaryMax: maxSal ? Number(maxSal) : null,
        salaryCurrency: "INR",
        noticePeriodDays: notice,
        preferredWorkMode: mode,
        preferredCities: cities
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
          .slice(0, 5),
        openToRelocate: relocate,
      });
      if (!res.ok) toast.error(res.message);
      else
        toast.success(
          res.data.openToWork
            ? "Availability saved for matching."
            : "You are hidden from availability filters.",
        );
    });
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div>
        <h3 className="font-display text-base font-semibold">
          Open to opportunities
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Optional. Visible to approved recruiters only if you also opted into
          recruiter visibility in the program. Salary and notice are never shown
          on public pages. Defaults to off. Nothing is shared until you turn
          this on.
        </p>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <Checkbox
          checked={openToWork}
          onCheckedChange={(c) => setOpenToWork(c === true)}
          className="mt-0.5"
          aria-label="Open to work"
        />
        <span>I am open to work and want Scout to use this for matching</span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sal-min">Expected min (INR annual)</Label>
          <Input
            id="sal-min"
            inputMode="numeric"
            value={minSal}
            onChange={(e) => setMinSal(e.target.value.replace(/\D/g, ""))}
            placeholder="e.g. 1200000"
            disabled={!openToWork}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sal-max">Expected max (INR annual)</Label>
          <Input
            id="sal-max"
            inputMode="numeric"
            value={maxSal}
            onChange={(e) => setMaxSal(e.target.value.replace(/\D/g, ""))}
            placeholder="e.g. 1800000"
            disabled={!openToWork}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Notice period</Label>
        <div className="flex flex-wrap gap-2">
          {NOTICE_CHIPS.map((d) => (
            <button
              key={d}
              type="button"
              disabled={!openToWork}
              onClick={() => setNotice(d)}
              className={cn(
                buttonVariants({
                  variant: notice === d ? "default" : "outline",
                  size: "sm",
                }),
                "disabled:opacity-50",
              )}
            >
              {d === 0 ? "Immediate" : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Preferred work mode</Label>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              disabled={!openToWork}
              onClick={() => setMode(m.value)}
              className={cn(
                buttonVariants({
                  variant: mode === m.value ? "default" : "outline",
                  size: "sm",
                }),
                "disabled:opacity-50",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cities">Preferred cities (comma-separated, max 5)</Label>
        <Input
          id="cities"
          value={cities}
          onChange={(e) => setCities(e.target.value)}
          placeholder="Bengaluru, Hyderabad"
          disabled={!openToWork}
        />
      </div>

      <label className="flex items-start gap-3 text-sm">
        <Checkbox
          checked={relocate}
          onCheckedChange={(c) => setRelocate(c === true)}
          className="mt-0.5"
          disabled={!openToWork}
          aria-label="Open to relocate"
        />
        <span>Open to relocate</span>
      </label>

      <button
        type="button"
        disabled={pending}
        onClick={save}
        className={cn(buttonVariants(), "disabled:opacity-50")}
      >
        {pending ? "Saving…" : "Save availability"}
      </button>
    </div>
  );
}
