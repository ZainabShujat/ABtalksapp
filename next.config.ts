import type { NextConfig } from "next";
import os from "node:os";
import { withSentryConfig } from "@sentry/nextjs";

/** Hostnames browsers use when opening the Next.js Network URL (LAN testing). */
function localNetworkHosts(): string[] {
  const hosts = new Set<string>(["127.0.0.1", "0.0.0.0"]);
  try {
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.internal || entry.family !== "IPv4") continue;
        hosts.add(entry.address);
      }
    }
  } catch {
    // os.networkInterfaces can fail in restricted environments — env fallback below.
  }
  const fromEnv = process.env.ALLOWED_DEV_ORIGINS?.split(",") ?? [];
  for (const raw of fromEnv) {
    const host = raw.trim();
    if (host) hosts.add(host);
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  // React Compiler runs a Babel pass over all 169 client components, which costs
  // ~2 min per route on cold dev compiles. Production builds compile once ahead
  // of time, so keep it on there and skip it in dev.
  reactCompiler: process.env.NODE_ENV === "production",
  // Parent ~/package-lock.json confuses Turbopack into using the wrong workspace
  // root, which breaks env loading (AUTH_SECRET) and can hang compiles.
  turbopack: {
    root: process.cwd(),
  },
  // Résumé uploads go through a Server Action, and the default body cap is
  // 1 MB — well under a normal PDF. This leaves headroom above the 4 MB the
  // résumé ingest enforces; Vercel's own 4.5 MB request limit is the real
  // ceiling in production, which is why ingest caps below it rather than here.
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
  images: {
    remotePatterns: [
      // Pre-play stills for past-workshop replays, derived from each event's
      // youtubeId. i.ytimg.com is Google's cookieless static asset host — it
      // sets no cookies, unlike the youtube.com player iframe, which stays
      // click-to-load behind the consent gate.
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" },
      // Workshop posters (plan 163 phase 3b). The public Blob store serves
      // them from `<storeId>.public.blob.vercel-storage.com`, and the store id
      // differs per environment, so the subdomain is a wildcard rather than
      // one host that would work in dev and 500 in production.
      //
      // Scoped to `/workshops/**`: this pattern must not become a general
      // allow-list for every Blob store the project has. Résumés live in a
      // PRIVATE store and are never served through next/image at all.
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
        pathname: "/workshops/**",
      },
    ],
  },
  // Next 16 blocks /_next/* from non-localhost origins unless listed here.
  // Without this, LAN/phone pages never hydrate → login form does a dead GET.
  allowedDevOrigins: localNetworkHosts(),
  // The talent pool browser was removed — /hire is the recruiter surface now.
  // Kept as a redirect rather than a 404 because the old path is in bookmarks,
  // in the footer of older emails, and was the recruiter's door for months.
  async redirects() {
    return [
      { source: "/talent", destination: "/hire", permanent: true },
      // Temporary: /program is a parent namespace with no index yet.
      { source: "/program", destination: "/dashboard", permanent: false },
      // Legacy AI Cohort URLs (bookmarks, login ?from=, emails). Explicit
      // sources only — a /program/:path* catch-all would steal public/program/*.png.
      { source: "/program/apply", destination: "/program/ai-cohort/apply", permanent: true },
      { source: "/program/assessment", destination: "/program/ai-cohort/assessment", permanent: true },
      { source: "/program/dashboard", destination: "/program/ai-cohort/dashboard", permanent: true },
      { source: "/program/day/:day", destination: "/program/ai-cohort/day/:day", permanent: true },
      { source: "/program/curriculum", destination: "/program/ai-cohort/curriculum", permanent: true },
      { source: "/program/videos", destination: "/program/ai-cohort/videos", permanent: true },
      { source: "/program/leaderboard", destination: "/program/ai-cohort/leaderboard", permanent: true },
      {
        source: "/program/cohort-interview/:blueprint",
        destination: "/program/ai-cohort/cohort-interview/:blueprint",
        permanent: true,
      },
      {
        source: "/program/cohort-interview/:blueprint/report",
        destination: "/program/ai-cohort/cohort-interview/:blueprint/report",
        permanent: true,
      },
      // /ai-workshop was renamed to /workshop. The old path is in confirmation
      // emails already sent, WhatsApp shares and bookmarks, so it has to keep
      // resolving rather than 404.
      { source: "/ai-workshop", destination: "/workshop", permanent: true },
      {
        source: "/ai-workshop/:path*",
        destination: "/workshop/:path*",
        permanent: true,
      },
    ];
  },
};

/**
 * T-259. The Sentry build plugin does one thing that matters: it uploads source
 * maps, so a production stack trace reads as `contact-access.ts:41` instead of
 * `main-8f3a.js:1:24817`. Without that, an error tracker tells you an error
 * happened and not where.
 *
 * It is inert without `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT`,
 * which is the state of every local build and every environment until those are
 * set in Vercel — the build succeeds either way, it just uploads nothing.
 *
 * `deleteSourcemapsAfterUpload` matters: the maps are uploaded to Sentry, then
 * removed from the deployed output. Leaving them served publicly would publish
 * the application's source, which is a bigger disclosure than anything else
 * T-259 guards against.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Quiet unless something actually goes wrong, and never in CI logs.
  silent: true,
  telemetry: false,
  // Strips Sentry's own debug logging from the client bundle.
  disableLogger: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
