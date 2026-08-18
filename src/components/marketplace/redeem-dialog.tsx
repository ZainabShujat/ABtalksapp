"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { redeemItemAction } from "@/app/actions/marketplace-actions";
import { useSynergy } from "@/components/shared/synergy-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  costSP: number;
  itemTitle: string;
  balance: number;
  defaultPhone: string;
};

export function RedeemDialog({
  open,
  onOpenChange,
  itemId,
  costSP,
  itemTitle,
  balance,
  defaultPhone,
}: Props) {
  const router = useRouter();
  const { setPoints } = useSynergy();
  const [pending, startTransition] = useTransition();
  const [shippingAddress, setShippingAddress] = useState("");
  const [recipientPhone, setRecipientPhone] = useState(defaultPhone);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (next) {
      setRecipientPhone(defaultPhone);
      setError(null);
    }
    onOpenChange(next);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("itemId", itemId);
    formData.set("shippingAddress", shippingAddress);
    formData.set("recipientPhone", recipientPhone);

    startTransition(async () => {
      const result = await redeemItemAction(formData);
      if (result.ok) {
        setPoints(result.newBalance);
        handleOpenChange(false);
        toast.success("Redeemed! Admin will reach out for fulfillment.");
        router.refresh();
        return;
      }

      if ("reason" in result && result.reason === "validation") {
        setError(result.message);
        return;
      }

      if ("reason" in result && result.reason === "insufficient") {
        setError(result.message);
        return;
      }

      if (
        "reason" in result &&
        (result.reason === "inactive" || result.reason === "not_found")
      ) {
        handleOpenChange(false);
        toast.error(result.message);
        router.refresh();
        return;
      }

      setError(result.message ?? "Something went wrong");
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border border-[#1C283D] bg-[#0B1124] text-white ring-1 ring-white/10 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">{itemTitle}</DialogTitle>
          <DialogDescription className="text-[#BCBCBC]">
            This will deduct {costSP} SP from your {balance} SP balance. Address
            and phone are used only for fulfillment (admins only — not public).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="shippingAddress"
              className="text-sm font-medium text-zinc-200"
            >
              Shipping address
            </label>
            <Textarea
              id="shippingAddress"
              name="shippingAddress"
              value={shippingAddress}
              onChange={(e) => setShippingAddress(e.target.value)}
              placeholder="Full postal address — name, street, city, state, pincode, country"
              disabled={pending}
              className="min-h-[100px] border-[#1C283D] bg-[#050C1D] text-white placeholder:text-zinc-500 dark:bg-[#050C1D]"
              required
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="recipientPhone"
              className="text-sm font-medium text-zinc-200"
            >
              Recipient phone
            </label>
            <Input
              id="recipientPhone"
              name="recipientPhone"
              type="tel"
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              disabled={pending}
              className="border-[#1C283D] bg-[#050C1D] text-white placeholder:text-zinc-500 dark:bg-[#050C1D]"
              required
            />
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <DialogFooter className="border-[#1C283D] bg-transparent sm:justify-stretch">
            <Button
              type="submit"
              disabled={pending}
              className="w-full bg-gradient-to-t from-[#2B1D8C] to-[#7166F0] text-white shadow-[inset_0_4px_4px_rgba(0,0,0,0.25)] hover:opacity-95"
            >
              {pending ? "Processing…" : "Confirm Redemption"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
