"use client";

import { useState, useTransition } from "react";
import { Sparkles, Send, Check } from "lucide-react";
import { toast } from "sonner";
import { requestVirtualCandidateAction } from "@/app/actions/virtual-candidate-actions";
import { generateVirtualCandidate } from "@/features/hire/virtual-candidate";
import type { JobSpec } from "@/lib/validations/hire";

/**
 * A requirement, drawn as a card — and drawn so it can never be mistaken for a
 * person.
 *
 * The whole design brief is one sentence: say what we would go and find, and
 * say plainly that we have not found it yet. So there is no avatar, no name, no
 * score, no "82 out of 100", none of the chrome that on a real card means
 * *somebody was measured*. The heading is the requirement itself, and the
 * status line says it in words rather than leaving it to be inferred from a
 * subtle border colour.
 *
 * Every value comes from `generateVirtualCandidate`, which derives all of it
 * from the recruiter's own spec. Nothing on this card was invented.
 */
export function VirtualCandidateCard({
  spec,
  talentRequestId,
  alreadyRequested = false,
}: {
  spec: JobSpec;
  talentRequestId?: string | null;
  alreadyRequested?: boolean;
}) {
  const profile = generateVirtualCandidate(spec);
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(alreadyRequested);
  const [timeline, setTimeline] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  if (!profile) return null;

  function submit() {
    startTransition(async () => {
      const days = timeline.trim() ? Number.parseInt(timeline.trim(), 10) : null;
      const res = await requestVirtualCandidateAction({
        spec,
        talentRequestId: talentRequestId ?? null,
        timelineDays: Number.isFinite(days) && days! > 0 ? days : null,
        recruiterNote: note.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setRequested(true);
      setOpen(false);
      toast.success(
        res.data.duplicate
          ? "You have already asked for this one, our team is on it."
          : "Request sent. Our team will start sourcing.",
      );
    });
  }

  return (
    <article className="vc-card" aria-label="Requirement-based profile">
      <header className="vc-card__head">
        <span className="vc-card__badge">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Virtual Candidate
        </span>
        <span className="vc-card__kicker">Requirement-Based Profile</span>
      </header>

      <h3 className="vc-card__title">{profile.title}</h3>

      <p className="vc-card__explain">
        Nobody in our active candidate database matches this yet. This card is
        your requirement, not a person, we can source someone to it.
      </p>

      <dl className="vc-card__facts">
        {profile.requiredSkills.length > 0 && (
          <div>
            <dt>Skills</dt>
            <dd>{profile.requiredSkills.join(" · ")}</dd>
          </div>
        )}
        {profile.preferredSkills.length > 0 && (
          <div>
            <dt>Also useful</dt>
            <dd>{profile.preferredSkills.join(" · ")}</dd>
          </div>
        )}
        <div>
          <dt>Experience</dt>
          <dd>{profile.experienceLabel}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{profile.locationLabel}</dd>
        </div>
        <div>
          <dt>Availability</dt>
          <dd>{profile.availabilityLabel}</dd>
        </div>
        {profile.employmentLabel && (
          <div>
            <dt>Employment</dt>
            <dd>{profile.employmentLabel}</dd>
          </div>
        )}
        {profile.educationLabel && (
          <div>
            <dt>Education</dt>
            <dd>{profile.educationLabel}</dd>
          </div>
        )}
      </dl>

      <p className="vc-card__status">
        {requested
          ? "Requested, our team is sourcing this candidate"
          : "Available on Request, candidate will be sourced after you ask"}
      </p>

      {!requested && !open && (
        <button type="button" className="vc-card__cta" onClick={() => setOpen(true)}>
          <Send className="size-3.5" aria-hidden="true" />
          Request Candidate
        </button>
      )}

      {requested && (
        <p className="vc-card__done">
          <Check className="size-3.5" aria-hidden="true" />
          We have your request. You will hear from us as soon as we have someone.
        </p>
      )}

      {open && (
        <div className="vc-card__form">
          <label className="vc-card__label" htmlFor="vc-timeline">
            How soon do you need them? (days)
          </label>
          <input
            id="vc-timeline"
            className="vc-card__input"
            inputMode="numeric"
            value={timeline}
            onChange={(e) => setTimeline(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="e.g. 7"
            maxLength={3}
            disabled={pending}
          />

          <label className="vc-card__label" htmlFor="vc-note">
            Anything else we should know?
          </label>
          <textarea
            id="vc-note"
            className="vc-card__textarea"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. needs to join quickly; open to remote"
            maxLength={2000}
            disabled={pending}
          />

          <div className="vc-card__formcta">
            <button
              type="button"
              className="vc-card__cta"
              onClick={submit}
              disabled={pending}
            >
              <Send className="size-3.5" aria-hidden="true" />
              {pending ? "Sending…" : "Send request"}
            </button>
            <button
              type="button"
              className="vc-card__ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
