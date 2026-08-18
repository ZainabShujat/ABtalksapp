"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GrantSynergyDialog } from "@/components/admin/grant-synergy-dialog";
import {
  removeFromChallengeAction,
  resetProgressAction,
  toggleReadyForInterviewAction,
} from "@/app/actions/admin-actions";

interface StudentActionPanelProps {
  studentId: string;
  studentName: string;
  isReadyForInterview: boolean;
  isActive: boolean;
}

function ActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  confirmVariant = "outline",
  children,
  onConfirm,
  pending,
}: {
  trigger: ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: "outline" | "secondary" | "destructive";
  children: React.ReactNode;
  onConfirm: () => Promise<void>;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter showCloseButton>
          <Button
            type="button"
            variant={confirmVariant}
            disabled={pending}
            onClick={async () => {
              await onConfirm();
              setOpen(false);
            }}
          >
            {pending ? "Saving..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StudentActionPanel({
  studentId,
  studentName,
  isReadyForInterview,
  isActive,
}: StudentActionPanelProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [resetReason, setResetReason] = useState("");
  const [toggleReason, setToggleReason] = useState("");
  const [removeReason, setRemoveReason] = useState("");

  const handleResetProgress = async () => {
    setPending(true);
    const result = await resetProgressAction({
      targetUserId: studentId,
      reason: resetReason || undefined,
    });
    setPending(false);

    if (result.ok) {
      toast.success(`Progress reset for ${studentName}`);
      router.refresh();
      return;
    }
    toast.error(result.message);
    throw new Error(result.message);
  };

  const handleToggleReady = async () => {
    setPending(true);
    const result = await toggleReadyForInterviewAction({
      targetUserId: studentId,
      reason: toggleReason || undefined,
    });
    setPending(false);

    if (result.ok) {
      toast.success(
        result.newValue
          ? `${studentName} is now ready for interview`
          : `${studentName} is no longer marked ready`,
      );
      router.refresh();
      return;
    }
    toast.error(result.message);
    throw new Error(result.message);
  };

  const handleRemoveFromChallenge = async () => {
    setPending(true);
    const result = await removeFromChallengeAction({
      targetUserId: studentId,
      reason: removeReason || undefined,
    });
    setPending(false);

    if (result.ok) {
      toast.success(`${studentName} removed from challenge`);
      router.refresh();
      return;
    }
    toast.error(result.message);
    throw new Error(result.message);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <ActionDialog
        trigger={
          <Button type="button" variant="secondary" size="sm">
            Reset Progress
          </Button>
        }
        title="Reset progress"
        description={`This will delete all submissions for ${studentName}, reset counters, and unset ready-for-interview.`}
        confirmLabel="Reset Progress"
        confirmVariant="secondary"
        onConfirm={handleResetProgress}
        pending={pending}
      >
        <div className="space-y-2">
          <Label htmlFor="reset-reason">Reason (optional)</Label>
          <Textarea
            id="reset-reason"
            value={resetReason}
            onChange={(e) => setResetReason(e.target.value)}
          />
        </div>
      </ActionDialog>

      <ActionDialog
        trigger={
          <Button type="button" variant="outline" size="sm">
            {isReadyForInterview
              ? "Unset Ready for Interview"
              : "Mark Ready for Interview"}
          </Button>
        }
        title="Toggle ready for interview"
        description={`This will ${
          isReadyForInterview ? "remove" : "set"
        } the ready-for-interview flag for ${studentName}.`}
        confirmLabel="Confirm"
        onConfirm={handleToggleReady}
        pending={pending}
      >
        <div className="space-y-2">
          <Label htmlFor="toggle-reason">Reason (optional)</Label>
          <Textarea
            id="toggle-reason"
            value={toggleReason}
            onChange={(e) => setToggleReason(e.target.value)}
          />
        </div>
      </ActionDialog>

      <GrantSynergyDialog studentId={studentId} studentName={studentName} />

      <ActionDialog
        trigger={
          <Button type="button" variant="destructive" size="sm" disabled={!isActive}>
            Remove from Challenge
          </Button>
        }
        title="Remove from challenge"
        description={`This will set ${studentName}'s enrollment to abandoned.`}
        confirmLabel="Remove"
        confirmVariant="destructive"
        onConfirm={handleRemoveFromChallenge}
        pending={pending}
      >
        <div className="space-y-2">
          <Label htmlFor="remove-reason">Reason (optional)</Label>
          <Textarea
            id="remove-reason"
            value={removeReason}
            onChange={(e) => setRemoveReason(e.target.value)}
          />
        </div>
      </ActionDialog>
    </div>
  );
}
