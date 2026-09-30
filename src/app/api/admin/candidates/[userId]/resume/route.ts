/**
 * One candidate's stored résumé file, for a Platform Admin.
 *
 * A Route Handler rather than a Server Action because the response is a binary
 * stream, which a Server Action cannot return.
 *
 * **Why this one takes a userId when the owner route refuses to.**
 * `/api/profile/resume/file` reads the blob pathname out of the signed-in
 * user's own row and accepts no parameter at all, so it has no IDOR surface.
 * This route deliberately names a candidate — that is the whole point of it —
 * so the parameter is a User id and nothing else: the blob pathname is resolved
 * server-side from that row. A caller never supplies, and never sees, a path
 * into the private store.
 *
 * Every served download writes one `AdminAction`. Résumés carry a phone number,
 * an email and a home city; reading one is an act worth a row.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/features/admin/audit";
import { getOwnResumeFilePath } from "@/features/resume/service";
import { readResumeFile } from "@/features/resume/storage";

export const runtime = "nodejs";

const paramsSchema = z.object({ userId: z.string().min(1).max(64) });

const NOT_FOUND = { ok: false as const, message: "No résumé file stored" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  // `getAdminContext` rather than `requireAdmin`: the latter redirects, which
  // would answer a failed download with an HTML page instead of a status.
  const admin = await getAdminContext();
  if (!admin) {
    return NextResponse.json(
      { ok: false as const, message: "Not authorised." },
      { status: 403 },
    );
  }

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false as const, message: "Bad request." },
      { status: 400 },
    );
  }
  const { userId } = parsed.data;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, deletedAt: true },
  });
  // A soft-deleted candidate's document is not downloadable. `CandidateResume`
  // survives `features/admin/anonymize-user.ts`, so this check is what stops
  // that retention gap from becoming a download.
  if (!target || target.deletedAt !== null) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  const stored = await getOwnResumeFilePath(userId);
  if (!stored) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  const file = await readResumeFile(stored.pathname);
  if (!file) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  // Audited before the bytes leave, so a download that is served is always
  // recorded — but a limiter-style failure here must not deny an admin a
  // document they are authorised to read.
  try {
    await writeAudit(prisma, {
      actorUserId: admin.userId,
      adminUserId: admin.userId,
      targetUserId: userId,
      entityType: "CandidateResume",
      entityId: userId,
      actionType: "DOWNLOAD_CANDIDATE_RESUME",
      reason: "Admin console résumé download",
    });
  } catch (error) {
    logger.error("[admin-resume] audit failed", {
      adminUserId: admin.userId,
      targetUserId: userId,
      error: String(error),
    });
  }

  // Quoting and stripping keeps a filename with a comma or a quote in it from
  // splitting the header. The name is already restricted upstream.
  const safeName = (stored.fileName || "resume.pdf").replace(/["\\\r\n]/g, "");

  return new NextResponse(file.stream, {
    headers: {
      "content-type": file.contentType || "application/pdf",
      "content-length": String(file.size),
      "content-disposition": `attachment; filename="${safeName}"`,
      // Private to one admin session; never a shared cache, never a CDN copy.
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
