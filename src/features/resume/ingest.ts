import "server-only";
import { lookup } from "node:dns/promises";
import { logger } from "@/lib/logger";

/**
 * Résumé ingestion: turning "whatever the candidate gave us" into validated
 * PDF bytes, from either an upload or a link.
 *
 * Two hard rules live here.
 *
 * 1. **The browser is never trusted.** `file.type` is attacker-controlled, so
 *    acceptance is decided by the `%PDF-` magic bytes and the byte length we
 *    measured ourselves.
 * 2. **No arbitrary URL fetching.** Every hop of a link fetch is checked against
 *    `assertPublicHttpUrl` — scheme, host shape, and the resolved IP — so a
 *    résumé link can never be used to reach the Vercel metadata endpoint, a
 *    Neon host, or anything else on a private network. This is a document
 *    fetcher, not a web scraper: it accepts a PDF response and nothing else.
 */

// Declared in `types.ts` because the client file input needs them too, and
// this module is server-only.
import { MAX_RESUME_BYTES } from "@/features/resume/types";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export type IngestResult =
  | {
      ok: true;
      data: { bytes: Uint8Array; mimeType: string; fileName: string | null };
    }
  | { ok: false; message: string };

/** The one message every unreachable-link failure collapses to. */
const LINK_FAILURE =
  "We couldn't retrieve a résumé from this link. Please make sure the document is accessible, or upload the PDF directly.";

/* ─── File validation ────────────────────────────────────────────────────── */

export function hasPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Validate an uploaded file. Order matters: size before content, so a huge
 * upload is rejected without inspecting it.
 */
export function validateResumeBytes(
  bytes: Uint8Array,
  fileName: string | null,
): { ok: true } | { ok: false; message: string } {
  if (bytes.length === 0) {
    return { ok: false, message: "That file is empty. Please choose another." };
  }
  if (bytes.length > MAX_RESUME_BYTES) {
    return {
      ok: false,
      message: `That file is too large. Please upload a PDF under ${Math.floor(
        MAX_RESUME_BYTES / (1024 * 1024),
      )} MB.`,
    };
  }
  if (!hasPdfMagic(bytes)) {
    return {
      ok: false,
      message: fileName?.toLowerCase().endsWith(".pdf")
        ? "That PDF looks damaged and could not be read. Try exporting it again."
        : "Only PDF résumés are supported right now. Please upload a PDF.",
    };
  }
  return { ok: true };
}

/* ─── URL safety ─────────────────────────────────────────────────────────── */

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable is not provably public
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique-local
  if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb"))
    return true; // link-local
  // IPv4-mapped (::ffff:169.254.169.254) must be judged as the IPv4 it wraps.
  const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  return false;
}

/**
 * Rejects anything that is not a public http(s) endpoint. Called on the initial
 * URL AND on every redirect target, because a public host is free to redirect
 * to `169.254.169.254`.
 */
export async function assertPublicHttpUrl(
  raw: string,
): Promise<{ ok: true; url: URL } | { ok: false; message: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: LINK_FAILURE };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, message: LINK_FAILURE };
  }
  if (url.username || url.password) {
    return { ok: false, message: LINK_FAILURE };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".cluster.local")
  ) {
    return { ok: false, message: LINK_FAILURE };
  }

  // Literal addresses skip DNS but still get range-checked.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return isPrivateIPv4(host) ? { ok: false, message: LINK_FAILURE } : { ok: true, url };
  }
  if (host.includes(":")) {
    return isPrivateIPv6(host) ? { ok: false, message: LINK_FAILURE } : { ok: true, url };
  }

  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0) return { ok: false, message: LINK_FAILURE };
    for (const a of addresses) {
      const bad = a.family === 6 ? isPrivateIPv6(a.address) : isPrivateIPv4(a.address);
      if (bad) return { ok: false, message: LINK_FAILURE };
    }
  } catch {
    return { ok: false, message: LINK_FAILURE };
  }

  return { ok: true, url };
}

/* ─── Known sources ──────────────────────────────────────────────────────── */

/**
 * Google Drive share links are the single most common thing in this field
 * today, and they are HTML pages, not documents. The two canonical share
 * shapes carry the file id, and Drive exposes a direct-download endpoint for
 * it — so this is a documented format conversion for one known host, NOT a
 * general scraper. Permissions are still Drive's to enforce: a private file
 * returns its sign-in page, which fails the PDF check below like any other
 * non-document response.
 */
export function toDirectDocumentUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  const host = url.hostname.toLowerCase();
  if (host !== "drive.google.com" && host !== "docs.google.com") return raw;

  const fromPath = url.pathname.match(/\/(?:file|document)\/d\/([A-Za-z0-9_-]{10,})/);
  const id = fromPath?.[1] ?? url.searchParams.get("id");
  if (!id) return raw;

  // Google Docs (not an uploaded file) can only be had as an export.
  if (url.pathname.startsWith("/document/")) {
    return `https://docs.google.com/document/d/${id}/export?format=pdf`;
  }
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
}

/* ─── Fetch ──────────────────────────────────────────────────────────────── */

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 20_000;

/** Reads at most `MAX_RESUME_BYTES + 1` so an oversized body is cut, not buffered. */
async function readCapped(body: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > MAX_RESUME_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function fileNameFrom(url: URL, disposition: string | null): string | null {
  const fromHeader = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
  const candidate = fromHeader ?? url.pathname.split("/").pop() ?? "";
  const decoded = (() => {
    try {
      return decodeURIComponent(candidate);
    } catch {
      return candidate;
    }
  })();
  // Path segments only — never a caller-supplied path.
  const safe = decoded.replace(/[^A-Za-z0-9._ -]/g, "").trim();
  return safe.length > 0 && safe.length <= 120 ? safe : null;
}

/**
 * Fetch a résumé document from a candidate-supplied link.
 *
 * Every failure — bad scheme, private address, 404, sign-in page, HTML, a PDF
 * that is too big — returns the same user-facing message. The specific reason
 * goes to the logger only: telling the caller *which* check failed is how a URL
 * fetcher becomes a network scanner.
 */
export async function fetchResumeFromUrl(rawUrl: string): Promise<IngestResult> {
  let target = toDirectDocumentUrl(rawUrl.trim());

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = await assertPublicHttpUrl(target);
    if (!checked.ok) {
      logger.warn("[resume] link rejected before fetch", { hop });
      return { ok: false, message: LINK_FAILURE };
    }

    let res: Response;
    try {
      res = await fetch(checked.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "application/pdf,*/*" },
      });
    } catch (error) {
      logger.warn("[resume] link fetch threw", { error: String(error) });
      return { ok: false, message: LINK_FAILURE };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { ok: false, message: LINK_FAILURE };
      // Resolved against the current hop, then re-validated at the top of the loop.
      target = new URL(location, checked.url).toString();
      continue;
    }

    if (!res.ok || !res.body) {
      logger.warn("[resume] link fetch not ok", { status: res.status });
      return { ok: false, message: LINK_FAILURE };
    }

    const bytes = await readCapped(res.body);
    if (bytes === null) {
      return {
        ok: false,
        message: `That document is larger than ${Math.floor(
          MAX_RESUME_BYTES / (1024 * 1024),
        )} MB. Please upload a smaller PDF.`,
      };
    }

    if (!hasPdfMagic(bytes)) {
      // Overwhelmingly this is Drive's sign-in or preview page — i.e. the file
      // is private. Same message either way; we cannot tell them apart and
      // guessing would mislead.
      logger.warn("[resume] link did not resolve to a PDF", {
        contentType: res.headers.get("content-type"),
      });
      return { ok: false, message: LINK_FAILURE };
    }

    return {
      ok: true,
      data: {
        bytes,
        mimeType: "application/pdf",
        fileName: fileNameFrom(checked.url, res.headers.get("content-disposition")),
      },
    };
  }

  logger.warn("[resume] link exceeded redirect budget");
  return { ok: false, message: LINK_FAILURE };
}
