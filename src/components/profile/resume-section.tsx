"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  removeResumeAction,
  saveResumeLinkAction,
  uploadResumeAction,
} from "@/app/actions/resume-actions";
import {
  ACCEPTED_MIME_TYPES,
  MAX_RESUME_BYTES,
  type ResumeView,
} from "@/features/resume/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "./fields";
import { ResumeStrength } from "./resume-strength";

/**
 * The Résumé section of the profile.
 *
 * Replaces what used to be a bare URL text box in Links. Upload is the primary
 * path; the link is kept because it was there first and people already have one
 * saved, and saving a link still writes the same `resumeUrl` every existing
 * reader uses.
 *
 * Nothing internal is rendered here — no raw JSON, no parser or model names, no
 * status codes. The only text a candidate ever sees on a failure is the message
 * the server chose for them.
 */

type Phase = "idle" | "uploading" | "processing";

const MAX_MB = Math.floor(MAX_RESUME_BYTES / (1024 * 1024));

/** "Education, Projects and Skills" — read as a sentence, not a CSV. */
function formatList(items: string[]): string {
  const lower = items.map((i) => i.toLowerCase());
  if (lower.length <= 1) return lower[0] ?? "";
  return `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
}

export function ResumeSection({ resume }: { resume: ResumeView | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [linkDraft, setLinkDraft] = useState(resume?.sourceUrl ?? "");
  const [removing, startRemoving] = useTransition();

  const busy = phase !== "idle" || removing;

  async function onFileChosen(file: File) {
    // Client-side courtesy check only — the server re-checks the actual bytes,
    // and it is the server's answer that decides.
    if (file.size > MAX_RESUME_BYTES) {
      toast.error(`That file is too large. Please upload a PDF under ${MAX_MB} MB.`);
      return;
    }

    setPhase("uploading");
    // The action does the transfer and the analysis in one call, so the two
    // phases cannot be observed separately from here. The switch is timed so
    // the copy stops saying "uploading" long after the bytes have gone.
    const toProcessing = setTimeout(() => setPhase("processing"), 1500);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadResumeAction(formData);
      if (!result.ok) {
        toast.error(result.message);
      } else {
        toast.success("Résumé analysed");
      }
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      clearTimeout(toProcessing);
      setPhase("idle");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onSaveLink() {
    const url = linkDraft.trim();
    if (url.length === 0) {
      toast.error("Paste a link to your résumé");
      return;
    }
    setPhase("processing");
    try {
      const result = await saveResumeLinkAction({ url });
      if (!result.ok) toast.error(result.message);
      else toast.success("Résumé analysed");
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setPhase("idle");
    }
  }

  function onRemove() {
    startRemoving(async () => {
      const result = await removeResumeAction();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setLinkDraft("");
      toast.success("Résumé removed");
      router.refresh();
    });
  }

  /* ── Busy overlay ─────────────────────────────────────────────────────── */

  if (phase !== "idle") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-10 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium" aria-live="polite">
          {phase === "uploading"
            ? "Uploading your résumé…"
            : "Analysing your résumé…"}
        </p>
        <p className="text-xs text-muted-foreground">
          This usually takes a few seconds. Please keep this page open.
        </p>
      </div>
    );
  }

  /* ── Source controls: always available, so a résumé can be replaced ────── */

  const controls = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Upload className="size-4" aria-hidden />
          {resume ? "Replace résumé" : "Upload résumé"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_MIME_TYPES.join(",")}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFileChosen(file);
          }}
        />
        <p className="text-xs text-muted-foreground">
          PDF only, up to {MAX_MB} MB. Your file stays private — only you and
          ABTalks admins can open it.
        </p>
      </div>

      {/*
        Not an "or" divider. Both paths run the same parser, but they are not
        equally likely to succeed: a Drive link only fetches when the file is
        shared with anyone who has the link, and most people's are restricted.
        Presenting the two as peers sends candidates down the path that fails.
      */}
      <div className="border-t pt-4">
        <p className="text-xs text-muted-foreground">
          Already have your résumé online? You can point us at it instead.
        </p>
      </div>

      <div className="flex items-start gap-3">
        <Link2 className="mt-8 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <Field
          label="Résumé link"
          htmlFor="resume-link"
          className="flex-1"
          hint="Must be publicly viewable — in Google Drive, set sharing to “Anyone with the link”. If we cannot open it, upload the PDF instead."
        >
          <Input
            id="resume-link"
            type="url"
            inputMode="url"
            placeholder="https://drive.google.com/…"
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            disabled={busy}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void onSaveLink()}
          disabled={busy || linkDraft.trim().length === 0}
        >
          Save &amp; analyse link
        </Button>
        {resume ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onRemove}
            disabled={busy}
          >
            {removing ? "Removing…" : "Remove résumé"}
          </Button>
        ) : null}
      </div>
    </div>
  );

  /* ── EMPTY ────────────────────────────────────────────────────────────── */

  if (!resume) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-dashed px-4 py-6 text-center">
          <FileText
            className="mx-auto size-6 text-muted-foreground"
            aria-hidden
          />
          <p className="mt-2 text-sm font-medium">No résumé yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload your résumé to see how strong it is and what to improve.
          </p>
        </div>
        {controls}
      </div>
    );
  }

  /* ── FAILED ───────────────────────────────────────────────────────────── */

  if (resume.status === "FAILED") {
    return (
      <div className="space-y-5">
        <div className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <AlertTriangle
            className="mt-0.5 size-5 shrink-0 text-destructive"
            aria-hidden
          />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">We could not analyse that résumé</p>
            <p className="text-sm text-muted-foreground">
              {resume.failureReason ??
                "Something went wrong. Please try again or upload the PDF directly."}
            </p>
          </div>
        </div>
        {controls}
      </div>
    );
  }

  /* ── PROCESSING (a previous run left the row mid-flight) ──────────────── */

  if (resume.status === "PROCESSING") {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-10 text-center">
          <Loader2
            className="size-6 animate-spin text-muted-foreground"
            aria-hidden
          />
          <p className="text-sm font-medium">Analysing your résumé…</p>
          <Button type="button" variant="ghost" onClick={() => router.refresh()}>
            Refresh
          </Button>
        </div>
        {controls}
      </div>
    );
  }

  /* ── READY ────────────────────────────────────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* What is attached */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {resume.fileName ?? resume.sourceUrl ?? "Your résumé"}
            </p>
            <p className="text-xs text-muted-foreground">
              Added{" "}
              {new Date(resume.updatedAtIso).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          {resume.downloadPath ? (
            <a
              href={resume.downloadPath}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
            >
              <Download className="size-4" aria-hidden />
              View file
            </a>
          ) : null}
          {resume.sourceUrl ? (
            <a
              href={resume.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
            >
              <ExternalLink className="size-4" aria-hidden />
              Open link
            </a>
          ) : null}
        </div>
      </div>

      {/*
        What the résumé contributed. The information itself is NOT repeated
        here — it went into the profile's own sections, which are editable and
        sit a few centimetres up this same page. Listing it twice would make
        the résumé card a read-only shadow of the profile.
      */}
      {resume.addedToProfile.length > 0 ? (
        <div className="flex gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <Sparkles
            className="mt-0.5 size-5 shrink-0 text-emerald-600"
            aria-hidden
          />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">
              Your {formatList(resume.addedToProfile)} got more complete
            </p>
            <p className="text-sm text-muted-foreground">
              Scroll up to review and edit any of it. Nothing you had already
              written was changed or removed.
            </p>
          </div>
        </div>
      ) : null}

      {resume.strength ? <ResumeStrength strength={resume.strength} /> : null}

      <div className="border-t pt-5">{controls}</div>
    </div>
  );
}
