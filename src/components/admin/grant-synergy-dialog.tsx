"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { grantSynergyAction } from "@/app/actions/admin-actions";
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

type GrantSynergyDialogProps = {
  studentId: string;
  studentName: string;
};

export function GrantSynergyDialog({
  studentId,
  studentName,
}: GrantSynergyDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [points, setPoints] = useState("50");
  const [reason, setReason] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedPoints = Number.parseInt(points, 10);
    if (!Number.isFinite(parsedPoints) || parsedPoints < 1 || parsedPoints > 3000) {
      toast.error("Enter points between 1 and 3000");
      return;
    }

    setPending(true);
    try {
      const result = await grantSynergyAction({
        targetUserId: studentId,
        points: parsedPoints,
        reason: reason || undefined,
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      toast.success(`Granted ${parsedPoints} synergy to ${studentName}`);
      setOpen(false);
      setReason("");
      router.refresh();
    } catch {
      toast.error("Grant failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            Grant Synergy
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant synergy</DialogTitle>
          <DialogDescription>
            Award community synergy points to {studentName}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`grant-points-${studentId}`}>Points (1–3000)</Label>
            <Input
              id={`grant-points-${studentId}`}
              type="number"
              min={1}
              max={3000}
              value={points}
              onChange={(event) => setPoints(event.target.value)}
              disabled={pending}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`grant-reason-${studentId}`}>Reason (optional)</Label>
            <Textarea
              id={`grant-reason-${studentId}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Weekly comms practice"
              maxLength={500}
              disabled={pending}
            />
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? "Saving..." : "Grant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
