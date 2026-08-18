import { requireAdmin } from "@/lib/admin-auth";
import { NotificationComposer } from "@/components/admin/notification-composer";
import { NotificationsTable } from "@/components/admin/notifications-table";
import { getAdminNotifications } from "@/features/notification/admin-data";

export default async function AdminNotificationsPage() {
  await requireAdmin();
  const rows = await getAdminNotifications();

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold md:text-3xl">
          Notifications
        </h1>
        <p className="text-sm text-muted-foreground">
          Push an announcement to the notification bell. Workshop, hackathon and
          cohort notifications are generated automatically from their dates and
          do not appear here.
        </p>
      </div>

      <NotificationComposer />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Pushed announcements</h2>
        <NotificationsTable rows={rows} />
      </div>
    </div>
  );
}
