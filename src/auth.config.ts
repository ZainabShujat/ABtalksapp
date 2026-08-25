import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

export default {
  // Explicit so Edge middleware (middleware.ts) always receives the secret.
  // Auth.js also reads AUTH_SECRET from env; this is the belt-and-suspenders fix
  // when process.env is sparse under Turbopack/edge bundling.
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  providers: [
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
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
    ...(process.env.ENABLE_DEV_AUTH === "true"
      ? [
          Credentials({
            name: "Dev Login",
            credentials: {
              email: { label: "Email", type: "email" },
              password: { label: "Password", type: "password" },
            },
            // authorize runs only in node context (not edge),
            // but we leave it empty here — full version in auth.ts
            authorize: async () => null,
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.role = (user as { role?: string }).role ?? "STUDENT";
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
      return session;
    },
  },
  session: { strategy: "jwt" },
} satisfies NextAuthConfig;
