import { NextResponse } from "next/server";
import { drainAndContinue } from "@/features/resume/import/worker";
import { logger } from "@/lib/logger";

/**
 * Daily backstop for the résumé import (plan 154): if every self-kick was lost
 * (a deploy mid-run, a platform hiccup), this picks the queue up again.
 * Expired leases are requeued at the start of every drain.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 });
  }
  try {
    const data = await drainAndContinue();
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    logger.error("[cron/resume-imports] failed", { error: String(error) });
    return NextResponse.json({ ok: false, message: "Cron job failed." }, { status: 500 });
  }
}
