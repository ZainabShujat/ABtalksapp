"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { validateJoinCodeAction } from "@/app/actions/program-entry-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PROGRAM_AI_COHORT_BASE } from "@/features/program/constants";

export function JoinCodeGate({
  initialCode = "",
  invalid = false,
}: {
  initialCode?: string;
  invalid?: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);

  async function handleContinue() {
    setBusy(true);
    try {
      const res = await validateJoinCodeAction(code);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.push(
        `${PROGRAM_AI_COHORT_BASE}/apply?code=${encodeURIComponent(res.data.joinCode)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {invalid && (
        <p className="text-sm text-destructive">
          That join code is invalid. Check with your cohort organizer and try
          again.
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="join-code">Cohort join code</Label>
        <Input
          id="join-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. AB7K2M9X"
          autoComplete="off"
          className="font-mono tracking-wider uppercase"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleContinue();
            }
          }}
        />
      </div>
      <Button type="button" onClick={() => void handleContinue()} disabled={busy}>
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Checking…
          </>
        ) : (
          "Continue"
        )}
      </Button>
    </div>
  );
}
