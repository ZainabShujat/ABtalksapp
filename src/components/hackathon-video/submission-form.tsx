"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveVideoSubmissionAction } from "@/app/actions/hackathon-video-submission-actions";
import { videoSubmissionSchema } from "@/lib/validations/hackathon-video";

type Initial = {
  url: string;
  notes: string | null;
  updatedAtIso: string;
} | null;

type FieldErrors = Partial<Record<"submissionUrl" | "notes", string>>;

type Props = {
  initial: Initial;
  editable: boolean;
  closed: boolean;
};

/**
 * Single-link submission form. One URL field, optional notes. Re-saves
 * overwrite in place — no edit history, matching the code-hackathon's
 * design decision.
 */
export function VideoSubmissionForm({ initial, editable, closed }: Props) {
  const router = useRouter();
  const [url, setUrl] = useState(initial?.url ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  function submit() {
    const parsed = videoSubmissionSchema.safeParse({
      submissionUrl: url,
      notes: notes || undefined,
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (
          typeof key === "string" &&
          (key === "submissionUrl" || key === "notes") &&
          !next[key]
        ) {
          next[key] = issue.message;
        }
      }
      setErrors(next);
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setErrors({});

    startTransition(async () => {
      const result = await saveVideoSubmissionAction(parsed.data);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Submission saved");
      router.refresh();
    });
  }

  if (!editable) {
    return (
      <section className="vt-panel">
        <h2 className="vt-panel__title">Your submission</h2>
        {initial ? (
          <div className="vt-panel__stack">
            <StaticRow label="Link" value={initial.url} href={initial.url} />
            <StaticRow label="Notes" value={initial.notes || "None"} />
          </div>
        ) : (
          <p className="vt-panel__body">
            No submission recorded before the deadline.
          </p>
        )}
        <p className="vt-panel__meta">
          {closed ? "Submissions closed." : "Submissions open at kickoff."}
        </p>
        {initial && mounted ? (
          <p className="vt-panel__meta">
            Last saved {new Date(initial.updatedAtIso).toLocaleString()}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="vt-panel">
      <h2 className="vt-panel__title">Submit your cut</h2>
      <p className="vt-panel__body">
        Paste one public link — Drive, Behance, YouTube, Vimeo. Set it to
        &quot;anyone with the link can view&quot;. You can re-save any time
        until the deadline; the last save is what the judges see.
      </p>

      <div className="vt-panel__stack">
        <label className="vt-field">
          <span className="vt-field__label">Submission link</span>
          <input
            type="url"
            inputMode="url"
            spellCheck={false}
            className="vt-field__input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://drive.google.com/... or https://www.youtube.com/watch?v=..."
            aria-invalid={errors.submissionUrl ? true : undefined}
          />
          {errors.submissionUrl ? (
            <span className="vt-field__error">{errors.submissionUrl}</span>
          ) : null}
        </label>

        <label className="vt-field">
          <span className="vt-field__label">
            Notes for the judges{" "}
            <span className="vt-field__hint">(optional, 1000 chars max)</span>
          </span>
          <textarea
            className="vt-field__textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Software used, sources credited, anything a judge should know before pressing play."
            aria-invalid={errors.notes ? true : undefined}
          />
          {errors.notes ? (
            <span className="vt-field__error">{errors.notes}</span>
          ) : null}
        </label>
      </div>

      <div className="vt-panel__actions">
        <button
          type="button"
          className="vt-btn vt-btn--primary"
          onClick={() => submit()}
          disabled={pending}
        >
          {pending ? "Saving…" : initial ? "Update submission" : "Save submission"}
        </button>
      </div>

      {initial && mounted ? (
        <p className="vt-panel__meta">
          Last saved {new Date(initial.updatedAtIso).toLocaleString()}
        </p>
      ) : null}
    </section>
  );
}

function StaticRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="vt-row">
      <span className="vt-row__label">{label}</span>
      {href ? (
        <a
          className="vt-row__value vt-row__link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {value}
        </a>
      ) : (
        <span className="vt-row__value">{value}</span>
      )}
    </div>
  );
}
