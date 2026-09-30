"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteRecruiterAccountAction } from "@/app/actions/admin-recruiter-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Admin-initiated permanent deletion of a recruiter account (plan 160).
 *
 * Sits beside RecruiterAccountOps, whose disable / restore are the reversible
 * operations. This one is not, which is why it takes both a reason and a typed
 * confirmation and echoes the name and company back.
 */
export function DeleteRecruiterDialog({
  userId,
  name,
  company,
}: {
  userId: string;
  name: string;
  company: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const canDelete = confirmText === "DELETE" && reason.trim().length >= 8 && !pending;

  async function onConfirm() {
    setPending(true);
    const result = await deleteRecruiterAccountAction({
      targetUserId: userId,
      confirm: confirmText,
      reason,
    });
    setPending(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Recruiter account deleted.");
    setOpen(false);
    setConfirmText("");
    setReason("");
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) {
          setConfirmText("");
          setReason("");
        }
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" variant="destructive" size="sm">
            Delete permanently
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}&apos;s account?</DialogTitle>
          <DialogDescription>
            {company} — this cannot be undone. Disable is the reversible option.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Their projects, searches, shortlists, outreach, notes and
            assessments are deleted, and the account is anonymised so the email
            address can be used again. The billing record is kept and no longer
            identifies them.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor={`delete-reason-${userId}`}>
              Reason (at least 8 characters)
            </Label>
            <Textarea
              id={`delete-reason-${userId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why this account is being deleted"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`delete-confirm-${userId}`}>
              Type <span className="font-mono font-semibold">DELETE</span> to
              confirm
            </Label>
            <Input
              id={`delete-confirm-${userId}`}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              placeholder="DELETE"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!canDelete}
            onClick={() => void onConfirm()}
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
