"use client";

import { useEffect, useState } from "react";
import { ArrowRight, X } from "lucide-react";

/**
 * The plan table behind a gated action.
 *
 * Presentation only. There is no billing here: no checkout, no payment
 * provider, no entitlement write. Choosing a plan closes the dialog and says
 * the team will be in touch, because that is the whole of what this branch
 * implements — the reference design this follows has the same shape.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE PRICES AND THE TIER SPLIT STILL NEED SIGN-OFF.
 *
 * Every line below names something the desk genuinely does — ranked matches,
 * the score breakdown, the shortlist, intro requests, the evidence profile —
 * so nothing here promises a capability that does not exist. What has NOT been
 * decided is which of them belongs to which tier, or whether $69/$99/$199 are
 * the real numbers; those came from the reference design.
 *
 * So: safe to show the team, not safe to charge against. Confirm the split and
 * the pricing before billing is switched on. The dialog says as much in its
 * own footer.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Plan = {
  name: string;
  tagline: string;
  monthly: string;
  annual: string;
  seats: string;
  features: string[];
  recommended?: boolean;
};

const PLANS: Plan[] = [
  {
    name: "Starter",
    tagline: "For one open role at a time",
    monthly: "$69",
    annual: "$59",
    seats: "Includes 1 seat",
    features: [
      "Search the verified candidate pool",
      "Ranked matches with evidence on every card",
      "Shortlist and save candidates for later",
      "Request an introduction, reviewed by our team",
    ],
  },
  {
    name: "Prime",
    tagline: "For a team hiring continuously",
    monthly: "$99",
    annual: "$84",
    seats: "Includes 1 seat",
    recommended: true,
    features: [
      "Everything in Starter",
      "Full score breakdown for every candidate",
      "Candidate names and full resumes",
      "Search across every candidate track",
    ],
  },
  {
    name: "Professional",
    tagline: "For agencies and high-volume hiring",
    monthly: "$199",
    annual: "$169",
    seats: "Includes 1 seat",
    features: [
      "Everything in Prime",
      "Request introductions in bulk from your shortlist",
      "Track every request in one place",
      "Gap reports when a search comes up short",
    ],
  },
];

/** Which action asked for the gate. Only the heading changes. */
export type GateReason = "resume" | "name" | "default";

const COPY: Record<GateReason, { title: string; body: string }> = {
  resume: {
    title: "Unlock the full resume",
    body: "Subscribe to view or download this candidate's full resume.",
  },
  name: {
    title: "Unlock candidate details",
    body: "Subscribe to reveal this candidate's full name and access premium candidate information.",
  },
  default: {
    title: "Unlock candidate details",
    body: "Subscribe to access full candidate names, resumes and other premium candidate information.",
  },
};

export function SubscriptionGate({
  reason,
  onClose,
}: {
  reason: GateReason | null;
  onClose: () => void;
}) {
  const [annual, setAnnual] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);

  // Escape closes, and the page behind does not scroll while this is open.
  useEffect(() => {
    if (!reason) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [reason, onClose]);

  if (!reason) return null;
  const copy = COPY[reason];

  // Reset here rather than in an effect on `reason`: a synchronous setState
  // inside an effect triggers a cascading render, and the only moment the
  // choice needs clearing is when the dialog goes away.
  function close() {
    setChosen(null);
    onClose();
  }

  return (
    <div
      className="hire-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hire-gate-title"
      onClick={close}
    >
      <div
        className="hire-gate__card"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="hire-gate__x"
          onClick={close}
          aria-label="Close"
        >
          <X className="size-4" aria-hidden="true" />
        </button>

        <header className="hire-gate__head">
          <h2 className="hire-gate__title" id="hire-gate-title">
            {copy.title}
          </h2>
          <p className="hire-gate__body">{copy.body}</p>
        </header>

        <div
          className="hire-gate__toggle"
          role="radiogroup"
          aria-label="Billing cycle"
        >
          <button
            type="button"
            role="radio"
            aria-checked={!annual}
            className={`hire-gate__seg${!annual ? " is-active" : ""}`}
            onClick={() => setAnnual(false)}
          >
            Monthly
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={annual}
            className={`hire-gate__seg${annual ? " is-active" : ""}`}
            onClick={() => setAnnual(true)}
          >
            Annually <span className="hire-gate__save">(save upto 15%)</span>
          </button>
        </div>

        <div className="hire-gate__grid">
          {PLANS.map((p) => (
            <article
              key={p.name}
              className={`hire-plan${p.recommended ? " hire-plan--prime" : ""}`}
            >
              {p.recommended && (
                <span className="hire-plan__ribbon">Recommended</span>
              )}
              <h3 className="hire-plan__name">{p.name}</h3>
              <p className="hire-plan__tagline">{p.tagline}</p>

              <p className="hire-plan__price">
                <b>{annual ? p.annual : p.monthly}</b>
                <span>/ month</span>
              </p>
              {/* Reserved either way so switching cycle cannot change the
                  card height and shift the grid; only its ink appears. */}
              <p
                className="hire-plan__billed"
                aria-hidden={!annual}
                style={{ visibility: annual ? "visible" : "hidden" }}
              >
                billed annually
              </p>

              <p className="hire-plan__seat">{p.seats}</p>

              <p className="hire-plan__packed">
                What comes packed in {p.name} pack :
              </p>
              <ul className="hire-plan__list">
                {p.features.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>

              <button
                type="button"
                className={`hire-plan__cta${p.recommended ? " hire-plan__cta--prime" : ""}`}
                onClick={() => setChosen(p.name)}
              >
                Get started
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>

        {/* No checkout exists on this branch, so the dialog says what actually
            happens next instead of pretending to take a payment. */}
        <p className="hire-gate__note" role="status">
          {chosen
            ? `Thanks — we'll be in touch about the ${chosen} plan. Nothing has been charged.`
            : "Plans are shown for reference. Billing is not enabled yet."}
        </p>
      </div>
    </div>
  );
}
