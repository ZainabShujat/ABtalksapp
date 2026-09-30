import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { ACCOUNT_NOTICE_HEADERS } from "./email-delivery";
import { dispatch } from "./notification-service";

/**
 * Tells a person when an admin acted on their account from the
 * "Perform admin action" menu on /admin/students/[id].
 *
 * Every wording lives here, once. The admin action files only call
 * `notifyAdminAction(...)` after their own write succeeded.
 *
 * - Most actions go through `dispatch()` as `account.admin_update`: a bell
 *   notice plus an email (emailExempt — it always sends).
 * - `disabled` and `deleted` email directly: a disabled person cannot sign
 *   in to see the bell, and a deleted person's account (and email address)
 *   is gone. For `deleted` the caller must read the address BEFORE the
 *   anonymize step and pass it in.
 *
 * The admin's typed reason is never included — reasons are written for the
 * audit log, not for the candidate.
 *
 * Never throws: the admin action already succeeded and must not fail
 * because a notice did.
 */

export type AdminActionNotice =
  | { kind: "progress_reset" }
  | { kind: "ready_for_interview"; ready: boolean }
  | { kind: "removed_from_challenge" }
  | { kind: "synergy_granted"; points: number }
  | { kind: "account_restored" }
  | { kind: "account_secured" }
  | { kind: "account_disabled" }
  | { kind: "account_deleted"; email: string; name: string | null };

const EVENT_TYPE = "account.admin_update";

function copyFor(
  notice: AdminActionNotice,
): { title: string; body: string; href: string } {
  switch (notice.kind) {
    case "progress_reset":
      return {
        title: "Your challenge progress was reset",
        body: "An ABTalks admin reset your 60-Day Challenge progress. You can start again from Day 1 on your dashboard.",
        href: "/dashboard",
      };
    case "ready_for_interview":
      return notice.ready
        ? {
            title: "You are marked ready for interviews",
            body: "An ABTalks admin marked your profile as ready for interviews.",
            href: "/dashboard",
          }
        : {
            title: "Your ready-for-interview status was removed",
            body: "An ABTalks admin removed the ready-for-interview mark from your profile.",
            href: "/dashboard",
          };
    case "removed_from_challenge":
      return {
        title: "You were removed from the 60-Day Challenge",
        body: "An ABTalks admin removed you from the 60-Day Challenge. If you think this is a mistake, reply to this email.",
        href: "/dashboard",
      };
    case "synergy_granted":
      return {
        title: `You received ${notice.points} synergy points`,
        body: `An ABTalks admin added ${notice.points} synergy points to your account.`,
        href: "/dashboard",
      };
    case "account_restored":
      return {
        title: "Your ABTalks account has been restored",
        body: "Your account is active again and you can sign in as usual.",
        href: "/login",
      };
    case "account_secured":
      return {
        title: "You were signed out of ABTalks on all devices",
        body: "For your security, an ABTalks admin signed your account out everywhere. Sign in again to continue. If you did not expect this, reply to this email.",
        href: "/login",
      };
    case "account_disabled":
      return {
        title: "Your ABTalks account has been disabled",
        body: "An ABTalks admin disabled your account, so you can no longer sign in. If you think this is a mistake, reply to this email.",
        href: "",
      };
    case "account_deleted":
      return {
        title: "Your ABTalks account has been deleted",
        body: "An ABTalks admin deleted your account and the personal data linked to it. If you think this is a mistake, reply to this email.",
        href: "",
      };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain, one-to-one layout — same look as the dispatch templates. */
async function sendDirect(
  to: string,
  name: string | null,
  kind: string,
  copy: { title: string; body: string },
): Promise<void> {
  const greetingName = name?.trim().split(/\s+/)[0] || "there";
  const html = `<div style="font-family: Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <p style="color: #353535;">Hi ${escapeHtml(greetingName)},</p>
  <h2 style="color: #000000; margin: 16px 0 8px;">${escapeHtml(copy.title)}</h2>
  <p style="color: #353535;">${escapeHtml(copy.body)}</p>
  <hr style="border: none; border-top: 1px solid #E9E9E9; margin: 24px 0;" />
  <p style="color: #A5A5A5; font-size: 12px;">This is a service message about your ABTalks account.</p>
</div>`;
  const text = `Hi ${greetingName},\n\n${copy.title}\n\n${copy.body}\n\n---\nThis is a service message about your ABTalks account.`;

  const result = await sendEmail({
    to,
    toName: name ?? undefined,
    subject: copy.title,
    html,
    text,
    bulk: false,
    headers: ACCOUNT_NOTICE_HEADERS,
    kind: `${EVENT_TYPE}.${kind}`,
  });
  if (!result.ok && !result.skipped) {
    logger.warn("admin-action-notify.direct_email_failed", {
      kind,
      deliveryId: result.deliveryId,
    });
  }
}

export async function notifyAdminAction(
  targetUserId: string,
  notice: AdminActionNotice,
): Promise<void> {
  try {
    const copy = copyFor(notice);

    if (notice.kind === "account_deleted") {
      await sendDirect(notice.email, notice.name, notice.kind, copy);
      return;
    }

    if (notice.kind === "account_disabled") {
      const user = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { email: true, name: true },
      });
      if (user?.email) {
        await sendDirect(user.email, user.name, notice.kind, copy);
      }
      return;
    }

    const result = await dispatch({
      eventType: EVENT_TYPE,
      recipientUserId: targetUserId,
      primaryEntityId: targetUserId,
      // Each admin action is its own event — an admin granting synergy
      // twice must notify twice, so never dedupe across calls.
      dedupeKey: `${EVENT_TYPE}:${targetUserId}:${notice.kind}:${randomUUID()}`,
      title: copy.title,
      body: copy.body,
      href: copy.href,
    });
    if (!result.ok) {
      logger.warn("admin-action-notify.dispatch_refused", {
        kind: notice.kind,
        targetUserId,
        message: result.message,
      });
    }
  } catch (err) {
    logger.warn("admin-action-notify.failed", {
      kind: notice.kind,
      targetUserId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
