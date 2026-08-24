"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  addRecruiterSeatAction,
  setRecruiterSeatActiveAction,
} from "@/app/actions/recruiter-seat-actions";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SeatRow = {
  id: string;
  email: string;
  company: string;
  contactName: string | null;
  active: boolean;
  notes: string | null;
  /** ISO string — dates do not cross the Server→Client boundary as objects. */
  verifiedAt: string;
  hasAccount: boolean;
};

export function RecruiterSeatsPanel({ seats }: { seats: SeatRow[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [contactName, setContactName] = useState("");
  const [pending, startTransition] = useTransition();

  function add() {
    startTransition(async () => {
      const res = await addRecruiterSeatAction({
        email,
        company,
        contactName: contactName || undefined,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setEmail("");
      setCompany("");
      setContactName("");
      toast.success("Seat verified.");
      router.refresh();
    });
  }

  function toggle(seatId: string, active: boolean) {
    if (
      !active &&
      !window.confirm(
        "Revoke this seat? They lose recruiter access on their next request.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await setRecruiterSeatActiveAction({ seatId, active });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  const field =
    "w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none";

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Pre-verify a work email</h2>
        <p className="text-xs text-muted-foreground">
          Optional. If they register with this email they skip the wait.
          Approving an application above also adds them here.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            type="email"
            className={field}
          />
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company"
            className={field}
          />
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Contact name (optional)"
            className={field}
          />
        </div>
        <button
          type="button"
          disabled={pending || !email.trim() || !company.trim()}
          onClick={add}
          className={cn(
            buttonVariants({ size: "sm" }),
            "gap-1.5 disabled:opacity-50",
          )}
        >
          {pending && (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          )}
          Add seat
        </button>
      </div>

      {seats.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No pre-verified emails yet. People can still register — they wait in
          the inbox above until you approve them.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {seats.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium">{s.email}</p>
                <p className="text-xs text-muted-foreground">
                  {s.company}
                  {s.contactName ? ` · ${s.contactName}` : ""} · verified{" "}
                  {s.verifiedAt.slice(0, 10)} ·{" "}
                  {s.hasAccount ? "account created" : "not signed up yet"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium",
                    s.active
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.active ? "Active" : "Revoked"}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => toggle(s.id, !s.active)}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "disabled:opacity-50",
                  )}
                >
                  {s.active ? "Revoke" : "Reinstate"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
