import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

const useSecureCookies = process.env.NODE_ENV === "production";
const cookiePrefix = useSecureCookies ? "__Secure-" : "";

/**
 * Host-only cookies split www.abtalks.in and abtalks.in, so a Google callback
 * that lands on the other host cannot decrypt (or even see) the PKCE cookie.
 * Preview / localhost keep host-only cookies.
 */
function oauthCookieDomain(): string | undefined {
  const raw = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  if (!raw) return undefined;
  try {
    const host = new URL(raw).hostname;
    if (host === "abtalks.in" || host === "www.abtalks.in") return ".abtalks.in";
  } catch {
    return undefined;
  }
  return undefined;
}

const cookieDomain = oauthCookieDomain();

/**
 * Plan 154. With email sign-in on, an account can exist without a Google link
 * (created by an emailed code, or holding only a password). Letting Google
 * attach to it by email is safe only because every such account proved its
 * address with a code first; `auth.ts`'s signIn callback refuses the link for
 * recruiter, frozen and unverified-at-Google cases. Read as raw env — this
 * file is in the edge bundle and cannot import `@/lib/feature-flags`.
 */
const linkGoogleByEmail = process.env.ENABLE_EMAIL_LOGIN === "true";

/** Seconds, like `iat`. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function oauthCheckCookie(name: string) {
  return {
    name: `${cookiePrefix}${name}`,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      secure: useSecureCookies,
      maxAge: 60 * 15,
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    },
  };
}

/**
 * Current + pre-v2 Auth.js OAuth-check cookie names. Middleware expires these
 * on /login so a leftover verifier from a previous Google attempt cannot 500
 * the next sign-in. Keep in sync with `cookies` below.
 */
export const OAUTH_CHECK_COOKIE_NAMES = [
  "authjs.pkce.code_verifier",
  "__Secure-authjs.pkce.code_verifier",
  "authjs.pkce.code_verifier.v2",
  "__Secure-authjs.pkce.code_verifier.v2",
  "authjs.state",
  "__Secure-authjs.state",
  "authjs.state.v2",
  "__Secure-authjs.state.v2",
  "authjs.nonce",
  "__Secure-authjs.nonce",
  "authjs.nonce.v2",
  "__Secure-authjs.nonce.v2",
] as const;

export default {
  // Explicit so Edge middleware (middleware.ts) always receives the secret.
  // Auth.js also reads AUTH_SECRET from env; this is the belt-and-suspenders fix
  // when process.env is sparse under Turbopack/edge bundling.
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  pages: {
    signIn: "/login",
    // InvalidCheck (stale/missing PKCE) otherwise 500s /api/auth/error with
    // ?error=Configuration. Send the user back to sign-in instead.
    error: "/login",
  },
  providers: [
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
            authorization: {
              params: { prompt: "select_account" },
            },
            allowDangerousEmailAccountLinking: linkGoogleByEmail,
          }),
        ]
      : []),
    // Recruiter email OTP. Edge-safe stub, exactly like the dev provider below:
    // middleware imports this file, so the real authorize — which needs Prisma —
    // lives in auth.ts. Registering it here is what makes the id routable.
    Credentials({
      id: "recruiter-otp",
      name: "Recruiter email code",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Code", type: "text" },
      },
      authorize: async () => null,
    }),
    // Plan 154: candidate sign-in by emailed code, and password sign-in for
    // both doors. Same edge-safe stubs; the real authorize is in auth.ts.
    // These replace the plain-text "dev-credentials" provider.
    Credentials({
      id: "email-code",
      name: "Email code",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Code", type: "text" },
      },
      authorize: async () => null,
    }),
    Credentials({
      id: "password",
      name: "Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        audience: { label: "Audience", type: "text" },
      },
      authorize: async () => null,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.role = (user as { role?: string }).role ?? "STUDENT";
        token.authTime = nowSeconds();
        token.authTimeEstimated = false;
      } else if (typeof token.authTime !== "number") {
        // Tokens from before authTime existed. `iat` is re-stamped on every
        // refresh, so it is the latest time this session was known good —
        // never later than a revocation that happens after it. Good enough to
        // revoke by; not proof of a recent sign-in, hence the flag.
        token.authTime = typeof token.iat === "number" ? token.iat : nowSeconds();
        token.authTimeEstimated = true;
      }
      if (token.email) {
        const adminEmails = (process.env.ADMIN_EMAILS ?? "")
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);
        token.isAdmin = adminEmails.includes(String(token.email).toLowerCase());
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { isAdmin?: boolean }).isAdmin = token.isAdmin as boolean;
      }
      session.authTime =
        typeof token.authTime === "number" && token.authTimeEstimated !== true
          ? token.authTime
          : undefined;
      return session;
    },
  },
  session: { strategy: "jwt" },
  // v2 name ignores stale JWTs encrypted with a previous secret
  // ("no matching decryption secret" on /login and /register).
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.session-token.v2"
          : "authjs.session-token.v2",
    },
    pkceCodeVerifier: oauthCheckCookie("authjs.pkce.code_verifier.v2"),
    state: oauthCheckCookie("authjs.state.v2"),
    nonce: oauthCheckCookie("authjs.nonce.v2"),
  },
} satisfies NextAuthConfig;
