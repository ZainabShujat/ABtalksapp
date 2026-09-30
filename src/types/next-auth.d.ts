import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    /**
     * Plan 154: when this session was opened by a sign-in (seconds). Unlike
     * the JWT `iat`, which Auth.js re-stamps on every refresh, this does not
     * move — so it can answer "did they sign in recently?" and "was this
     * session opened before a revocation?".
     */
    authTime?: number;
    user: {
      id: string;
      role: string;
      isAdmin?: boolean;
    } & DefaultSession["user"];
  }
  interface User {
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    isAdmin?: boolean;
    /** Seconds. Set at sign-in and never refreshed — see Session.authTime. */
    authTime?: number;
    /** authTime was backfilled from `iat` for a token that predates it. */
    authTimeEstimated?: boolean;
  }
}
