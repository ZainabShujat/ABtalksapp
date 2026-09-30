"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
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
import { deleteOwnRecruiterAccountAction } from "@/app/actions/recruiter-account-actions";

function usd(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

/**
 * Recruiter self-service account deletion (plan 160).
 *
 * `purchasedBalanceMinor` above zero renders the control disabled with the
 * amount rather than letting the click fail: the server refuses it either way,
 * and a disabled button carrying its own reason is a better answer than an
 * error toast after a confirmation the person meant.
 */
export function DeleteRecruiterAccountDialog({
  purchasedBalanceMinor,
}: {
  purchasedBalanceMinor: number;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const blocked = purchasedBalanceMinor > 0;
  const canDelete = confirmText === "DELETE" && !pending;

  async function onConfirm() {
    setPending(true);
    const result = await deleteOwnRecruiterAccountAction({ confirm: confirmText });
    setPending(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    // The account no longer exists; the session has to go with it.
    window.location.assign("/api/auth/signout?callbackUrl=/");
  }

  if (blocked) {
    return (
      <div className="space-y-2">
        <Button type="button" variant="destructive" size="sm" disabled>
          Delete my account
        </Button>
        <p className="text-sm text-muted-foreground">
          This workspace still holds {usd(purchasedBalanceMinor)} in purchased
          credits. Contact support to close the account so the balance can be
          settled first.
        </p>
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setConfirmText("");
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" variant="destructive" size="sm">
            Delete my account
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your recruiter account?</DialogTitle>
          <DialogDescription>
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <p className="font-medium text-foreground">What is deleted</p>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              <li>Every project, saved search and match list</li>
              <li>Your shortlists and introduction requests</li>
              <li>Every outreach conversation and candidate note</li>
              <li>The assessments you created</li>
              <li>Your profile, company details and logo</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <p className="font-medium text-foreground">What is kept</p>
            <p className="text-muted-foreground">
              The billing record for this workspace, which we are required to
              retain. It no longer identifies you.
            </p>
          </div>

          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Signing out is not the same as this. If you only want to stop
              using the account for a while, ask us to disable it instead —
              that can be reversed, and this cannot.
            </span>
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-delete-recruiter">
              Type <span className="font-mono font-semibold">DELETE</span> to
              confirm
            </Label>
            <Input
              id="confirm-delete-recruiter"
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
            {pending ? "Deleting…" : "Delete my account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
