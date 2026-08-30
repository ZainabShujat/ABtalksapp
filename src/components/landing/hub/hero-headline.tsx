"use client";

import { useEffect, useState } from "react";
import { useSafeReducedMotion } from "@/lib/motion";

export function HeroHeadline() {
  const reduce = useSafeReducedMotion();
  const [strikeOn, setStrikeOn] = useState(false);
  const [evidenceOn, setEvidenceOn] = useState(false);

  useEffect(() => {
    if (reduce) {
      setStrikeOn(true);
      setEvidenceOn(true);
      return;
    }
    const t1 = window.setTimeout(() => setStrikeOn(true), 280);
    const t2 = window.setTimeout(() => setEvidenceOn(true), 900);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [reduce]);

  return (
    <h1 style={{ margin: 0 }}>
      <span className="hub-interview">
        Interview
        <span
          className={
            strikeOn ? "hub-interview-strike on" : "hub-interview-strike"
          }
          aria-hidden
        />
      </span>
      <br />
      <span className={evidenceOn ? "hub-evidence on" : "hub-evidence"}>
        Evidence-based hiring.
      </span>
    </h1>
  );
}
