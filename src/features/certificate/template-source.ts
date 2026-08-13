import "server-only";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { CertificateType } from "@prisma/client";
import { logger } from "@/lib/logger";
import { CERTIFICATE_TEMPLATES } from "./constants";

const cache = new Map<string, { bytes: Uint8Array; mtimeMs: number | null }>();

/**
 * Per-type template. Env overrides are scoped per type so Claude's
 * CERTIFICATE_TEMPLATE_PATH cannot leak onto hackathon certificates.
 * Disk reads are mtime-checked; remote fetches use no-store.
 */
export async function loadCertificateTemplate(
  type: CertificateType,
): Promise<Uint8Array> {
  const config = CERTIFICATE_TEMPLATES[type];
  if (!config) {
    logger.error("Certificate template not configured", { type });
    throw new Error("Certificate template not configured");
  }

  const url = process.env[config.urlEnv];
  if (url) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Certificate template fetch failed: ${res.status}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      cache.set(url, { bytes, mtimeMs: null });
      return bytes;
    } catch (error) {
      logger.error("Certificate template not configured", {
        url,
        error: String(error),
      });
      throw new Error("Certificate template not configured");
    }
  }

  const absolutePath = path.resolve(
    process.cwd(),
    process.env[config.pathEnv] ?? config.defaultPath,
  );

  try {
    const { mtimeMs } = await stat(absolutePath);
    const hit = cache.get(absolutePath);
    if (hit && hit.mtimeMs === mtimeMs) {
      return hit.bytes;
    }
    const bytes = new Uint8Array(await readFile(absolutePath));
    cache.set(absolutePath, { bytes, mtimeMs });
    return bytes;
  } catch (error) {
    logger.error("Certificate template not configured", {
      path: absolutePath,
      error: String(error),
    });
    throw new Error("Certificate template not configured");
  }
}
