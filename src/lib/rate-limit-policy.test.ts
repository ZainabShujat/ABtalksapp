/**
 * Pure rate-limit policy + required call-site scan.
 *   npm run test:demo1-security
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  RATE_LIMIT_MAX,
  RATE_LIMIT_UNAVAILABLE_MESSAGE,
  RATE_LIMIT_WINDOW_MS,
  REQUIRED_RATE_LIMIT_SITES,
  isRateLimited,
  rateLimitMessage,
} from "@/lib/rate-limit-policy";

let passed = 0;
let failed = 0;

function assert(cond: boolean | undefined, msg: string) {
  if (!cond) throw new Error(msg);
}

function suite(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

console.log("\nDemo 1 rate limits");

suite("under the cap is allowed", () => {
  const now = 1_000_000;
  const hits = Array.from({ length: 5 }, (_, i) => now - i * 1000);
  assert(!isRateLimited(hits, now, 10), "5 < 10 must pass");
});

suite("at the cap is refused", () => {
  const now = 1_000_000;
  const hits = Array.from({ length: 10 }, (_, i) => now - i * 1000);
  assert(isRateLimited(hits, now, 10), "10 of 10 must refuse");
});

suite("hits outside the window do not count", () => {
  const now = 1_000_000;
  const hits = [now - RATE_LIMIT_WINDOW_MS - 1];
  assert(!isRateLimited(hits, now, 1), "stale hits must drop");
});

suite("every bucket has a readable message and a max", () => {
  for (const bucket of Object.keys(RATE_LIMIT_MAX) as (keyof typeof RATE_LIMIT_MAX)[]) {
    assert(RATE_LIMIT_MAX[bucket] > 0, `${bucket} needs a max`);
    assert(rateLimitMessage(bucket).length > 10, `${bucket} needs a message`);
  }
});

suite("existing SEARCH and EXPORT call sites call assertRateLimit", () => {
  for (const site of REQUIRED_RATE_LIMIT_SITES) {
    for (const file of site.files) {
      const abs = join(process.cwd(), file);
      assert(existsSync(abs), `missing ${file}`);
      const src = readFileSync(abs, "utf8");
      assert(
        src.includes("assertRateLimit"),
        `${file} must call assertRateLimit for ${site.bucket}`,
      );
      assert(
        src.includes(`bucket: "${site.bucket}"`),
        `${file} must use bucket ${site.bucket}`,
      );
    }
  }
});

suite("guest scout no longer uses an in-memory Map", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/actions/hire-guest-actions.ts"),
    "utf8",
  );
  assert(!src.includes("new Map"), "guest limiter must not be an in-memory Map");
  assert(src.includes("assertRateLimit"), "guest scout must use assertRateLimit");
});

suite("a limiter that is down does not claim a quota", () => {
  // An unapplied RateLimitBucket enum migration made every OTP request answer
  // "Too many codes requested", so waiting looked like the fix. It never was.
  assert(
    !/too many/i.test(RATE_LIMIT_UNAVAILABLE_MESSAGE),
    "the outage message must not read like a rate limit",
  );
  const src = readFileSync(join(process.cwd(), "src/lib/rate-limit.ts"), "utf8");
  const catchAt = src.indexOf("} catch (error) {");
  assert(catchAt > 0, "assertRateLimit must still fail closed");
  assert(
    src.slice(catchAt).includes("RATE_LIMIT_UNAVAILABLE_MESSAGE"),
    "the catch must report an outage, not a quota",
  );
  assert(
    !src.slice(catchAt).includes("rateLimitMessage(bucket)"),
    "the catch must not reuse the per-bucket quota copy",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
