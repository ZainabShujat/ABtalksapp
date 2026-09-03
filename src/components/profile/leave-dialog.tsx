"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function LeaveDialog({
  open,
  onOpenChange,
  onSave,
  onDiscard,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Save your changes?</DialogTitle>
          <DialogDescription>
            You have unsaved changes in this section.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={onDiscard}>
            Don&apos;t save
          </Button>
          <Button type="button" variant="default" autoFocus onClick={onSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
