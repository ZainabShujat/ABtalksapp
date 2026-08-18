import "server-only";
import { prisma } from "@/lib/db";

export type AdminNotificationRow = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  category: string;
  audience: string;
  publishedAt: string;
  expiresAt: string | null;
  isActive: boolean;
};

const ADMIN_LIST_LIMIT = 100;

/** Every admin-authored announcement, newest first. Derived event notifications
 *  never appear here — they have no rows. */
export async function getAdminNotifications(): Promise<AdminNotificationRow[]> {
  const rows = await prisma.notification.findMany({
    select: {
      id: true,
      title: true,
      body: true,
      href: true,
      category: true,
      audience: true,
      publishedAt: true,
      expiresAt: true,
      isActive: true,
    },
    orderBy: { publishedAt: "desc" },
    take: ADMIN_LIST_LIMIT,
  });

  return rows.map((row) => ({
    ...row,
    publishedAt: row.publishedAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  }));
}
