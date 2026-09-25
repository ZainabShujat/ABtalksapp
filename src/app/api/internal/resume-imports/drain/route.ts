import { NextResponse } from "next/server";
import { drainAndContinue } from "@/features/resume/import/worker";
import { logger } from "@/lib/logger";

/**
 * One résumé-import drain (plan 154). Called by the worker itself to continue
 * in a fresh invocation, so parsing never depends on an admin's browser.
 * Server-to-server only: `CRON_SECRET` bearer, never a session.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 });
  }
  try {
    const data = await drainAndContinue();
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    logger.error("[resume-import] drain route failed", { error: String(error) });
    return NextResponse.json({ ok: false, message: "Drain failed." }, { status: 500 });
  }
}
