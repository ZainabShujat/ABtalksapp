"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { enrollInClaudeChallenge } from "@/app/actions/enrollment-actions";
import { HUB_BUTTON_CLASS } from "@/components/dashboard-hub/nav-items";
import { cn } from "@/lib/utils";

export function JoinClaudeButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleJoin() {
    setPending(true);
    try {
      const result = await enrollInClaudeChallenge();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Welcome to the Claude Challenge!");
      router.push("/claude");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleJoin}
      disabled={pending}
      className={cn(HUB_BUTTON_CLASS, "mt-4 w-full disabled:opacity-60")}
    >
      {pending ? "Joining…" : "Join"}
    </button>
  );
}
