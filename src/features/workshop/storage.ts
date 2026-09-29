import "server-only";
import { createHash } from "node:crypto";
import { del, put } from "@vercel/blob";
import { logger } from "@/lib/logger";

/**
 * Workshop poster storage on Vercel Blob. Plan 163 phase 3b.
 *
 * **Public, and a different store from résumés.** `features/resume/storage.ts`
 * is `access: "private"` because a résumé carries a phone number, an email and
 * a home city. A poster is marketing art that a logged-out visitor must be able
 * to see, so it needs public reads — which is why this is its own store and not
 * a relaxation of that one. Never move posters into the résumé store, and never
 * make the résumé store public to share it.
 *
 * **Project-specific env names**, following the résumé store's convention: the
 * token is passed EXPLICITLY on every call, because the SDK's default
 * `BLOB_READ_WRITE_TOKEN` lookup finds nothing here. Read through
 * `process.env[NAME]` rather than a dotted literal so the mixed-case names stay
 * out of reach of build-time `process.env.X` substitution, in one place.
 *
 * The pathname is `workshops/<eventId>/<sha256>.<ext>` — content-addressed and
 * built entirely from server-side values, so nothing a caller sends can steer
 * where an object lands.
 */

/** Provisioned under these exact names. Do not rename. */
const TOKEN_ENV = "workshop_READ_WRITE_TOKEN";
const STORE_ID_ENV = "workshop_STORE_ID";

function blobToken(): string | undefined {
  const value = process.env[TOKEN_ENV];
  return value && value.length > 0 ? value : undefined;
}

/**
 * Whether posters can be stored at all.
 *
 * Checked before an upload so an unconfigured environment answers "poster
 * storage is not configured" instead of throwing — the admin gets a message
 * they can act on, and the workshop itself still saves.
 */
export function isPosterStorageConfigured(): boolean {
  return Boolean(blobToken());
}

function options() {
  return { token: blobToken() };
}

const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function posterPathname(
  eventId: string,
  bytes: Uint8Array,
  mimeType: string,
): string {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const ext = EXTENSION[mimeType] ?? "img";
  return `workshops/${eventId}/${hash}.${ext}`;
}

/**
 * Store a poster and return its public URL, or null when storage is not
 * configured. Never throws for a configuration problem — the caller turns null
 * into a message.
 */
export async function storePosterFile(input: {
  eventId: string;
  bytes: Uint8Array;
  mimeType: string;
}): Promise<string | null> {
  if (!isPosterStorageConfigured()) {
    logger.warn(`[workshop] ${TOKEN_ENV} is not set — poster not stored`, {
      storeIdEnv: STORE_ID_ENV,
    });
    return null;
  }

  const pathname = posterPathname(input.eventId, input.bytes, input.mimeType);
  try {
    const result = await put(pathname, Buffer.from(input.bytes), {
      ...options(),
      access: "public",
      contentType: input.mimeType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return result.url;
  } catch (error) {
    logger.error("[workshop] poster upload failed", {
      eventId: input.eventId,
      error: String(error),
    });
    return null;
  }
}

/**
 * Delete a stored poster.
 *
 * Best-effort on purpose: it is only ever called after the database no longer
 * points at the object, so a failure leaves an orphaned blob rather than a
 * workshop pointing at nothing. Logged, never thrown.
 */
export async function deletePosterFile(url: string): Promise<void> {
  if (!isPosterStorageConfigured()) return;
  try {
    await del(url, options());
  } catch (error) {
    logger.warn("[workshop] poster delete failed; blob orphaned", {
      url,
      error: String(error),
    });
  }
}
