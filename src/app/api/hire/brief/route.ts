/**
 * Live brief parsing for the `/hire` composer strip.
 *
 * A POST Route Handler rather than a Server Action for the same reason as
 * `/api/skills/search`: Server Action calls are serialized by the Next.js client
 * router, and this sits on a hot typing path. As an action, a slow parse would
 * queue in front of the recruiter's own Search. POST, not GET, so the brief
 * never lands in a URL or an access log.
 *
 * Public like the Scout hero (guests type here too), so it is rate limited per
 * user when signed in and per IP otherwise. It uses the SEARCH bucket under its
 * own `brief:` subject: a separate budget, so debounced typing can never use
 * up the recruiter's actual searches, and no new enum value or migration.
 *
 * The key stays on the server; the response carries only the parsed patch.
 */
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { logger } from "@/lib/logger";
import {
  assertRateLimit,
  rateLimitSubjectFromHeaders,
} from "@/lib/rate-limit";
import { hireBriefInputSchema } from "@/features/hire/hire-brief";
import {
  extractHireBrief,
  isHireBriefConfigured,
} from "@/features/hire/gemini-brief";

const NO_STORE = { "Cache-Control": "private, no-store" };

function fail(message: string, status: number) {
  return NextResponse.json(
    { ok: false as const, message },
    { status, headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request.", 400);
  }
  const parsed = hireBriefInputSchema.safeParse(body);
  if (!parsed.success) return fail("Invalid request.", 400);

  // No key (local dev): say so once, before touching the limiter, so the
  // composer stops asking and uses its local detector for the session.
  if (!isHireBriefConfigured()) {
    return NextResponse.json(
      { ok: false as const, message: "Live parsing unavailable.", disabled: true },
      { headers: NO_STORE },
    );
  }

  const session = await auth();
  const subject = session?.user?.id
    ? `user:${session.user.id}`
    : await rateLimitSubjectFromHeaders(await headers());
  const limited = await assertRateLimit({
    bucket: "SEARCH",
    subjectId: `brief:${subject}`,
  });
  if (!limited.ok) return fail(limited.message, 429);

  const result = await extractHireBrief(parsed.data.text);
  if (!result.ok) {
    // 200 with ok:false: the composer falls back to its local detector. The
    // reason is coarse on purpose and never names the vendor.
    logger.info("[hire-brief] live parse fell back", { reason: result.reason });
    return NextResponse.json(
      { ok: false as const, message: "Live parsing unavailable." },
      { headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      ok: true as const,
      data: { specPatch: result.patch, flags: result.flags },
    },
    { headers: NO_STORE },
  );
}
