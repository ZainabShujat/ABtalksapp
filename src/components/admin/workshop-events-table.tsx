"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  archiveWorkshopAction,
  deleteWorkshopAction,
  publishWorkshopAction,
  unarchiveWorkshopAction,
  unpublishWorkshopAction,
} from "@/app/actions/admin-workshop-actions";

export type AdminWorkshopRow = {
  id: string;
  date: string;
  title: string;
  track: string;
  registrationOpen: boolean;
  publishedAt: string | null;
  archivedAt: string | null;
  registrations: number;
};

/**
 * The workshop list. Plan 163 phase 2.
 *
 * Shows every event whatever its state, including the ten archived legacy ones
 * with their rosters — "preserved and admin-visible" is the requirement, and
 * this is where that is true.
 *
 * The important rule it encodes: **Delete and Archive are different buttons,
 * never one that quietly picks.** A workshop with registrations offers Archive
 * and says why Delete is unavailable; one with an empty roster offers Delete.
 * Deleting a registered workshop would destroy its roster, so the UI never
 * puts a visitor one careless click away from it.
 */
export function WorkshopEventsTable({
  rows,
  onEdit,
}: {
  rows: AdminWorkshopRow[];
  onEdit: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState<AdminWorkshopRow | null>(null);
  const [reason, setReason] = useState("");

  function run(
    label: string,
    fn: () => Promise<{ ok: boolean; message?: string }>,
  ) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.message ?? "That did not work.");
        return;
      }
      toast.success(label);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No workshops yet. Create the first one above.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {rows.map((row) => {
          const archived = row.archivedAt !== null;
          const published = row.publishedAt !== null;
          const hasRoster = row.registrations > 0;
          // The single definition of "publicly live", matching the eligibility
          // rule in the repository. Published but closed is legal and must not
          // look like a failed publish.
          const publiclyEligible = published && !archived && row.registrationOpen;

          return (
            <li key={row.id} className="rounded-xl border p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{row.title}</p>
                  <p className="mt-0.5 text-muted-foreground">
                    {row.date} · {row.track}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {row.id}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant={archived ? "secondary" : published ? "default" : "outline"}>
                      {archived ? "Archived" : published ? "Published" : "Draft"}
                    </Badge>
                    {published && !archived && !row.registrationOpen ? (
                      <span className="text-xs text-[#AA821D]">
                        Registration closed — not publicly visible
                      </span>
                    ) : null}
                    {publiclyEligible ? (
                      <span className="text-xs text-[#197E23]">Live on /workshop</span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {row.registrations} registration
                      {row.registrations === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => onEdit(row.id)}
                  >
                    Edit
                  </Button>

                  {published ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        run("Unpublished", () =>
                          unpublishWorkshopAction({ id: row.id }),
                        )
                      }
                    >
                      Unpublish
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending || archived}
                      onClick={() =>
                        run("Published", () =>
                          publishWorkshopAction({ id: row.id }),
                        )
                      }
                    >
                      Publish
                    </Button>
                  )}

                  {archived ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        run("Unarchived", () =>
                          unarchiveWorkshopAction({ id: row.id }),
                        )
                      }
                    >
                      Unarchive
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        run("Archived", () =>
                          archiveWorkshopAction({ id: row.id }),
                        )
                      }
                    >
                      Archive
                    </Button>
                  )}

                  {/*
                    Delete exists only for an empty roster. With registrations
                    the button is absent entirely and the reason is spelled
                    out — a disabled button invites people to wonder, and this
                    is the one action that cannot be undone.
                  */}
                  {hasRoster ? (
                    <span className="text-xs text-muted-foreground">
                      {row.registrations} registration
                      {row.registrations === 1 ? "" : "s"} — archive instead of
                      deleting
                    </span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={pending}
                      onClick={() => {
                        setReason("");
                        setDeleting(row);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (pending) return;
          if (!next) {
            setDeleting(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete workshop</DialogTitle>
            <DialogDescription>
              {deleting
                ? `"${deleting.title}" has no registrations, so it can be deleted outright. This cannot be undone.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="workshop-delete-reason">Reason</Label>
            <Textarea
              id="workshop-delete-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={8}
            />
          </div>
          <DialogFooter showCloseButton>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || reason.trim().length < 8}
              onClick={() => {
                const target = deleting;
                if (!target) return;
                run("Workshop deleted", async () => {
                  const res = await deleteWorkshopAction({
                    id: target.id,
                    reason: reason.trim(),
                  });
                  if (res.ok) setDeleting(null);
                  return res;
                });
              }}
            >
              {pending ? "Deleting..." : "Delete workshop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
