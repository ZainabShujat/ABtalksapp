"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deactivateNotificationAction,
  deleteNotificationAction,
} from "@/app/actions/admin-notification-actions";
import type { AdminNotificationRow } from "@/features/notification/admin-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function NotificationsTable({ rows }: { rows: AdminNotificationRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleDeactivate(id: string) {
    setPendingId(id);
    const result = await deactivateNotificationAction({ id });
    setPendingId(null);
    if (result.ok) {
      toast.success("Announcement deactivated");
      router.refresh();
      return;
    }
    toast.error(result.message);
  }

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setPendingId(id);
    const result = await deleteNotificationAction({ id });
    setPendingId(null);
    if (result.ok) {
      toast.success("Announcement deleted");
      router.refresh();
      return;
    }
    toast.error(result.message);
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        No announcements yet. Push one above — it appears in every matching
        student&rsquo;s notification bell immediately.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Announcement</TableHead>
            <TableHead>Audience</TableHead>
            <TableHead>Published</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-medium">{row.title}</div>
                {row.body ? (
                  <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
                    {row.body}
                  </p>
                ) : null}
                {row.href ? (
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {row.href}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="text-sm">{row.audience}</TableCell>
              <TableCell className="text-sm">
                {formatWhen(row.publishedAt)}
              </TableCell>
              <TableCell className="text-sm">
                {formatWhen(row.expiresAt)}
              </TableCell>
              <TableCell>
                <Badge variant={row.isActive ? "default" : "secondary"}>
                  {row.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {row.isActive ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pendingId === row.id}
                      onClick={() => handleDeactivate(row.id)}
                    >
                      Deactivate
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pendingId === row.id}
                    onClick={() => handleDelete(row.id, row.title)}
                    className="text-destructive hover:bg-destructive/10"
                  >
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
