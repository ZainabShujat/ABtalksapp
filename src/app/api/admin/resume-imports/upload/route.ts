import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getAdminContext } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";
import { IMPORT_STAGING_PREFIX, resumeBlobToken } from "@/features/resume/storage";
import { MAX_RESUME_BYTES } from "@/features/resume/types";

/**
 * Client-upload token route for the admin résumé import (plan 154).
 *
 * A route handler rather than a server action only because the Vercel Blob
 * client protocol requires one. It issues short-lived tokens that let an ADMIN's
 * browser put a PDF straight into the private store under the staging prefix —
 * which is what lets 1,000+ files through without each one passing the 4.5 MB
 * function body limit. It writes no rows: the server looks at every staged file
 * itself (`registerUploadsAction`) before anything is recorded.
 *
 * No `onUploadCompleted`: that webhook needs a public callback URL and would
 * arrive without a session. Registration is an explicit admin action instead.
 */

export const runtime = "nodejs";

const STAGING_PATH = new RegExp(
  `^${IMPORT_STAGING_PREFIX.replace(/\//g, "\\/")}[A-Za-z0-9._-]{1,140}\\.pdf$`,
);

export async function POST(request: Request): Promise<NextResponse> {
  const token = resumeBlobToken();
  if (!token) {
    return NextResponse.json({ ok: false, message: "File storage is not configured." }, { status: 503 });
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ ok: false, message: "Bad request." }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      token,
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const admin = await getAdminContext();
        if (!admin) throw new Error("NOT_AUTHORISED");
        if (!STAGING_PATH.test(pathname)) throw new Error("BAD_PATH");
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_RESUME_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ adminUserId: admin.userId }),
        };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "NOT_AUTHORISED") {
      return NextResponse.json({ ok: false, message: "Not authorised." }, { status: 403 });
    }
    if (message === "BAD_PATH") {
      return NextResponse.json({ ok: false, message: "Only PDF files can be uploaded." }, { status: 400 });
    }
    logger.error("[resume-import] upload token failed", { error: message });
    return NextResponse.json({ ok: false, message: "Upload could not be started." }, { status: 400 });
  }
}
