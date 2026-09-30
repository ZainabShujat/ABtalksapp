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

  // Before kickoff: nothing to show yet, so render a locked card instead of
  // an empty "no submission" message.
  if (!editable && !closed) {
    return (
      <section className="vt-card vt-card--dark is-locked">
        <header className="vt-card__head">
          <p className="vt-card__eyebrow">Scene 02 · Your cut</p>
         
        </header>
        <div className="vt-brief__lock">
          <span className="vt-brief__lock-icon" aria-hidden>
            <svg viewBox="0 0 24 24" focusable="false">
              <rect x="4" y="10.5" width="16" height="10.5" rx="2.4" />
              <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
            </svg>
          </span>
          <div>
            <h2 className="vt-card__title">Submissions open at kickoff</h2>
            <p className="vt-card__body">
              Once the clock starts you can paste one public link here 
              
            </p>
          </div>
        </div>
      </section>
    );
  }

  // After the deadline: read-only.
  if (!editable) {
    return (
      <section className="vt-card vt-card--dark">
        <header className="vt-card__head">
          <p className="vt-card__eyebrow">Scene 02 · Your cut</p>
          <span className="vt-card__tag" data-tone="ended">Closed</span>
        </header>
        <h2 className="vt-card__title">Your submission</h2>
        {initial ? (
          <div className="vt-panel__stack">
            <StaticRow label="Link" value={initial.url} href={initial.url} />
            <StaticRow label="Notes" value={initial.notes || "None"} />
          </div>
        ) : (
          <p className="vt-card__body">
            No submission was recorded before the deadline.
          </p>
        )}
        {initial && mounted ? (
          <p className="vt-panel__meta">
            Last saved {new Date(initial.updatedAtIso).toLocaleString()}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="vt-card vt-card--dark is-live">
      <header className="vt-card__head">
        <p className="vt-card__eyebrow">Scene 02 · Your cut</p>
        <span className="vt-card__tag" data-tone="live">{initial ? "Saved" : "Open"}</span>
      </header>
      <h2 className="vt-card__title">Submit your cut</h2>
      <p className="vt-card__body">
        Paste one public link. Drive, Behance, YouTube, Vimeo. Set it to
        &quot;anyone with the link can view&quot;. 
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
            placeholder="Paste your PUBLIC submission link "
            aria-invalid={errors.submissionUrl ? true : undefined}
          />
          {errors.submissionUrl ? (
            <span className="vt-field__error">{errors.submissionUrl}</span>
          ) : null}
        </label>

        <label className="vt-field">
          <span className="vt-field__label">
            Additional Notes {" "}
            <span className="vt-field__hint">(optional, 1000 chars max)</span>
          </span>
          <textarea
            className="vt-field__textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="How you used your creativity and skills to create this video"
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
