"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { InterviewBlueprintKey } from "@/features/interview/cohort-eligibility";
import { Checkbox } from "@/components/ui/checkbox";

export function StageConsent({
  blueprint,
  onProceed,
}: {
  blueprint: InterviewBlueprintKey;
  onProceed: () => void;
}) {
  const [consentGiven, setConsentGiven] = useState(false);

  return (
    <div>
      <section className="border-2 border-[hsl(var(--divider)/0.4)] px-6 py-7">
        <span className="kicker">Interview Rules</span>
        <h2 className="mt-3 text-[24px] font-extrabold leading-7 tracking-[-0.01em]">
          Before you begin
        </h2>
        
        <ol className="mt-6 space-y-4 text-[15.5px] leading-7 text-foreground/78">
          <li className="flex gap-3">
            <span className="font-extrabold text-foreground">01</span>
            <div>
              <strong className="block font-bold text-foreground">Format & Duration</strong>
              This is a 15-minute voice-based interview. It will feel like a real conversation.
            </div>
          </li>
          <li className="flex gap-3">
            <span className="font-extrabold text-foreground">02</span>
            <div>
              <strong className="block font-bold text-foreground">Requirements</strong>
              A working camera and microphone are strictly required. You must remain in fullscreen mode.
            </div>
          </li>
          <li className="flex gap-3">
            <span className="font-extrabold text-foreground">03</span>
            <div>
              <strong className="block font-bold text-foreground">Content</strong>
              The questions are generated specifically for you, based entirely on the challenge days you have already passed.
            </div>
          </li>
          <li className="flex gap-3">
            <span className="font-extrabold text-foreground">04</span>
            <div>
              <strong className="block font-bold text-foreground">One Attempt</strong>
              You only get one attempt for this milestone. Leaving early will discard your progress.
            </div>
          </li>
        </ol>

        <hr className="rule2 my-7" />
        
        <h3 className="text-[18px] font-bold text-foreground">Data Handling Notice</h3>
        <p className="mt-2 text-[15px] leading-6 text-foreground/70">
          This interview uses an AI voice service. Your audio is transcribed in real-time. 
          Both the transcript and the resulting evaluation scores will be stored securely 
          on your profile as proof of your capability. We do not store raw audio or video recordings.
        </p>

        <div className="mt-8 flex items-start gap-3">
          <Checkbox 
            id="consent" 
            checked={consentGiven} 
            onCheckedChange={(c) => setConsentGiven(c as boolean)} 
            className="mt-1"
          />
          <label htmlFor="consent" className="text-[15px] leading-6 cursor-pointer">
            I understand the rules, and I consent to having my voice processed for the interview.
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
