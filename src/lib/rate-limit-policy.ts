/**
 * Rate-limit windows for money and personal-data paths (T-258).
 * Zero imports so tests and the server helper share one decision.
 */

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export const RATE_LIMIT_MAX = {
  UNLOCK: 20,
  OUTREACH: 30,
  SEARCH: 60,
  EXPORT: 10,
  /** Plan 154. Every password attempt on one account, right or wrong. */
  LOGIN_PASSWORD_ACCOUNT: 10,
  /**
   * Plan 154. Per client address. Generous on purpose: a college lab or hostel
   * wifi puts a whole class behind one IP, and the per-account cap above is
   * what actually stops guessing.
   */
  LOGIN_PASSWORD_IP: 100,
  /** Plan 154. Codes emailed to one address — the mailbox is not a free cannon. */
  EMAIL_CODE_ADDRESS: 5,
  /** Plan 154. Codes requested from one client address, any mailbox. */
  EMAIL_CODE_IP: 30,
} as const;

export type RateLimitBucketName = keyof typeof RATE_LIMIT_MAX;

/** Wave-1 actions that must call `assertRateLimit` when they exist. */
export const REQUIRED_RATE_LIMIT_SITES: {
  bucket: RateLimitBucketName;
  files: string[];
}[] = [
  {
    bucket: "SEARCH",
    files: [
      "src/app/actions/hire-actions.ts",
      "src/app/actions/hire-guest-actions.ts",
      // Live brief parsing (Gemini) — own `brief:` subject, same bucket.
      "src/app/api/hire/brief/route.ts",
    ],
  },
  {
    bucket: "EXPORT",
    files: [
      "src/app/actions/admin-export-actions.ts",
      "src/app/actions/admin-program-export-actions.ts",
    ],
  },
  {
    bucket: "UNLOCK",
    files: ["src/app/actions/hire-unlock-actions.ts"],
  },
  { bucket: "OUTREACH", files: ["src/app/actions/outreach-actions.ts"] },
  { bucket: "LOGIN_PASSWORD_ACCOUNT", files: ["src/lib/email-auth.ts"] },
  { bucket: "LOGIN_PASSWORD_IP", files: ["src/lib/email-auth.ts"] },
  { bucket: "EMAIL_CODE_ADDRESS", files: ["src/lib/email-code.ts"] },
  {
    bucket: "EMAIL_CODE_IP",
    files: [
      "src/app/actions/email-auth-actions.ts",
      "src/app/actions/recruiter-auth-actions.ts",
    ],
  },
];

export function isRateLimited(
  timestamps: number[],
  now: number,
  max: number,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): boolean {
  const recent = timestamps.filter((t) => now - t < windowMs);
  return recent.length >= max;
}

/**
 * Shown when the limiter itself cannot answer — a database error, not a quota.
 * It must never read like "too many": an unapplied enum migration once spent
 * an afternoon looking exactly like a rate limit, because both came back in
 * the same words.
 */
export const RATE_LIMIT_UNAVAILABLE_MESSAGE =
  "Something went wrong on our side. Try again in a moment.";

export function rateLimitMessage(bucket: RateLimitBucketName): string {
  switch (bucket) {
    case "UNLOCK":
      return "Too many unlock attempts. Wait a few minutes and try again.";
    case "OUTREACH":
      return "Too many messages. Wait a few minutes and try again.";
    case "SEARCH":
      return "Too many searches. Wait a few minutes and try again.";
    case "EXPORT":
      return "Too many exports. Wait a few minutes and try again.";
    case "LOGIN_PASSWORD_ACCOUNT":
    case "LOGIN_PASSWORD_IP":
      return "Too many sign-in attempts. Wait 15 minutes and try again, or sign in with an emailed code.";
    case "EMAIL_CODE_ADDRESS":
    case "EMAIL_CODE_IP":
      return "Too many codes requested. Wait a few minutes and try again.";
  }
}
