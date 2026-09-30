"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deletePlatformAssessmentAction } from "@/app/actions/admin-assessment-actions";
import { Button } from "@/components/ui/button";

/** Plan 166 — delete an unsent platform draft (sent ones hold results). */
export function PlatformAssessmentDeleteButton({
  assessmentId,
}: {
  assessmentId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="outline" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden="true" />
        Delete draft
      </Button>
    );
  }

  return (
    <div
      className="flex items-center gap-2"
      role="group"
      aria-label="Confirm delete"
    >
      <span className="text-sm text-[#787878]">Delete this draft?</span>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        Cancel
      </Button>
      <Button
        variant="destructive"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await deletePlatformAssessmentAction({ assessmentId });
            if (!res.ok) {
              toast.error(res.message);
              setConfirming(false);
              return;
            }
            toast.success("Draft deleted");
            router.push("/admin/assessments");
          })
        }
      >
        {pending ? "Deleting…" : "Delete"}
      </Button>
    </div>
  );
}
