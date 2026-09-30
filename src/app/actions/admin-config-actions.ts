"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";
import {
  CONTACT_UNLOCK_COST_KEY,
  MOCK_FREE_ALLOWANCE_KEY,
  MOCK_POINT_COST_KEY,
  STARTING_GRANT_KEY,
  writeIntConfig,
  writeStringConfig,
  WORKSHOP_CALENDAR_VISIBLE_KEY,
  WORKSHOP_COMING_SOON_MESSAGE_KEY,
  WORKSHOP_MODE_KEY,
  WORKSHOP_WHATSAPP_LINK_KEY,
  WORKSHOP_ZOOM_LINK_KEY,
} from "@/lib/platform-config";

type ActionResult = { ok: true } | { ok: false; message: string };

const schema = z.object({
  startingGrantMinor: z.number().int(),
  unlockCostMinor: z.number().int(),
  mockFreeAllowance: z.number().int(),
  mockPointCost: z.number().int(),
  reason: z.string().trim().min(8).max(500),
});

export async function updatePlatformConfigAction(
  input: unknown,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Enter valid integers and a reason of at least 8 characters.",
    };
  }

  try {
    await writeIntConfig({
      key: STARTING_GRANT_KEY,
      intValue: parsed.data.startingGrantMinor,
      actorUserId: admin.userId,
      reason: parsed.data.reason,
    });
    await writeIntConfig({
      key: CONTACT_UNLOCK_COST_KEY,
      intValue: parsed.data.unlockCostMinor,
      actorUserId: admin.userId,
      reason: parsed.data.reason,
    });
    await writeIntConfig({
      key: MOCK_FREE_ALLOWANCE_KEY,
      intValue: parsed.data.mockFreeAllowance,
      actorUserId: admin.userId,
      reason: parsed.data.reason,
    });
    await writeIntConfig({
      key: MOCK_POINT_COST_KEY,
      intValue: parsed.data.mockPointCost,
      actorUserId: admin.userId,
      reason: parsed.data.reason,
    });
    revalidatePath("/admin");
    revalidatePath("/admin/actions");
    return { ok: true };
  } catch (error) {
    logger.error("[admin] updatePlatformConfigAction", { error: String(error) });
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not save configuration.",
    };
  }
}

/**
 * Workshop surface controls. Plan 163 phase 3b.
 *
 * Its own action rather than fields on `updatePlatformConfigAction`, because
 * these are a different surface with a different audience — an admin taking the
 * workshop page down should not be editing credit prices in the same submit.
 *
 * None of these touch the countdown: that is derived from the event's own date
 * and time and has no config key by design.
 */
const workshopConfigSchema = z.object({
  mode: z.enum(["LIVE", "COMING_SOON"]),
  calendarVisible: z.boolean(),
  whatsappLink: z.string().trim().max(200),
  zoomLink: z.string().trim().max(200),
  comingSoonMessage: z.string().trim().max(200),
  reason: z.string().trim().min(8).max(500),
});

export async function updateWorkshopConfigAction(
  input: unknown,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = workshopConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        "Check the values and give a reason of at least 8 characters.",
    };
  }

  try {
    await writeStringConfig({
      key: WORKSHOP_MODE_KEY,
      stringValue: parsed.data.mode,
      actorUserId: admin.userId,
      reason: parsed.data.reason,
    });
    await writeIntConfig({
      key: WORKSHOP_CALENDAR_VISIBLE_KEY,
      intValue: parsed.data.calendarVisible ? 1 : 0,
      actorUserId: admin.userId,
      reason: parsed.data.reason,
    });
    await writeStringConfig({
      key: WORKSHOP_WHATSAPP_LINK_KEY,
      stringValue: parsed.data.whatsappLink,
      actorUserId: admin.userId,
      reason: parsed.data.reason,
    });
    await writeStringConfig({
      key: WORKSHOP_ZOOM_LINK_KEY,
      stringValue: parsed.data.zoomLink,
      actorUserId: admin.userId,
      reason: parsed.data.reason,
    });
    await writeStringConfig({
      key: WORKSHOP_COMING_SOON_MESSAGE_KEY,
      stringValue: parsed.data.comingSoonMessage,
      actorUserId: admin.userId,
      reason: parsed.data.reason,
    });
  } catch (error) {
    logger.error("[admin] updateWorkshopConfigAction", {
      error: String(error),
    });
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not save.",
    };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/workshop");
  return { ok: true };
}
