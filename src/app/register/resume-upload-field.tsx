"use client";

import { useRef, useState } from "react";
import { Check, FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  getResumeStateAction,
  removeResumeAction,
  uploadResumeAction,
} from "@/app/actions/resume-actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ACCEPTED_MIME_TYPES,
  MAX_RESUME_BYTES,
} from "@/features/resume/types";

/**
 * Optional résumé upload on registration.
 *
 * Deliberately NOT `components/profile/resume-section.tsx`. That one shows a
 * strength breakdown and a "paste a link instead" alternative — both of which
 * belong to a profile the candidate already has, and one of which ("scroll up
 * to review what we filled in") is a lie on a page where there is no profile
 * yet to scroll to. This is the same pipeline underneath: the same
 * `uploadResumeAction`, the same `removeResumeAction`, the same parse, the
 * same additive merge.
 *
 * The upload runs on its own, before the form is submitted, because parsing
 * takes seconds and a candidate should watch that happen rather than watch a
 * Submit button hang. A READY `CandidateResume` is merged into the profile
 * after registration; skipping upload still allows completion.
 */

const MAX_MB = Math.floor(MAX_RESUME_BYTES / (1024 * 1024));

type Props = {
  /** Set when a résumé was already uploaded (a reload, or a resumed attempt). */
  initialFileName: string | null;
  uploaded: boolean;
  onUploadedChange: (uploaded: boolean) => void;
  disabled?: boolean;
};

export function ResumeUploadField({
  initialFileName,
  uploaded,
  onUploadedChange,
  disabled,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(initialFileName);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  /**
   * Adopt whatever is actually stored.
   *
   * An upload replaces the stored résumé on the server BEFORE it parses, so a
   * failure can leave the row FAILED with the previous file already deleted —
   * while this component still shows a tick and the old filename. Some other
   * failures (not a PDF, over the size limit) are rejected before anything is
   * written and the previous résumé survives untouched. The error message does
   * not distinguish the two, so ask rather than guess.
   *
   * `ready` is the only signal for the tick: a FAILED row can still carry a
   * `fileName`, so the presence of a name means nothing on its own.
   */
  async function reconcileWithServer() {
    try {
      const state = await getResumeStateAction();
      setFileName(state.fileName);
      onUploadedChange(state.ready);
    } catch {
      // Called from an error path, including a catch block. If even this round
      // trip fails we cannot know what is stored, so leave the field as it is
      // rather than throwing a second error over the first.
    }
  }

  async function onFileChosen(file: File) {
    // Courtesy check only — `ingest.ts` re-checks the actual bytes server-side
    // and it is that answer which decides.
    if (file.size > MAX_RESUME_BYTES) {
      toast.error(`That file is too large. Please upload a PDF under ${MAX_MB} MB.`);
      return;
    }

    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadResumeAction(formData);
      if (!result.ok) {
        toast.error(result.message);
        await reconcileWithServer();
        return;
      }
      setFileName(result.data.fileName ?? file.name);
      onUploadedChange(true);
      if (result.autoRegistered) {
        toast.success("Profile created from your résumé! Redirecting to dashboard…");
        window.location.assign("/dashboard");
        return;
      }
      toast.success("Resume analysed");
    } catch {
      toast.error("Something went wrong. Please try again.");
      await reconcileWithServer();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onRemove() {
    setRemoving(true);
    try {
      const result = await removeResumeAction();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setFileName(null);
      onUploadedChange(false);
      toast.success("Resume removed");
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="resume-upload">Resume</Label>
      <p className="text-xs text-muted-foreground">
         PDF only, max upload size is {MAX_MB} MB.
      </p>

      {busy ? (
        <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-5">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium" aria-live="polite">
              Analysing your resume…
            </p>
            <p className="text-xs text-muted-foreground">
              This takes a few seconds. Please keep this page open.
            </p>
          </div>
        </div>
      ) : uploaded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#18D39B]/25 bg-[#18D39B]/5 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Check className="size-5 shrink-0 text-[#197E23]" aria-hidden />
            <p className="min-w-0 truncate text-sm font-medium">
              {fileName ?? "Resume uploaded"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || removing}
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => void onRemove()}
              disabled={disabled || removing}
            >
              {removing ? "Removing…" : "Remove"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-6 text-center">
          <FileText className="size-6 text-muted-foreground" aria-hidden />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
          >
            <Upload className="size-4" aria-hidden />
            Upload Resume
          </Button>
        </div>
      )}

      <input
        ref={fileRef}
        id="resume-upload"
        type="file"
        accept={ACCEPTED_MIME_TYPES.join(",")}
        className="sr-only"
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFileChosen(file);
        }}
      />
    </div>
  );
}
