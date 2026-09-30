import "server-only";

import { RateLimitBucket } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  RATE_LIMIT_MAX,
  RATE_LIMIT_UNAVAILABLE_MESSAGE,
  RATE_LIMIT_WINDOW_MS,
  isRateLimited,
  rateLimitMessage,
  type RateLimitBucketName,
} from "@/lib/rate-limit-policy";

type ActionErr = { ok: false; message: string };

/**
 * Sliding-window limiter. Inserts a hit, then counts hits in the window.
 * Fail closed on database errors for money/contact buckets; search/export
 * also fail closed so harvest/replay cannot bypass a down limiter.
 *
 * A limiter that cannot count still refuses — but it says so in its own
 * words. Answering an outage with "too many attempts" sends whoever is
 * debugging it off to wait out a window that was never counting.
 */
export async function assertRateLimit(input: {
  bucket: RateLimitBucketName;
  subjectId: string;
}): Promise<{ ok: true } | ActionErr> {
  const { bucket, subjectId } = input;
  const prismaBucket = RateLimitBucket[bucket];
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);

  try {
    const recent = await prisma.rateLimitEvent.findMany({
      where: {
        bucket: prismaBucket,
        subjectId,
        createdAt: { gte: windowStart },
      },
      select: { createdAt: true },
    });

    if (
      isRateLimited(
        recent.map((r) => r.createdAt.getTime()),
        now.getTime(),
        RATE_LIMIT_MAX[bucket],
      )
    ) {
      logger.warn("[rate-limit] refused", { bucket, subjectId });
      return { ok: false, message: rateLimitMessage(bucket) };
    }

    await prisma.rateLimitEvent.create({
      data: { bucket: prismaBucket, subjectId },
      select: { id: true },
    });
    return { ok: true };
  } catch (error) {
    logger.error("[rate-limit] limiter unavailable, refusing", {
      bucket,
      subjectId,
      error: String(error),
    });
    return { ok: false, message: RATE_LIMIT_UNAVAILABLE_MESSAGE };
  }
}

export async function rateLimitSubjectFromHeaders(
  headersList: Headers,
): Promise<string> {
  const ip =
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headersList.get("x-real-ip") ||
    "unknown";
  return `ip:${ip}`;
}
