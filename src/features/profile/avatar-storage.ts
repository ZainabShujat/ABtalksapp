import "server-only";
import { del, put } from "@vercel/blob";
import { logger } from "@/lib/logger";

/**
 * Avatar file storage on Vercel Blob.
 *
 * **Public only.** The profile card, sidebar and header render `<img src>`
 * directly, and recruiter / signed-out views need to see the photo too. A
 * private store would need a proxy route; this store is provisioned public.
 *
 * **Project-specific env names.** Same reason as `features/resume/storage.ts`:
 * mixed-case names, read via `process.env[NAME]` so they survive build-time
 * env substitution, token passed explicitly so the SDK does not fall back to
 * `BLOB_READ_WRITE_TOKEN` (the résumé store).
 *
 * Pathname is `avatars/<userId>/<sha256>.<ext>` — content-addressed, built
 * only from server-side values.
 */

/** Provisioned by the team under these exact names. Do not rename. */
const TOKEN_ENV = "avatar_READ_WRITE_TOKEN";
const STORE_ID_ENV = "avatar_STORE_ID";

function blobToken(): string | undefined {
  const value = process.env[TOKEN_ENV];
  return value && value.length > 0 ? value : undefined;
}

function blobStoreId(): string | undefined {
  const value = process.env[STORE_ID_ENV];
  return value && value.length > 0 ? value : undefined;
}

export function isAvatarStorageConfigured(): boolean {
  return Boolean(blobToken());
}

export function avatarPathname(
  userId: string,
  contentHash: string,
  ext: string,
): string {
  return `avatars/${userId}/${contentHash}.${ext}`;
}

export function isOurAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes("/avatars/");
  } catch {
    return url.includes("/avatars/");
  }
}

/**
 * Does the token actually belong to the store we were told to use?
 *
 * A read-write token is `vercel_blob_rw_<STORE SUFFIX>_<secret>`, and the store
 * id is `store_<STORE SUFFIX>`. Returns `null` when there is nothing to check.
 */
export function storeBindingMatches(): boolean | null {
  const token = blobToken();
  const storeId = blobStoreId();
  if (!token || !storeId) return null;

  const fromToken = token.split("_")[3];
  const fromStoreId = storeId.replace(/^store_/, "");
  if (!fromToken || !fromStoreId) return null;
  return fromToken === fromStoreId;
}

function options() {
  return { token: blobToken() };
}

export async function storeAvatarFile({
  userId,
  contentHash,
  ext,
  bytes,
  mimeType,
}: {
  userId: string;
  contentHash: string;
  ext: string;
  bytes: Uint8Array;
  mimeType: string;
}): Promise<string | null> {
  if (!isAvatarStorageConfigured()) {
    logger.warn(`[avatar] ${TOKEN_ENV} is not set — file not stored`);
    return null;
  }

  if (storeBindingMatches() === false) {
    logger.warn(
      `[avatar] ${TOKEN_ENV} does not belong to the store named by ${STORE_ID_ENV} — ` +
        "avatars would be written to the wrong store",
    );
  }

  const pathname = avatarPathname(userId, contentHash, ext);
  try {
    const result = await put(pathname, Buffer.from(bytes), {
      ...options(),
      access: "public",
      contentType: mimeType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return result.url;
  } catch (error) {
    const message = String(error);
    if (message.includes("public access on a private store")) {
      logger.error(
        "[avatar] the blob store is PRIVATE — avatars cannot be stored. " +
          "The profile card renders <img src> directly, so the store must be " +
          `created with PUBLIC access and ${TOKEN_ENV} pointed at it. ` +
          "Do not widen the résumé store — résumés stay private.",
      );
      return null;
    }
    logger.error("[avatar] blob upload failed", { error: message });
    return null;
  }
}

export async function deleteAvatarBlob(url: string): Promise<void> {
  if (!isAvatarStorageConfigured()) return;
  try {
    await del(url, options());
  } catch (error) {
    logger.warn("[avatar] blob delete failed", { error: String(error) });
  }
}
