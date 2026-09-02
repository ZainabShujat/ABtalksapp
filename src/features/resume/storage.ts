import "server-only";
import { del, get, put } from "@vercel/blob";
import { logger } from "@/lib/logger";

/**
 * Résumé file storage on Vercel Blob.
 *
 * **Private only.** Every write is `access: "private"` and every read is
 * `access: "private"`; there is no public code path, no public URL is ever
 * constructed, and the database stores a pathname rather than a URL. A résumé
 * carries a phone number, an email and a home city, so the object itself must
 * be unreadable without credentials — the ONLY way to retrieve one is
 * `GET /api/profile/resume/file`, which is session-gated and takes no
 * parameters.
 *
 * **Project-specific env names.** The store is provisioned under
 * `resume2_STORE_ID` / `resume2_READ_WRITE_TOKEN`, not the SDK's default
 * `BLOB_*` names, so the token is passed EXPLICITLY on every call. Without
 * that the SDK falls back to `process.env.BLOB_READ_WRITE_TOKEN`, finds
 * nothing, and every operation fails with "No blob credentials found".
 *
 * Read through `process.env[NAME]` rather than a dotted literal: the names are
 * mixed-case, and bracket access keeps them out of reach of any build-time
 * `process.env.X` substitution and in exactly one place.
 *
 * The pathname is `resumes/<userId>/<sha256>.pdf` — content-addressed, so
 * re-uploading the same document overwrites in place instead of accumulating
 * copies, and derived entirely from server-side values so no user input can
 * steer the path.
 */

/** Provisioned by the team under these exact names. Do not rename. */
const TOKEN_ENV = "resume2_READ_WRITE_TOKEN";
const STORE_ID_ENV = "resume2_STORE_ID";

function blobToken(): string | undefined {
  const value = process.env[TOKEN_ENV];
  return value && value.length > 0 ? value : undefined;
}

function blobStoreId(): string | undefined {
  const value = process.env[STORE_ID_ENV];
  return value && value.length > 0 ? value : undefined;
}

export function isStorageConfigured(): boolean {
  return Boolean(blobToken());
}

export function resumePathname(userId: string, contentHash: string): string {
  return `resumes/${userId}/${contentHash}.pdf`;
}

/**
 * Does the token actually belong to the store we were told to use?
 *
 * A read-write token is `vercel_blob_rw_<STORE SUFFIX>_<secret>`, and the store
 * id is `store_<STORE SUFFIX>`. Comparing the two catches the mistake that is
 * otherwise invisible: a token for a DIFFERENT store authenticates perfectly
 * and quietly writes résumés somewhere nobody is looking.
 *
 * Returns `null` when there is nothing to check (either value missing).
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

/** Shared by every call. `storeId` is only meaningful for OIDC auth, which we do not use. */
function options() {
  return { token: blobToken() };
}

export async function storeResumeFile({
  userId,
  contentHash,
  bytes,
  mimeType,
}: {
  userId: string;
  contentHash: string;
  bytes: Uint8Array;
  mimeType: string;
}): Promise<string | null> {
  if (!isStorageConfigured()) {
    // Not fatal: parsing, scoring and the profile merge still work, the
    // candidate simply cannot download the original back from us. Better than
    // failing an upload that otherwise succeeded.
    logger.warn(`[resume] ${TOKEN_ENV} is not set — file not stored`);
    return null;
  }

  if (storeBindingMatches() === false) {
    logger.warn(
      `[resume] ${TOKEN_ENV} does not belong to the store named by ${STORE_ID_ENV} — ` +
        "résumé files would be written to the wrong store",
    );
  }

  const pathname = resumePathname(userId, contentHash);
  try {
    await put(pathname, Buffer.from(bytes), {
      ...options(),
      access: "private",
      contentType: mimeType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return pathname;
  } catch (error) {
    const message = String(error);
    // A public store silently means "no résumé file is ever retained", while
    // `isStorageConfigured()` still reports true — the one failure mode an
    // operator would not think to look for. Name the fix in the log rather
    // than leaving them to decode the SDK's wording.
    if (message.includes("private access on a public store")) {
      logger.error(
        "[resume] the blob store is PUBLIC — résumé files cannot be stored. " +
          "Résumés carry a phone number, an email and a home city, so they are " +
          "written with access:'private' and a public store rejects that. " +
          `Provision the store with PRIVATE access and set ${TOKEN_ENV}. ` +
          "Parsing and scoring are unaffected.",
      );
      return null;
    }
    logger.error("[resume] blob upload failed", { error: message });
    return null;
  }
}

export async function deleteResumeFile(pathname: string): Promise<void> {
  if (!isStorageConfigured()) return;
  try {
    await del(pathname, options());
  } catch (error) {
    // A stale blob is harmless; a delete that throws would block the candidate
    // from removing their résumé row, which is not.
    logger.warn("[resume] blob delete failed", { error: String(error) });
  }
}

export async function readResumeFile(pathname: string): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
} | null> {
  if (!isStorageConfigured()) return null;
  try {
    const result = await get(pathname, { ...options(), access: "private" });
    if (!result || result.statusCode !== 200) return null;
    return {
      stream: result.stream,
      contentType: result.blob.contentType,
      size: result.blob.size,
    };
  } catch (error) {
    logger.warn("[resume] blob read failed", { error: String(error) });
    return null;
  }
}
