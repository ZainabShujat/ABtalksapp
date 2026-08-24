"use client";

import { useEffect, useState } from "react";
import {
  deskShortlistHas,
  itemFromMatch,
  toggleDeskShortlist,
} from "@/components/hire/desk-shortlist";
import type { MatchCardData } from "@/components/hire/match-card";
import { cn } from "@/lib/utils";

export function DeskShortlistButton({
  candidateRef,
  jobRole,
  match,
}: {
  candidateRef: string;
  jobRole: string;
  match?: MatchCardData;
}) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(deskShortlistHas(candidateRef));
  }, [candidateRef]);

  return (
    <button
      type="button"
      className={cn("desk-shortlist", on && "is-on")}
      aria-pressed={on}
      onClick={() => {
        setOn(
          toggleDeskShortlist(
            match
              ? itemFromMatch(match)
              : { candidateRef, jobRole },
          ),
        );
      }}
    >
      <span className="desk-shortlist__box" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            d="m5 12.5 4.5 4.5L19 7.5"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {on ? "Saved for later" : "Save for later"}
    </button>
  );
}
