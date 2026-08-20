import Link from "next/link";

type RecentAdminAction = {
  id: string;
  adminName: string;
  actionLabel: string;
  targetUserId: string;
  targetName: string;
  createdAtRelative: string;
};

type ActivityTimelineProps = {
  items: RecentAdminAction[];
};

export function ActivityTimeline({ items }: ActivityTimelineProps) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No admin actions yet</p>;
  }

  return (
    <div className="space-y-0">
      {items.map((row, index) => (
        <div key={row.id} className="relative flex gap-3 pb-4 last:pb-0">
          {index < items.length - 1 ? (
            <span
              className="absolute left-[5px] top-3 h-[calc(100%-4px)] w-px bg-border"
              aria-hidden
            />
          ) : null}
          <span
            className="relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary ring-2 ring-card"
            aria-hidden
          />
          <div className="min-w-0 flex-1 text-sm">
            <p>
              <span className="font-semibold">{row.adminName}</span>{" "}
              <span className="font-semibold">{row.actionLabel}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Target:{" "}
              <Link
                href={`/admin/students/${row.targetUserId}`}
                className="text-primary hover:underline"
              >
                {row.targetName}
              </Link>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{row.createdAtRelative}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
