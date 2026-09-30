import "server-only";
import { createHash } from "node:crypto";
import { del, put } from "@vercel/blob";
import { logger } from "@/lib/logger";
import {
  LOGO_MAX_BYTES,
  isAllowedLogoMimeType,
} from "@/lib/validations/recruiter-profile";

/**
 * Company logo storage on Vercel Blob (plan 158).
 *
 * **Public only.** The settings card renders `<img src>` directly, and every
 * surface a logo is eventually wanted on — outreach, job posts — is a place a
 * signed-out or third-party reader loads the image from. A private store would
 * need a proxy route for a file that carries no private data.
 *
 * **It reuses the avatar store.** `logo_READ_WRITE_TOKEN` is checked first so
 * the two can be split later without touching a caller, but the fallback is the
 * already-provisioned PUBLIC avatar store. That is deliberate: a dedicated
 * store would mean the feature silently does nothing in production until
 * somebody remembers to create it. The résumé store is PRIVATE and must never
 * be used here — résumés stay private.
 *
 * **Project-specific env names.** Same reason as `features/resume/storage.ts`
 * and `features/profile/avatar-storage.ts`: mixed-case names, read via
 * `process.env[NAME]` so they survive build-time env substitution, token passed
 * explicitly so the SDK does not fall back to `BLOB_READ_WRITE_TOKEN`.
 *
 * Pathname is `org-logos/<organizationId>/<sha256>.<ext>` — content-addressed
 * and built only from server-resolved values, so no caller can steer it at
 * another organization's prefix.
 */

// ---------------------------------------------------------------------------
// Accepting an uploaded file
// ---------------------------------------------------------------------------

/**
 * Declared content type is attacker input. This reads the actual leading bytes,
 * and `readLogoUpload` below requires the two to agree, so a `.svg` renamed to
 * `.png` is refused before it can reach a public store.
 */
function sniffImageType(
  bytes: Uint8Array,
): { mime: string; ext: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { mime: "image/png", ext: "png" };
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

const LOGO_TYPE_MESSAGE = "Please choose a PNG, JPEG, or WebP image.";

export type LogoUploadResult =
  | {
      ok: true;
      bytes: Uint8Array;
      ext: string;
      mime: string;
      /** sha256, which is what makes the stored path content-addressed. */
      contentHash: string;
    }
  | { ok: false; message: string };

/**
 * Validate one uploaded logo file (plan 159).
 *
 * This is the single copy of the check. It lived inline in
 * `uploadCompanyLogoAction` when plan 158 added the recruiter's own control;
 * the admin create form (plan 159) needs exactly the same rules, and a security
 * control duplicated across two call sites is a control that drifts.
 *
 * Order matters and is deliberate: refuse SVG by name before consulting the
 * allow-list, and require the sniffed type to equal the declared one.
 */
export async function readLogoUpload(file: unknown): Promise<LogoUploadResult> {
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose an image to upload." };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return {
      ok: false,
      message: "That file is too large. Please choose an image under 2 MB.",
    };
  }
  if (file.type === "image/svg+xml" || !isAllowedLogoMimeType(file.type)) {
    return { ok: false, message: LOGO_TYPE_MESSAGE };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    logger.error("[org-logo] failed to read upload", { error: String(error) });
    return { ok: false, message: "Could not read that file. Please try again." };
  }

  const sniffed = sniffImageType(bytes);
  if (!sniffed || sniffed.mime !== file.type) {
    return { ok: false, message: LOGO_TYPE_MESSAGE };
  }

  return {
    ok: true,
    bytes,
    ext: sniffed.ext,
    mime: sniffed.mime,
    contentHash: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Preferred first, then the existing public avatar store. Do not rename. */
const TOKEN_ENVS = ["logo_READ_WRITE_TOKEN", "avatar_READ_WRITE_TOKEN"] as const;

function blobToken(): string | undefined {
  for (const name of TOKEN_ENVS) {
    const value = process.env[name];
    if (value && value.length > 0) return value;
  }
  return undefined;
}

export function isCompanyLogoStorageConfigured(): boolean {
  return Boolean(blobToken());
}

export function companyLogoPathname(
  organizationId: string,
  contentHash: string,
  ext: string,
): string {
  return `org-logos/${organizationId}/${contentHash}.${ext}`;
}

export function isOurCompanyLogoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes("/org-logos/");
  } catch {
    return url.includes("/org-logos/");
  }
}

function options() {
  return { token: blobToken() };
}

export async function storeCompanyLogoFile({
  organizationId,
  contentHash,
  ext,
  bytes,
  mimeType,
}: {
  organizationId: string;
  contentHash: string;
  ext: string;
  bytes: Uint8Array;
  mimeType: string;
}): Promise<string | null> {
  if (!isCompanyLogoStorageConfigured()) {
    logger.warn(
      `[org-logo] none of ${TOKEN_ENVS.join(" / ")} is set — file not stored`,
    );
    return null;
  }

  const pathname = companyLogoPathname(organizationId, contentHash, ext);
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
        "[org-logo] the blob store is PRIVATE — company logos cannot be stored. " +
          "Settings renders <img src> directly, so the store must have PUBLIC " +
          `access and one of ${TOKEN_ENVS.join(" / ")} must point at it. ` +
          "Do not widen the résumé store — résumés stay private.",
      );
      return null;
    }
    logger.error("[org-logo] blob upload failed", { error: message });
    return null;
  }
}

export async function deleteCompanyLogoBlob(url: string): Promise<void> {
  if (!isCompanyLogoStorageConfigured()) return;
  try {
    await del(url, options());
  } catch (error) {
    logger.warn("[org-logo] blob delete failed", { error: String(error) });
  }
}
