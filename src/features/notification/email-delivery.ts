import "server-only";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { renderTemplate } from "./template-renderer";

/**
 * High-priority headers for account service notices (`account.admin_update`
 * and the direct disable/delete mails in admin-action-notify.ts). Gmail
 * picks the tab and the Important marker itself; these, plus no
 * `Precedence: bulk` and plain service-message copy, are the signals a
 * sender can give. Account notices only — overusing them on routine mail
 * is a spam signal.
 */
export const ACCOUNT_NOTICE_HEADERS: Record<string, string> = {
  Importance: "high",
  "X-Priority": "1",
  Priority: "urgent",
};

const MAX_ATTEMPTS = 5;
const FAILURE_REASON_MAX_LENGTH = 1000;
const SENDING_TIMEOUT_MS = 10 * 60 * 1000;

export async function processEmailDelivery(
  deliveryId: string,
): Promise<void> {
  const claimed = await prisma.$queryRawUnsafe<
    {
      id: string;
      notificationId: string;
      attemptCount: number;
    }[]
  >(
    `UPDATE "NotificationDelivery"
     SET "state" = 'sending',
         "attemptCount" = "attemptCount" + 1,
         "lastAttemptAt" = NOW(),
         "updatedAt" = NOW()
     WHERE "id" = $1
       AND "state" IN ('created', 'failed', 'sending')
     RETURNING "id", "notificationId", "attemptCount"`,
    deliveryId,
  );

  if (claimed.length === 0) return;

  const row = claimed[0];

  const notification = await prisma.userNotification.findUnique({
    where: { id: row.notificationId },
    select: {
      title: true,
      body: true,
      href: true,
      eventType: true,
      metadata: true,
      recipient: { select: { email: true, name: true } },
    },
  });

  if (!notification) {
    logger.error("[email-delivery] notification not found", {
      deliveryId,
      notificationId: row.notificationId,
    });
    await markFailed(deliveryId, "Notification row not found");
    return;
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://abtalks.in";
  const { subject, html, text } = renderTemplate(notification.eventType, {
    title: notification.title,
    body: notification.body ?? "",
    href: notification.href ?? "",
    baseUrl,
    recipientName: notification.recipient.name ?? "there",
  });

  const result = await sendEmail({
    to: notification.recipient.email,
    toName: notification.recipient.name ?? undefined,
    subject,
    html,
    text,
    // Every UserNotification is addressed to one person about their own
    // activity — transactional, not a mailing. Dropping `Precedence: bulk`
    // keeps it out of Gmail's Promotions tab.
    bulk: false,
    kind: notification.eventType,
    // Account service notices get the high-priority headers (only these).
    ...(notification.eventType === "account.admin_update"
      ? { headers: ACCOUNT_NOTICE_HEADERS }
      : {}),
  });

  if (result.ok) {
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { state: "sent", updatedAt: new Date() },
    });
  } else {
    const reason = "skipped" in result && result.skipped
      ? "Email skipped (missing API key or test address)"
      : "Email send failed";
    await markFailed(deliveryId, reason);
  }
}

async function markFailed(
  deliveryId: string,
  reason: string,
): Promise<void> {
  await prisma.notificationDelivery.update({
    where: { id: deliveryId },
    data: {
      state: "failed",
      failureReason: reason.slice(0, FAILURE_REASON_MAX_LENGTH),
      updatedAt: new Date(),
    },
  });
}

export async function retryFailedDeliveries(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const now = new Date();
  const sendingCutoff = new Date(now.getTime() - SENDING_TIMEOUT_MS);

  const eligible = await prisma.notificationDelivery.findMany({
    where: {
      channel: "email",
      OR: [
        {
          state: "failed",
          attemptCount: { lt: MAX_ATTEMPTS },
        },
        {
          state: "sending",
          lastAttemptAt: { lt: sendingCutoff },
        },
      ],
    },
    select: { id: true, state: true, attemptCount: true, lastAttemptAt: true },
  });

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const row of eligible) {
    if (row.state === "failed" && row.lastAttemptAt) {
      const backoffMs = Math.pow(2, row.attemptCount) * 60 * 1000;
      if (now.getTime() - row.lastAttemptAt.getTime() < backoffMs) continue;
    }

    processed++;
    try {
      await processEmailDelivery(row.id);
      const updated = await prisma.notificationDelivery.findUnique({
        where: { id: row.id },
        select: { state: true },
      });
      if (updated?.state === "sent") succeeded++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return { processed, succeeded, failed };
}
