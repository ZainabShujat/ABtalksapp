"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { takeCheckoutFlash } from "@/components/hire/pending-checkout";

export function CheckoutFlash() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const flash = takeCheckoutFlash();
    if (!flash) return;
    if (flash.placed > 0) {
      setMessage(
        `${flash.placed} request${flash.placed === 1 ? "" : "s"} sent. Our team has it — you don't need to send it again.`,
      );
    } else if (flash.skipped > 0) {
      setMessage("Those candidates were already requested.");
    }
  }, []);

  if (!message) return null;

  return (
    <p className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      {message}
    </p>
  );
}
