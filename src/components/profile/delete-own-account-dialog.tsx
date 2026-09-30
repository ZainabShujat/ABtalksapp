"use client";

import { useState } from "react";
import { toast } from "sonner";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { deleteOwnAccountAction } from "@/app/actions/candidate-account-actions";
import { signOutAction } from "@/app/actions/auth-actions";
import {
  DELETE_ACCOUNT_FEEDBACK_MAX,
  DELETE_ACCOUNT_REASONS,
  type DeleteAccountReason,
} from "@/features/profile/delete-account-reasons";

export function DeleteOwnAccountDialog() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState<DeleteAccountReason | "">("");
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const canDelete = confirmText === "DELETE" && reason !== "";

  async function onConfirm() {
    if (reason === "") return;
    setPending(true);
    const result = await deleteOwnAccountAction({
      confirm: confirmText,
      reason,
      feedback: feedback.trim() || undefined,
    });
    if (!result.ok) {
      setPending(false);
      toast.error(result.message);
      return;
    }
    // Server-side signOut clears the cookie and redirects to "/" directly;
    // the GET /api/auth/signout route would show Auth.js's confirm page.
    await signOutAction();
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
          setFeedback("");
        }
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" variant="destructive" size="sm">
            Delete my account
          </Button>
        }
      />
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delete my account</DialogTitle>
          <DialogDescription>
            This removes your data from ABTalks and cannot be undone. Type DELETE
            to confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label id="delete-own-reason-label">Why are you leaving us?</Label>
          <RadioGroup
            aria-labelledby="delete-own-reason-label"
            value={reason}
            onValueChange={(value) => setReason(value as DeleteAccountReason)}
          >
            {DELETE_ACCOUNT_REASONS.map((option) => (
              <Label
                key={option}
                className="flex cursor-pointer items-center gap-2 font-normal"
              >
                <RadioGroupItem value={option} />
                {option}
              </Label>
            ))}
          </RadioGroup>
        </div>
        <div className="space-y-2">
          <Label htmlFor="delete-own-feedback">
            Anything else you want to tell us?{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="delete-own-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={DELETE_ACCOUNT_FEEDBACK_MAX}
            rows={3}
            placeholder="Your feedback helps us improve ABTalks"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="delete-own-confirm">Type DELETE</Label>
          <Input
            id="delete-own-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
          />
        </div>
        <DialogFooter showCloseButton>
          <Button
            type="button"
            variant="destructive"
            disabled={!canDelete || pending}
            onClick={onConfirm}
          >
            {pending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
