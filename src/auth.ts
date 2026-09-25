import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import { isRecruiterAuthEnabled } from "@/lib/feature-flags";
import authConfig from "@/auth.config";
import { cookies } from "next/headers";
import { recordLegalConsents } from "@/features/legal/record-consent";
import { recordNewsletterOptIn } from "@/features/legal/record-newsletter-optin";
import { logger } from "@/lib/logger";
import { verifyRecruiterOtp } from "@/features/recruiter-auth/otp";
import { isJwtInvalidated } from "@/lib/account-status";
import {
  attachParsedImportToUser,
  evaluateGoogleLink,
  onGoogleAccountLinked,
} from "@/features/resume/import/claim";
//auth is the full config with PrismaAdapter and real Credentials authorize. Used everywhere else.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    /**
     * Recruiter sign-in by emailed code.
     *
     * Credentials providers bypass the adapter, so `events.createUser` below
     * never fires for this path — the User row and its consent record have to
     * be written here. Without that we would hold a recruiter's data with no
     * record of them agreeing to anything, which is the exact case that hook
     * was added to prevent.
     */
    Credentials({
      id: "recruiter-otp",
      name: "Recruiter email code",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Code", type: "text" },
      },
      async authorize(credentials) {
        if (!isRecruiterAuthEnabled()) return null;

        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const code = String(credentials?.code ?? "").trim();
        if (!email || !/^\d{6}$/.test(code)) return null;

        const verified = await verifyRecruiterOtp(email, code);
        if (!verified.ok) return null;

        // Signing in requires a registration. Accounts are created by the
        // registration flow, never here — a valid code for an unregistered
        // address must not become an account, or the review step means nothing.
        // Unapproved profiles are allowed through so they can reach the
        // "we're reviewing you" page; every recruiter surface still checks
        // `approved` for itself.
        const existing = await prisma.user.findFirst({
          where: { email, deletedAt: null, disabledAt: null },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            recruiterProfile: { select: { id: true } },
          },
        });
        if (!existing?.recruiterProfile) return null;

        return {
          id: existing.id,
          email: existing.email,
          name: existing.name,
          role: existing.role,
        };
      },
    }),
    ...(process.env.ENABLE_DEV_AUTH === "true"
      ? [
          Credentials({
            id: "dev-credentials",
            name: "Dev Login",
            credentials: {
              email: { label: "Email", type: "email" },
              password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
              try {
                if (!credentials?.email || !credentials?.password) return null;

                const user = await prisma.user.findUnique({
                  where: { email: String(credentials.email) },
                  select: {
                    id: true,
                    email: true,
                    name: true,
                    role: true,
                    password: true,
                    deletedAt: true,
                    disabledAt: true,
                  },
                });

                if (!user || !user.password || user.deletedAt || user.disabledAt) return null;
                if (user.password !== String(credentials.password)) return null;

                return {
                  id: user.id,
                  email: user.email,
                  name: user.name,
                  role: user.role,
                };
              } catch (error) {
                console.error("DEV LOGIN AUTHORIZE ERROR:", error);
                throw error;
              }
            },
          }),
        ]
      : []),
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [
          require("next-auth/providers/google").default({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
            authorization: {
              params: { prompt: "select_account" },
            },
            // Plan 154: lets a verified Google sign-in link to the account an
            // admin created from the student's résumé. `callbacks.signIn` →
            // `evaluateGoogleLink` narrows this to exactly that case and denies
            // every other existing-email link, as Auth.js did before.
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (user?.id) {
        const row = await prisma.user.findUnique({
          where: { id: user.id },
          select: { deletedAt: true, disabledAt: true },
        });
        if (row?.deletedAt || row?.disabledAt) return false;
      }
      if (account?.provider === "google") {
        const decision = await evaluateGoogleLink({
          providerAccountId: account.providerAccountId,
          email: profile?.email ?? user?.email,
          emailVerified: (profile as { email_verified?: boolean } | undefined)?.email_verified === true,
        });
        // The exact outcome Auth.js produced before linking was enabled.
        if (decision === "deny") return "/login?error=OAuthAccountNotLinked";
      }
      return true;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { isAdmin?: boolean }).isAdmin =
          token.isAdmin as boolean;
      }

      const userId = token.id as string | undefined;
      if (userId) {
        const row = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            deletedAt: true,
            disabledAt: true,
            sessionInvalidatedAt: true,
          },
        });
        if (
          row?.deletedAt ||
          row?.disabledAt ||
          isJwtInvalidated(token.iat, row?.sessionInvalidatedAt)
        ) {
          return { ...session, user: undefined as never };
        }
      }
      return session;
    },
  },
  events: {
    /**
     * Fires exactly once, when the adapter first creates a User row — i.e. the
     * moment we begin holding someone's personal data. Every signup form
     * records its own consent, but OAuth sign-in creates the account before
     * any form is reached, so without this a visitor could sign in, never
     * finish registration, and leave us holding their data with no consent
     * record. The login page carries the matching notice.
     *
     * Never throws: a failure here must not break sign-in.
     */
    async createUser({ user }) {
      if (!user.id) return;
      await recordOAuthConsent(user.id, user.email ?? null, "oauth_signup");
      // Plan 154: an admin parsed this student's résumé but never registered
      // it — attach it so /register's résumé step is already done.
      try {
        await attachParsedImportToUser(user.id, user.email);
      } catch (error) {
        logger.error("[resume-import] attach at signup failed", {
          userId: user.id,
          error: String(error),
        });
      }
    },
    /**
     * Plan 154: a Google account was linked. For a student an admin imported
     * this IS the claim — the adapter linked their Google login to the User
     * created for them (`createUser` never fires for it, so their consent is
     * recorded here). For every ordinary signup it is a no-op.
     *
     * Never throws: a failure here must not break sign-in.
     */
    async linkAccount({ user, account }) {
      if (account.provider !== "google" || !user.id) return;
      try {
        const claimed = await onGoogleAccountLinked(user.id);
        if (claimed) await recordOAuthConsent(user.id, user.email ?? null, "oauth_claim");
      } catch (error) {
        logger.error("[resume-import] claim on link failed", {
          userId: user.id,
          error: String(error),
        });
      }
    },
  },
});

/**
 * Consent + newsletter preference for an OAuth arrival — the earliest point we
 * hold their data. The login page carries the matching notice and writes
 * abtalks_newsletter_pref before OAuth starts. Never throws.
 */
async function recordOAuthConsent(
  userId: string,
  email: string | null,
  source: "oauth_signup" | "oauth_claim",
): Promise<void> {
  try {
    await recordLegalConsents({ userId, email, source });
    // Default true if the cookie is missing (e.g. old clients).
    let newsletterOptIn = true;
    try {
      const pref = (await cookies()).get("abtalks_newsletter_pref")?.value;
      if (pref === "0") newsletterOptIn = false;
      if (pref === "1") newsletterOptIn = true;
    } catch {
      // cookies() can throw outside a request context — keep default.
    }
    await recordNewsletterOptIn({ userId, email, source, optIn: newsletterOptIn });
  } catch (error) {
    logger.error("[legal] oauth consent not recorded", {
      userId,
      source,
      error: String(error),
    });
  }
}
