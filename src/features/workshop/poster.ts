/**
 * Workshop poster validation. Plan 163 phase 3b.
 *
 * **Decided by the bytes, not by the filename or the browser's
 * `Content-Type`.** Both of those are supplied by the caller and neither is
 * evidence: renaming `payload.html` to `poster.png` changes the extension and
 * the type the browser reports, and changes nothing about the file. The magic
 * numbers are what the file actually is.
 *
 * Order matters — size first, so an enormous upload is refused without being
 * inspected. `features/resume/ingest.ts` validates PDFs the same way.
 *
 * Pure: no server imports, so the size limit can be shared with the form.
 */

export const MAX_POSTER_BYTES = 4 * 1024 * 1024;
export const MAX_POSTER_MB = Math.floor(MAX_POSTER_BYTES / (1024 * 1024));

export const ACCEPTED_POSTER_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type PosterMimeType = (typeof ACCEPTED_POSTER_MIME_TYPES)[number];

const startsWith = (bytes: Uint8Array, magic: number[], offset = 0) =>
  bytes.length >= offset + magic.length &&
  magic.every((b, i) => bytes[offset + i] === b);

/** The format the bytes actually are, or null. */
export function sniffImageType(bytes: Uint8Array): PosterMimeType | null {
  // PNG: \x89 P N G \r \n \x1A \n
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // WebP: "RIFF" .... "WEBP" — the size field sits between them, so the
  // second marker is checked at its fixed offset rather than sequentially.
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

export type PosterValidation =
  | { ok: true; mimeType: PosterMimeType }
  | { ok: false; message: string };

export function validatePosterBytes(bytes: Uint8Array): PosterValidation {
  if (bytes.length === 0) {
    return { ok: false, message: "That file is empty. Choose another." };
  }
  if (bytes.length > MAX_POSTER_BYTES) {
    return {
      ok: false,
      message: `That image is too large. Use a PNG, JPEG or WebP under ${MAX_POSTER_MB} MB.`,
    };
  }

  const mimeType = sniffImageType(bytes);
  if (!mimeType) {
    return {
      ok: false,
      message: "That is not a PNG, JPEG or WebP image.",
    };
  }
  return { ok: true, mimeType };
}
