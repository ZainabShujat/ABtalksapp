import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import authConfig from "@/auth.config";
import { cookies } from "next/headers";
import { recordLegalConsents } from "@/features/legal/record-consent";
import { recordNewsletterOptIn } from "@/features/legal/record-newsletter-optin";
import { logger } from "@/lib/logger";
import { verifyRecruiterOtp } from "@/features/recruiter-auth/otp";
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
          where: { email },
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
            name: "Dev Login",
            credentials: {
              email: { label: "Email", type: "email" },
              password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
              if (!credentials?.email || !credentials?.password) return null;

              const user = await prisma.user.findUnique({
                where: { email: String(credentials.email) },
              });

              if (!user || !user.password) return null;
              if (user.password !== String(credentials.password)) return null;

              return {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
              };
            },
          }),
        ]
      : []),
    ...(authConfig.providers.filter(
      (p) => p.id !== "credentials" && p.id !== "recruiter-otp",
    ) ?? []),
  ],
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
      try {
        await recordLegalConsents({
          userId: user.id,
          email: user.email ?? null,
          source: "oauth_signup",
        });
        // Login page writes abtalks_newsletter_pref before OAuth starts.
        // Default true if the cookie is missing (e.g. old clients).
        let newsletterOptIn = true;
        try {
          const pref = (await cookies()).get("abtalks_newsletter_pref")?.value;
          if (pref === "0") newsletterOptIn = false;
          if (pref === "1") newsletterOptIn = true;
        } catch {
          // cookies() can throw outside a request context — keep default.
        }
        await recordNewsletterOptIn({
          userId: user.id,
          email: user.email ?? null,
          source: "oauth_signup",
          optIn: newsletterOptIn,
        });
      } catch (error) {
        logger.error("[legal] oauth signup consent not recorded", {
          userId: user.id,
          error: String(error),
        });
      }
    },
  },
});
