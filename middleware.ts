import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig, { OAUTH_CHECK_COOKIE_NAMES } from "@/auth.config";

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

/**
 * T-259 request correlation.
 *
 * Duplicated by hand from `src/lib/observability/request-id.ts` for the same
 * reason the consent constants above are: middleware must not import from
 * `@/lib/*`. Keep the header name and the pattern in sync with that file.
 */
const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The caller's id when it is well-formed, a fresh one otherwise.
 *
 * An inbound `x-request-id` is honoured so a trace started by a proxy or a
 * client retry stays one trace — but only after the pattern check, because the
 * value is echoed back in a response header and copied into Sentry tags, and
 * neither should carry whatever a stranger felt like sending.
 */
function resolveRequestId(incoming: string | null): string {
  return incoming && REQUEST_ID_RE.test(incoming)
    ? incoming
    : crypto.randomUUID();
}

const { auth } = NextAuth(authConfig);

const protectedPaths = [
  "/dashboard",
  "/explore",
  "/challenge/",
  "/claude/day",
  "/profile",
  "/achievements",
  "/quiz",
  "/register",
  "/admin",
  "/jobs",
  "/assessments",
  "/mission",
  "/program/ai-cohort/apply",
  "/program/ai-cohort/assessment",
  "/program/ai-cohort/dashboard",
  "/program/ai-cohort/day",
  "/program/ai-cohort/curriculum",
  "/program/ai-cohort/videos",
  "/program/ai-cohort/leaderboard",
  "/program/ai-cohort/cohort-interview",
  "/program/databricks",
  "/program/ds-architect",
  "/program/powerbi",
  "/program/snowflake",
  "/program/databricks-ai",
  "/program/langchain",
  "/talent",
  "/hire",
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

/**
 * Drop leftover Auth.js PKCE/state/nonce cookies (host-only and .abtalks.in).
 * A stale verifier from a previous Google attempt decrypts as InvalidCheck and
 * 500s /api/auth/error — especially when switching accounts or bouncing www.
 */
function expireOAuthCheckCookies(response: NextResponse) {
  const domains: (string | undefined)[] = [undefined, ".abtalks.in"];
  for (const name of OAUTH_CHECK_COOKIE_NAMES) {
    for (const domain of domains) {
      response.cookies.set(name, "", {
        path: "/",
        maxAge: 0,
        httpOnly: true,
        sameSite: "lax",
        secure: name.startsWith("__Secure-"),
        ...(domain ? { domain } : {}),
      });
    }
  }
}

function withTracking(
  response: NextResponse,
  ref: string | null,
  src: string | null,
  alreadyAttributed: boolean,
  consent: string | null,
  hasAttributionCookies: boolean,
  requestId: string,
) {
  // Every response leaves through here, so this is the one place that has to
  // set the correlation header — redirects included. It is not a cookie and
  // carries nothing about the visitor, so it is outside the consent gate.
  response.headers.set(REQUEST_ID_HEADER, requestId);

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
  const requestId = resolveRequestId(req.headers.get(REQUEST_ID_HEADER));
  const isLoggedIn = !!req.auth;
  const ref = req.nextUrl.searchParams.get("ref");
  const src = req.nextUrl.searchParams.get("s");
  const alreadyAttributed = req.cookies.has(SRC_COOKIE_NAME);
  const consent = readConsentChoice(
    req.cookies.get(CONSENT_COOKIE_NAME)?.value,
  );
  const hasAttributionCookies =
    req.cookies.has(REF_COOKIE_NAME) || alreadyAttributed;

  // Exact match only — `/ai` must not capture `/ai-cohort-*` or
  // `/ai-talent-hunt`, and `/claude` must not capture `/claude-signup`.
  // Both of those are public.
  const exactProtectedPaths = ["/ai", "/ds", "/se", "/claude"];

  // Scout itself is public. Auth is a dialog on this page, or a dedicated
  // register/login route. Exact match only: /hire/requests and /hire/[id]
  // stay behind a session. Same for the cart — guests keep it locally.
  const isPublicRecruiterEntry =
    pathname === "/hire" ||
    pathname === "/talent" ||
    pathname === "/hire/matches" ||
    pathname === "/talent/shortlist" ||
    pathname === "/talent/login" ||
    pathname === "/talent/register";

  // Marketing landings only. The protectedPaths prefixes stay, so
  // /program/databricks/day/*, /program/snowflake/day/*, and
  // /program/databricks-ai/day/* and /program/langchain/day/* still require a
  // session. Exact match: `/program/databricks` must not open
  // `/program/databricks-ai`.
  const isPublicCohortLanding =
    pathname === "/program/databricks" ||
    pathname === "/program/snowflake" ||
    pathname === "/program/databricks-ai" ||
    pathname === "/program/langchain";

  const isProtected =
    !isPublicRecruiterEntry &&
    !isPublicCohortLanding &&
    (protectedPaths.some((p) => pathname.startsWith(p)) ||
      exactProtectedPaths.includes(pathname));
  const isAuthPage = pathname === "/login";

  let response: NextResponse;

  if (isProtected && !isLoggedIn) {
    // Send people to their own door. A signed-out recruiter opening a
    // bookmarked /hire used to land on the candidate's Google button, which is
    // the whole complaint this change exists to fix.
    const isRecruiterArea =
      pathname === "/hire" ||
      pathname.startsWith("/hire/") ||
      pathname === "/talent" ||
      pathname.startsWith("/talent/");
    const url = new URL(
      isRecruiterArea ? "/talent/login" : "/login",
      req.nextUrl,
    );
    url.searchParams.set("from", pathname + req.nextUrl.search);
    response = withTracking(
      NextResponse.redirect(url),
      ref,
      src,
      alreadyAttributed,
      consent,
      hasAttributionCookies,
      requestId,
    );
  } else if (isAuthPage && isLoggedIn) {
    const from = req.nextUrl.searchParams.get("from");
    const destination =
      from && from.startsWith("/") && !from.startsWith("//")
        ? from
        : "/";
    response = withTracking(
      NextResponse.redirect(new URL(destination, req.nextUrl)),
      ref,
      src,
      alreadyAttributed,
      consent,
      hasAttributionCookies,
      requestId,
    );
  } else {
    // Forwarded so Server Components, Server Actions and route handlers can read
    // the id back out of `headers()` — see `@/lib/observability/request-id`.
    const forwarded = new Headers(req.headers);
    forwarded.set(REQUEST_ID_HEADER, requestId);

    response = withTracking(
      NextResponse.next({ request: { headers: forwarded } }),
      ref,
      src,
      alreadyAttributed,
      consent,
      hasAttributionCookies,
      requestId,
    );
  }

  if (pathname === "/login") expireOAuthCheckCookies(response);
  return response;
});

export const config = {
  matcher: [
    /**
     * Anything with a file extension is skipped, and that last clause is not
     * cosmetic: `public/` files sit at the site root, so `public/hire/
     * shortlist.jpg` is served at `/hire/shortlist.jpg` — which starts with
     * `/hire`, which this middleware protects. The desk's own icons were being
     * answered with a 307 to `/talent/login`, so the `<img>` received the login
     * page's HTML and rendered as nothing. Only `_next/static` was exempt, and
     * `public/` is not `_next/static`.
     *
     * It gates no route that was gated before. A path ending in `.jpg` or `.css`
     * is a file, and a file was never something a session check protected —
     * `/hire/requests` and every other real route still pass through.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.[\\w]+$).*)",
  ],
};
