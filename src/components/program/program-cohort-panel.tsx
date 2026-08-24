"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createOrUpdateCohortAction,
  publishResultsAction,
  regenerateJoinCodeAction,
  setCohortStatusAction,
} from "@/app/actions/admin-program-actions";
import type { CohortOverview } from "@/features/program/admin";
import { PROGRAM_HOLD_OPEN_COHORT_NAME } from "@/features/program/constants";

const STATUSES = [
  "DRAFT",
  "ENROLLING",
  "ACTIVE",
  "COMPLETED",
  "ARCHIVED",
] as const;

const emptyForm = {
  name: "",
  startsAt: "",
  endsAt: "",
  capacity: 100,
  requiresJoinCode: true,
};

export function ProgramCohortPanel({
  overview,
  rawStartsAt,
  rawEndsAt,
  forceCreate,
}: {
  overview: CohortOverview["cohort"] | null;
  rawStartsAt: string | null;
  rawEndsAt: string | null;
  forceCreate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const createMode = forceCreate || !overview;
  const [form, setForm] = useState({
    name: overview?.name ?? "",
    startsAt: rawStartsAt ?? "",
    endsAt: rawEndsAt ?? "",
    capacity: overview?.capacity ?? 100,
    requiresJoinCode: overview?.requiresJoinCode ?? true,
  });

  useEffect(() => {
    if (createMode) {
      setForm(emptyForm);
      return;
    }
    setForm({
      name: overview?.name ?? "",
      startsAt: rawStartsAt ?? "",
      endsAt: rawEndsAt ?? "",
      capacity: overview?.capacity ?? 100,
      requiresJoinCode: overview?.requiresJoinCode ?? true,
    });
  }, [overview, rawStartsAt, rawEndsAt, createMode]);

  function cancelCreate() {
    router.push(
      overview ? `/admin/program?cohortId=${overview.id}` : "/admin/program",
    );
  }

  async function handleSave() {
    setBusy(true);
    try {
      const res = await createOrUpdateCohortAction({
        cohortId: createMode ? undefined : overview?.id,
        ...form,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(createMode ? "Cohort created." : "Cohort saved.");
      const nextId = res.cohortId ?? overview?.id;
      if (nextId) {
        router.push(`/admin/program?cohortId=${nextId}`);
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleStatus(status: string) {
    if (!overview || createMode) return;
    setBusy(true);
    try {
      const res = await setCohortStatusAction({ cohortId: overview.id, status });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Status set to ${status}.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    if (!overview) return;
    setBusy(true);
    try {
      const res = await publishResultsAction({ cohortId: overview.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Results published — recruiters can browse the pool.");
      setPublishOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerateCode() {
    if (!overview) return;
    setBusy(true);
    try {
      const res = await regenerateJoinCodeAction({ cohortId: overview.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`New join code: ${res.joinCode}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copyJoinCode() {
    if (!overview?.joinCode) return;
    try {
      await navigator.clipboard.writeText(overview.joinCode);
      toast.success("Join code copied.");
    } catch {
      toast.error("Could not copy join code.");
    }
  }

  async function copyApplyLink() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/program/apply`,
      );
      toast.success("Apply link copied.");
    } catch {
      toast.error("Could not copy apply link.");
    }
  }

  return (
    <div className="space-y-6 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">
          {createMode ? "Create cohort" : "Cohort settings"}
        </h2>
        {createMode && overview && (
          <Button type="button" variant="ghost" size="sm" onClick={cancelCreate}>
            Cancel
          </Button>
        )}
      </div>

      {!createMode && overview ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Enrolled" value={String(overview.enrolled)} />
          <Stat label="Waitlisted" value={String(overview.waitlisted)} />
          <Stat label="Dropped" value={String(overview.dropped)} />
          <Stat label="Capacity" value={String(overview.capacity)} />
          {overview.requiresJoinCode ? (
            <div className="rounded-lg border px-3 py-2 sm:col-span-2 lg:col-span-1">
              <p className="text-xs text-muted-foreground">Join code</p>
              <div className="mt-1 flex items-center gap-1">
                <p className="font-mono text-lg font-bold tracking-wider">
                  {overview.joinCode}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void copyJoinCode()}
                  aria-label="Copy join code"
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  onClick={() => void handleRegenerateCode()}
                  aria-label="Regenerate join code"
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border px-3 py-2 sm:col-span-2 lg:col-span-1">
              <p className="text-xs text-muted-foreground">Enrollment</p>
              <div className="mt-1 flex items-center gap-1">
                <p className="text-sm font-semibold">Open · no code</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void copyApplyLink()}
                  aria-label="Copy apply link"
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cohort-name">Name</Label>
          <Input
            id="cohort-name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cohort-capacity">Capacity</Label>
          <Input
            id="cohort-capacity"
            type="number"
            min={1}
            max={100}
            value={form.capacity}
            onChange={(e) =>
              setForm((f) => ({ ...f, capacity: Number(e.target.value) }))
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cohort-start">Starts (IST)</Label>
          <Input
            id="cohort-start"
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) =>
              setForm((f) => ({ ...f, startsAt: e.target.value }))
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cohort-end">Ends (IST)</Label>
          <Input
            id="cohort-end"
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) =>
              setForm((f) => ({ ...f, endsAt: e.target.value }))
            }
          />
          {!createMode &&
          overview?.name === PROGRAM_HOLD_OPEN_COHORT_NAME &&
          (overview.status === "ENROLLING" || overview.status === "ACTIVE") ? (
            <p className="text-xs text-muted-foreground">
              Submissions stay open until every enrolled member has passed Day
              31.
            </p>
          ) : null}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Enrollment</Label>
          <RadioGroup
            value={form.requiresJoinCode ? "code" : "open"}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, requiresJoinCode: v === "code" }))
            }
            className="grid gap-2 sm:grid-cols-2"
          >
            <Label
              htmlFor="enroll-code"
              className="flex items-start gap-3 rounded-lg border p-3 font-normal"
            >
              <RadioGroupItem value="code" id="enroll-code" className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">
                  Join code required
                </span>
                <span className="block text-xs text-muted-foreground">
                  Applicants must enter the cohort code to reach the form.
                </span>
              </span>
            </Label>
            <Label
              htmlFor="enroll-open"
              className="flex items-start gap-3 rounded-lg border p-3 font-normal"
            >
              <RadioGroupItem value="open" id="enroll-open" className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">Open — no code</span>
                <span className="block text-xs text-muted-foreground">
                  Anyone signed in can apply straight from /program/apply.
                </span>
              </span>
            </Label>
          </RadioGroup>
          {!form.requiresJoinCode && (
            <p className="text-xs text-muted-foreground">
              Open enrollment only applies while the cohort status is ENROLLING.
              If several open cohorts are ENROLLING, applicants land in the most
              recently created one. The join code keeps working as a direct link.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void handleSave()} disabled={busy}>
          {createMode ? "Create cohort" : "Update cohort"}
        </Button>
        {!createMode && overview && (
          <>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={overview.status}
              onChange={(e) => void handleStatus(e.target.value)}
              disabled={busy}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {!overview.resultsPublishedAt && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPublishOpen(true)}
                disabled={busy}
              >
                Publish results
              </Button>
            )}
          </>
        )}
      </div>

      {!createMode && overview?.resultsPublishedAt && (
        <p className="text-sm text-muted-foreground">
          Results published {overview.resultsPublishedAt}
        </p>
      )}

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish cohort results?</DialogTitle>
            <DialogDescription>
              This is one-way in the UI. Approved recruiters will immediately
              see the talent pool for this cohort.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPublishOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handlePublish()}
              disabled={busy}
            >
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display text-xl font-bold">{value}</p>
    </div>
  );
}
