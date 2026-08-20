"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { RedemptionStatus } from "@prisma/client";
import { updateRedemptionStatusAction } from "@/app/actions/admin-redemption-actions";
import type { AdminRedemptionRow } from "@/features/admin/get-redemptions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTimeIST } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = ["ALL", "PENDING", "SHIPPED", "FULFILLED", "CANCELLED"] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];

type Props = {
  rows: AdminRedemptionRow[];
  status: StatusFilter;
};

function statusBadgeClass(status: RedemptionStatus): string {
  switch (status) {
    case "PENDING":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
    case "SHIPPED":
      return "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200";
    case "FULFILLED":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200";
    case "CANCELLED":
      return "bg-muted text-muted-foreground";
    default:
      return "";
  }
}

function RowActions({ row }: { row: AdminRedemptionRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showTracking, setShowTracking] = useState(false);
  const [trackingNote, setTrackingNote] = useState("");

  function submit(nextStatus: RedemptionStatus, note?: string) {
    const formData = new FormData();
    formData.set("redemptionId", row.id);
    formData.set("nextStatus", nextStatus);
    if (note) formData.set("trackingNote", note);

    startTransition(async () => {
      const result = await updateRedemptionStatusAction(formData);
      if (result.ok) {
        toast.success(`Marked ${nextStatus.toLowerCase()}`);
        setShowTracking(false);
        setTrackingNote("");
        router.refresh();
        return;
      }
      toast.error(result.message);
    });
  }

  if (row.status === "FULFILLED" || row.status === "CANCELLED") {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {row.status === "PENDING" ? (
        <>
          {showTracking ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={trackingNote}
                onChange={(e) => setTrackingNote(e.target.value)}
                placeholder="Tracking note (optional)"
                className="max-w-xs"
                disabled={pending}
              />
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => submit("SHIPPED", trackingNote || undefined)}
              >
                Confirm Shipped
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setShowTracking(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setShowTracking(true)}
              >
                Mark Shipped
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => submit("FULFILLED")}
              >
                Mark Fulfilled
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => submit("CANCELLED")}
              >
                Cancel
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => submit("FULFILLED")}
          >
            Mark Fulfilled
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => submit("CANCELLED")}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

export function RedemptionsTable({ rows, status }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setFilter(next: StatusFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "ALL") {
      params.delete("status");
    } else {
      params.set("status", next);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/redemptions?${qs}` : "/admin/redemptions");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter}
            type="button"
            size="sm"
            variant={status === filter ? "default" : "outline"}
            onClick={() => setFilter(filter)}
          >
            {filter}
          </Button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          No redemptions found.
        </p>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <article key={row.id} className="rounded-xl border bg-card p-4 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{row.itemTitle}</p>
                    <p className="text-xs text-muted-foreground">{row.studentName}</p>
                  </div>
                  <Badge className={cn("border-0", statusBadgeClass(row.status))}>
                    {row.status}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {formatDateTimeIST(new Date(row.createdAtIso))} · {row.costSP} SP
                </p>
                <p className="mt-2 text-xs whitespace-pre-wrap">{row.shippingAddress}</p>
                <p className="mt-1 text-xs text-muted-foreground">{row.recipientPhone}</p>
                {row.trackingNote ? (
                  <p className="mt-1 text-xs">Tracking: {row.trackingNote}</p>
                ) : null}
                <div className="mt-3">
                  <RowActions row={row} />
                </div>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>SP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Shipping</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatDateTimeIST(new Date(row.createdAtIso))}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{row.studentName}</p>
                      <p className="text-xs text-muted-foreground">{row.email}</p>
                    </TableCell>
                    <TableCell>{row.itemTitle}</TableCell>
                    <TableCell>{row.costSP}</TableCell>
                    <TableCell>
                      <Badge className={cn("border-0", statusBadgeClass(row.status))}>
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] text-xs">
                      <p className="whitespace-pre-wrap">{row.shippingAddress}</p>
                      <p className="mt-1 text-muted-foreground">{row.recipientPhone}</p>
                      {row.trackingNote ? (
                        <p className="mt-1">Tracking: {row.trackingNote}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <RowActions row={row} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
