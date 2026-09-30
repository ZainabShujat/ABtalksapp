import "server-only";
import { prisma } from "@/lib/db";

/**
 * The post-auth registration gate.
 *
 * Registered = has a CandidateProfile when ENABLE_NEW_CANDIDATE is on
 * (W4-B: StudentProfile identity is a frozen snapshot and may be missing on
 * new registrations). Flag off keeps the legacy StudentProfile row check.
 * Recruiter surfaces (`/hire`, `/talent`) must never call this.
 *
 * Being signed in is NOT being registered. OAuth creates the `User` row before
 * any form is reached, so a candidate can complete Google sign-in and land
 * anywhere with no profile at all. Every candidate destination therefore asks
 * this question for itself rather than trusting that the funnel it came through
 * asked it — `/login` used to wave `/dashboard` and the hackathon paths past the
 * check, which is exactly how people got in without registering.
 *
 * Recruiter surfaces (`/hire`, `/talent`) must never call this: a recruiter has
 * no `StudentProfile` and never will, so the gate would loop them forever
 * through a form that is not theirs.
 */

/** Where a registration with no stated destination lands. */
export const REGISTRATION_DEFAULT_NEXT = "/dashboard";

const ADS_CLICK_KEYS = ["gclid", "gbraid", "wbraid"] as const;

/**
 * Keep Google click ids on a same-origin return path. Other query keys are dropped.
 */
export function withAdsClickIds(
  path: string,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const extra = new URLSearchParams();
  for (const key of ADS_CLICK_KEYS) {
    const raw = searchParams[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value && /^[A-Za-z0-9._-]{1,200}$/.test(value)) extra.set(key, value);
  }
  const qs = extra.toString();
  if (!qs) return path;
  return path.includes("?") ? `${path}&${qs}` : `${path}?${qs}`;
}

/**
 * A same-origin path, or the fallback.
 *
 * `//evil.com` and `/\evil.com` are both protocol-relative to some browsers, so
 * neither survives — a `next` that leaves the origin is an open redirect and
 * this value is read straight out of a query string.
 */
export function safeNextPath(
  raw: string | undefined | null,
  fallback: string = REGISTRATION_DEFAULT_NEXT,
): string {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

/** Six upper-case alphanumerics, or undefined. Matches the referral code format. */
function normalizeRef(raw: string | undefined | null): string | undefined {
  if (typeof raw !== "string") return undefined;
  const normalized = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  return /^[A-Z0-9]{6}$/.test(normalized) ? normalized : undefined;
}

/**
 * The `/register` URL that remembers where the candidate was going.
 *
 * `next` is read back by the register page and used as the post-submit
 * destination, which is what makes "hackathon sign-in ends on the hackathon
 * dashboard, landing-page sign-in ends on /dashboard" one code path.
 */
export function registerHref(
  next: string = REGISTRATION_DEFAULT_NEXT,
  ref?: string | null,
): string {
  const params = new URLSearchParams();
  const target = safeNextPath(next);
  if (target !== REGISTRATION_DEFAULT_NEXT) params.set("next", target);
  const code = normalizeRef(ref);
  if (code) params.set("ref", code);
  const query = params.toString();
  return query ? `/register?${query}` : "/register";
}

/**
 * Where a candidate should end up AFTER registering, given where they were
 * going before the gate stopped them.
 *
 * Identity for almost everything. The exception is the hackathon: its entry
 * points aim at `/hackathon/register`, which is the hackathon's own team form
 * and not a place to land straight out of the candidate funnel. All of them
 * collapse to the hackathon dashboard, which is what a hackathon arrival is
 * actually asking for.
 */
export function postRegisterDestination(intended: string): string {
  const path = safeNextPath(intended);
  if (path === "/hackathon" || path.startsWith("/hackathon/")) {
    return "/hackathon/dashboard";
  }
  return path;
}

export async function isCandidateRegistered(userId: string): Promise<boolean> {
const profile = await prisma.candidateProfile.findUnique({
  where: { userId },
  select: { id: true },
});
return profile !== null;
}

/**
 * `/register?next=…` when this user still has to register, else null.
 *
 * Call it right after the session check on a candidate page and `redirect()` the
 * result when it is not null.
 */
export async function registrationRedirect(
  userId: string,
  next: string,
  ref?: string | null,
): Promise<string | null> {
  if (await isCandidateRegistered(userId)) return null;
  return registerHref(next, ref);
}
