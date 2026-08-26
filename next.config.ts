import type { NextConfig } from "next";
import os from "node:os";

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
  images: {
    remotePatterns: [
      // Pre-play stills for past-workshop replays, derived from each event's
      // youtubeId. i.ytimg.com is Google's cookieless static asset host — it
      // sets no cookies, unlike the youtube.com player iframe, which stays
      // click-to-load behind the consent gate.
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" },
    ],
  },
  // Next 16 blocks /_next/* from non-localhost origins unless listed here.
  // Without this, LAN/phone pages never hydrate → login form does a dead GET.
  allowedDevOrigins: localNetworkHosts(),
  // The talent pool browser was removed — /hire is the recruiter surface now.
  // Kept as a redirect rather than a 404 because the old path is in bookmarks,
  // in the footer of older emails, and was the recruiter's door for months.
  async redirects() {
    return [{ source: "/talent", destination: "/hire", permanent: true }];
  },
};

export default nextConfig;
