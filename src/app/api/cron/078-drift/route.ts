import { NextResponse } from "next/server";
import { checkDualWriteDrift } from "@/repositories/drift";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 });
  }

  try {
    const report = await checkDualWriteDrift();
    return NextResponse.json({
      ok: !report.hasDrift,
      data: report,
    });
  } catch (e) {
    logger.error("[cron/078-drift] failed", { error: String(e) });
    return NextResponse.json(
      { ok: false, message: "Drift check failed." },
      { status: 500 },
    );
  }
}
