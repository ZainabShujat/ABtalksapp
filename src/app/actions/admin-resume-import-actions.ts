"use server";

import { createHash } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ResumeImportStatus } from "@prisma/client";
import { getAdminContext } from "@/lib/admin-auth";
import { writeClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { validateResumeBytes } from "@/features/resume/ingest";
import {
  IMPORT_STAGING_PREFIX,
  deleteResumeFile,
  promoteImportFile,
  readResumeBytes,
} from "@/features/resume/storage";
import { MAX_RESUME_BYTES } from "@/features/resume/types";
import { normalizeEmail } from "@/features/resume/import/email";
import { drainAndContinue } from "@/features/resume/import/worker";
import {
  CONSENT_ATTESTATION,
  loadImportStatus,
  type ImportStatusView,
} from "@/features/resume/import/status";
import {
  createOrGetImport,
  findImportByHash,
  hasPendingImportWork,
  queueImports,
  requestRegistration,
  resolveImportEmail,
  retryFailedImports,
  type Selection,
} from "@/repositories/resume-import";

/**
 * Admin résumé import (plan 154). Every action checks the platform-admin guard
 * FIRST — the /admin layout protects pages, not actions. The browser only ever
 * uploads files and sends ids; every model call happens in the server-side
 * worker, never from here.
 */

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const NOT_AUTHORISED = { ok: false as const, message: "Not authorised." };
const PAGE = "/admin/resume-imports";

async function audit(adminUserId: string, actionType: string, metadata: Record<string, unknown>) {
  try {
    await writeClient().adminAction.create({
      data: {
        adminUserId,
        actorUserId: adminUserId,
        entityType: "ResumeImport",
        actionType,
        metadata: metadata as object,
      },
      select: { id: true },
    });
  } catch (error) {
    logger.error("[resume-import] audit row not written", { actionType, error: String(error) });
  }
}

/** Continue work after the response, in this invocation; it hands over if it runs long. */
function startDrain() {
  after(async () => {
    try {
      await drainAndContinue();
    } catch (error) {
      logger.error("[resume-import] background drain failed", { error: String(error) });
    }
  });
}

const selectionSchema = z.union([
  z.object({ ids: z.array(z.string().min(1).max(40)).min(1).max(2000) }),
  z.object({ all: z.literal(true) }),
]);

/* ─── 1. Register staged uploads ─────────────────────────────────────────── */

const stagedSchema = z.object({
  files: z
    .array(
      z.object({
        // Only paths under the staging prefix: an admin must not be able to
        // point this at another student's stored résumé and have it moved.
        pathname: z
          .string()
          .max(300)
          .refine(
            (p) => p.startsWith(IMPORT_STAGING_PREFIX) && !p.includes("..") && p.toLowerCase().endsWith(".pdf"),
            "Invalid upload path",
          ),
        name: z.string().max(300),
      }),
    )
    .min(1)
    .max(50),
});

export type RegisterUploadsResult = {
  created: number;
  duplicates: number;
  rejected: { name: string; reason: string }[];
};

export async function registerUploadsAction(raw: unknown): Promise<Result<RegisterUploadsResult>> {
  const admin = await getAdminContext();
  if (!admin) return NOT_AUTHORISED;
  const parsed = stagedSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };

  const out: RegisterUploadsResult = { created: 0, duplicates: 0, rejected: [] };
  for (const file of parsed.data.files) {
    const displayName = file.name.replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 120) || "resume.pdf";
    try {
      const bytes = await readResumeBytes(file.pathname, MAX_RESUME_BYTES);
      if (!bytes) {
        out.rejected.push({ name: displayName, reason: "Upload not found or too large." });
        await deleteResumeFile(file.pathname);
        continue;
      }
      const valid = validateResumeBytes(bytes, displayName);
      if (!valid.ok) {
        out.rejected.push({ name: displayName, reason: valid.message });
        await deleteResumeFile(file.pathname);
        continue;
      }
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      if (await findImportByHash(contentHash)) {
        out.duplicates++;
        await deleteResumeFile(file.pathname);
        continue;
      }
      const blobPathname = await promoteImportFile(file.pathname, contentHash);
      if (!blobPathname) {
        out.rejected.push({ name: displayName, reason: "Could not store the file." });
        continue;
      }
      const created = await createOrGetImport({
        contentHash,
        originalFilename: displayName,
        fileSizeBytes: bytes.length,
        blobPathname,
        uploadedByUserId: admin.userId,
      });
      if (created.duplicate) out.duplicates++;
      else out.created++;
    } catch (error) {
      logger.error("[resume-import] register upload failed", { error: String(error) });
      out.rejected.push({ name: displayName, reason: "Something went wrong with this file." });
    }
  }

  await audit(admin.userId, "RESUME_IMPORT_UPLOAD", {
    created: out.created,
    duplicates: out.duplicates,
    rejected: out.rejected.length,
  });
  revalidatePath(PAGE);
  return { ok: true, data: out };
}

/* ─── 2–3. Parse / retry ─────────────────────────────────────────────────── */

// Auto-registration makes students recruiter-visible, so it needs the same
// consent attestation as registering by hand — enforced here, not in the UI.
const queueSchema = z
  .object({
    selection: selectionSchema,
    autoRegister: z.boolean(),
    consentAttested: z.boolean().optional(),
  })
  .refine((v) => !v.autoRegister || v.consentAttested === true, {
    message: "Confirm the students' consent before registering them.",
  });

export async function queueParseAction(raw: unknown): Promise<Result<{ queued: number }>> {
  const admin = await getAdminContext();
  if (!admin) return NOT_AUTHORISED;
  const parsed = queueSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  const queued = await queueImports(parsed.data.selection as Selection, parsed.data.autoRegister, admin.userId);
  await audit(admin.userId, "RESUME_IMPORT_QUEUE", {
    queued,
    autoRegister: parsed.data.autoRegister,
    ...(parsed.data.autoRegister ? { attestation: CONSENT_ATTESTATION } : {}),
  });
  if (queued > 0) startDrain();
  revalidatePath(PAGE);
  return { ok: true, data: { queued } };
}

export async function retryFailedAction(raw: unknown): Promise<Result<{ queued: number }>> {
  const admin = await getAdminContext();
  if (!admin) return NOT_AUTHORISED;
  const parsed = selectionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  const queued = await retryFailedImports(parsed.data as Selection);
  await audit(admin.userId, "RESUME_IMPORT_RETRY", { queued });
  if (queued > 0) startDrain();
  revalidatePath(PAGE);
  return { ok: true, data: { queued } };
}

/* ─── 4. Resolve email ───────────────────────────────────────────────────── */

const resolveSchema = z.object({ id: z.string().min(1).max(40), email: z.string().max(254) });

export async function resolveEmailAction(raw: unknown): Promise<Result<{ email: string }>> {
  const admin = await getAdminContext();
  if (!admin) return NOT_AUTHORISED;
  const parsed = resolveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  const email = normalizeEmail(parsed.data.email);
  if (!email) return { ok: false, message: "Enter a valid email address." };

  const res = await resolveImportEmail(parsed.data.id, email);
  if (!res.ok) {
    return {
      ok: false,
      message:
        res.reason === "duplicate"
          ? "Another import already uses this email."
          : res.reason === "not_found"
            ? "Import not found."
            : "This import is not waiting for review.",
    };
  }
  await audit(admin.userId, "RESUME_IMPORT_RESOLVE_EMAIL", { importId: parsed.data.id });
  revalidatePath(PAGE);
  return { ok: true, data: { email } };
}

/* ─── 5. Register ────────────────────────────────────────────────────────── */

const registerSchema = z.object({ selection: selectionSchema, consentAttested: z.literal(true) });

export async function requestRegistrationAction(raw: unknown): Promise<Result<{ requested: number }>> {
  const admin = await getAdminContext();
  if (!admin) return NOT_AUTHORISED;
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "Confirm the students' consent before registering them." };
  }
  const requested = await requestRegistration(parsed.data.selection as Selection, admin.userId);
  await audit(admin.userId, "RESUME_IMPORT_REGISTER", { requested, attestation: CONSENT_ATTESTATION });
  if (requested > 0) startDrain();
  revalidatePath(PAGE);
  return { ok: true, data: { requested } };
}

/* ─── 6. Status (polled) ─────────────────────────────────────────────────── */

const statusSchema = z.object({
  status: z.nativeEnum(ResumeImportStatus).optional(),
  cursor: z.string().max(40).optional(),
});

export async function getImportStatusAction(raw: unknown): Promise<Result<ImportStatusView>> {
  const admin = await getAdminContext();
  if (!admin) return NOT_AUTHORISED;
  const parsed = statusSchema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, message: "Invalid input" };

  const view = await loadImportStatus(parsed.data);
  // Belt and braces: work waiting and nobody working on it → start a drain.
  if (!view.workerRunning && (await hasPendingImportWork())) startDrain();
  return { ok: true, data: view };
}
