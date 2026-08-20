"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { InterviewBlueprintKey } from "@/features/interview/cohort-eligibility";

/**
 * SCREEN 2 — Expectations & Consent.
 *
 * Clean, approachable. NOT a legal document.
 * Uses existing AB Talks design tokens.
 */
export function StageConsent({
  blueprint,
  onProceed,
}: {
  blueprint: InterviewBlueprintKey;
  onProceed: () => void;
}) {
  const [consentGiven, setConsentGiven] = useState(false);

  return (
    <div style={{ animation: "iv-fade-in 0.4s ease-out" }}>
      <section className="border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">Before you begin</span>
        <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
          How the interview works
        </h2>
        <p className="mt-3 max-w-[64ch] text-[15.5px] leading-7 text-foreground/78">
          This is a conversational assessment — not a quiz. Here is what to expect:
        </p>

        <ul className="mt-6 space-y-4 text-[15.5px] leading-7 text-foreground/78">
          <li className="flex gap-3">
            <span className="mt-1 block size-1.5 shrink-0 rounded-full bg-primary" />
            <span>
              <strong className="font-bold text-foreground">Answer naturally.</strong>{" "}
              Explain your reasoning as you would to a colleague. There are no trick
              questions.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-1 block size-1.5 shrink-0 rounded-full bg-primary" />
            <span>
              <strong className="font-bold text-foreground">The interviewer may follow up.</strong>{" "}
              If your answer is interesting, the AI may probe deeper. If something is
              unclear, it may ask you to clarify.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-1 block size-1.5 shrink-0 rounded-full bg-primary" />
            <span>
              <strong className="font-bold text-foreground">Stay on topic.</strong>{" "}
              The interview is based on your cohort work. Unrelated questions will be
              gently redirected.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-1 block size-1.5 shrink-0 rounded-full bg-primary" />
            <span>
              <strong className="font-bold text-foreground">Think out loud.</strong>{" "}
              The interviewer evaluates your reasoning process, not just your final
              answer.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-1 block size-1.5 shrink-0 rounded-full bg-primary" />
            <span>
              <strong className="font-bold text-foreground">It is okay not to know.</strong>{" "}
              Saying &quot;I&apos;m not sure about that&quot; is better than guessing.
              Honesty is part of communication.
            </span>
          </li>
        </ul>

        <hr className="rule2 my-7" />

        <h3 className="text-[16px] font-bold text-foreground">Data notice</h3>
        <p className="mt-2 text-[15px] leading-6 text-foreground/65">
          Your voice is transcribed in real-time for evaluation. The transcript and
          resulting scores are stored on your profile as evidence of your capability.
          Raw audio is not stored.
        </p>

        <div className="mt-7 flex items-start gap-3">
          <Checkbox
            id="consent"
            checked={consentGiven}
            onCheckedChange={(c) => setConsentGiven(c as boolean)}
            className="mt-1"
          />
          <label htmlFor="consent" className="text-[15px] leading-6 cursor-pointer">
            I understand the format and consent to having my voice processed for this
            interview.
          </label>
        </div>

        <div className="mt-8">
          <Button type="button" disabled={!consentGiven} onClick={onProceed}>
            Continue
          </Button>
        </div>
      </section>
    </div>
  );
}
