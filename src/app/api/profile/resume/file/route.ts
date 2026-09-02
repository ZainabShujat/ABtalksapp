/**
 * The candidate's own résumé file.
 *
 * A Route Handler rather than a Server Action because the response is a binary
 * stream, which a Server Action cannot return.
 *
 * The only input is the session. There is no id, no path and no query parameter
 * that could name a different candidate's file — `getOwnResumeFilePath` reads
 * the blob pathname out of the signed-in user's own row — so this endpoint has
 * no IDOR surface to get wrong. It is deliberately NOT admin-gated: it is the
 * owner's private file, and admins reach résumés through the admin surfaces.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOwnResumeFilePath } from "@/features/resume/service";
import { readResumeFile } from "@/features/resume/storage";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false as const, message: "Not authenticated" },
      { status: 401 },
    );
  }

  const own = await getOwnResumeFilePath(session.user.id);
  if (!own) {
    return NextResponse.json(
      { ok: false as const, message: "No résumé file stored" },
      { status: 404 },
    );
  }

  const file = await readResumeFile(own.pathname);
  if (!file) {
    return NextResponse.json(
      { ok: false as const, message: "No résumé file stored" },
      { status: 404 },
    );
  }

  // Quoting and stripping keeps a filename with a comma or a quote in it from
  // splitting the header. The name is already restricted upstream.
  const safeName = own.fileName.replace(/["\\\r\n]/g, "");

  return new NextResponse(file.stream, {
    headers: {
      "content-type": file.contentType || "application/pdf",
      "content-length": String(file.size),
      "content-disposition": `inline; filename="${safeName}"`,
      // Private to one session; never a shared cache, never a CDN copy.
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
