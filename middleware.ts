import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/auth.config";

const REF_COOKIE_NAME = "abtalks_ref";
const REF_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

const SRC_COOKIE_NAME = "abtalks_src";
const SRC_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

// Kept in sync by hand with `src/lib/legal.ts` (COOKIE_POLICY_VERSION) and
// `src/lib/cookies.ts`. Middleware must not import from `@/lib/*` — doing so
// blows the 1 MB Edge bundle limit. This duplication is deliberate.
const CONSENT_COOKIE_NAME = "abtalks_consent";
const CONSENT_POLICY_VERSION = "2026-08-10";

/** Returns the stored choice, or null if absent or from an older policy version. */
function readConsentChoice(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot === -1) return null;
  if (value.slice(dot + 1) !== CONSENT_POLICY_VERSION) return null;
  const choice = value.slice(0, dot);
  return choice === "all" || choice === "limited" || choice === "essential"
    ? choice
    : null;
}

const { auth } = NextAuth(authConfig);

const protectedPaths = [
  "/dashboard",
  "/explore",
  "/challenge/",
  "/profile",
  "/achievements",
  "/quiz",
  "/register",
  "/admin",
  "/jobs",
  "/mission",
  "/program/apply",
  "/program/assessment",
  "/program/dashboard",
  "/program/day",
  "/program/curriculum",
  "/program/videos",
  "/program/leaderboard",
  "/program/interview",
  "/talent",
  "/hackathon/register",
  "/hackathon/dashboard",
  "/hackathon/submission",
];

function applyRefCookie(response: NextResponse, ref: string | null) {
  if (!ref || ref.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(ref)) {
    return response;
  }

  response.cookies.set(REF_COOKIE_NAME, ref, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: REF_COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}

function applySourceCookie(
  response: NextResponse,
  src: string | null,
  alreadyAttributed: boolean,
) {
  // First touch wins: never overwrite an existing attribution.
  if (alreadyAttributed) return response;
  if (!src || src.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(src)) {
    return response;
  }

  response.cookies.set(SRC_COOKIE_NAME, src.toLowerCase(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SRC_COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}

function withTracking(
  response: NextResponse,
  ref: string | null,
  src: string | null,
  alreadyAttributed: boolean,
  consent: string | null,
  hasAttributionCookies: boolean,
) {
  // No decision yet: set nothing. The consent modal captures `?ref=` / `?s=`
  // from the URL and replays them through setCookieConsentAction on accept.
  if (consent === null) return response;

  // Declined: never set attribution, and expire anything already present.
  if (consent === "essential") {
    if (hasAttributionCookies) {
      response.cookies.delete(REF_COOKIE_NAME);
      response.cookies.delete(SRC_COOKIE_NAME);
    }
    return response;
  }

  return applySourceCookie(applyRefCookie(response, ref), src, alreadyAttributed);
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const ref = req.nextUrl.searchParams.get("ref");
  const src = req.nextUrl.searchParams.get("s");
  const alreadyAttributed = req.cookies.has(SRC_COOKIE_NAME);
  const consent = readConsentChoice(
    req.cookies.get(CONSENT_COOKIE_NAME)?.value,
  );
  const hasAttributionCookies =
    req.cookies.has(REF_COOKIE_NAME) || alreadyAttributed;

  // Exact match only — `/ai` must not capture `/ai-workshop`,
  // `/ai-cohort-*` or `/ai-talent-hunt`, and `/claude` must not
  // capture `/claude-signup`. All of those are public.
  const exactProtectedPaths = ["/ai", "/ds", "/se", "/claude"];

  const isProtected =
    protectedPaths.some((p) => pathname.startsWith(p)) ||
    exactProtectedPaths.includes(pathname);
  const isAuthPage = pathname === "/login";

  if (isProtected && !isLoggedIn) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("from", pathname + req.nextUrl.search);
    return withTracking(
      NextResponse.redirect(url),
      ref,
      src,
      alreadyAttributed,
      consent,
      hasAttributionCookies,
    );
  }

  if (isAuthPage && isLoggedIn) {
    const from = req.nextUrl.searchParams.get("from");
    const destination =
      from && from.startsWith("/") && !from.startsWith("//")
        ? from
        : "/";
    return withTracking(
      NextResponse.redirect(new URL(destination, req.nextUrl)),
      ref,
      src,
      alreadyAttributed,
      consent,
      hasAttributionCookies,
    );
  }

  return withTracking(
    NextResponse.next(),
    ref,
    src,
    alreadyAttributed,
    consent,
    hasAttributionCookies,
  );
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth).*)",
  ],
};
