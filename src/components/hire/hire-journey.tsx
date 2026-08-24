"use client";

import Link from "next/link";
import { useHireDesk } from "@/components/hire/hire-desk-context";

export function HireJourney() {
  const { step, matchCount, gap } = useHireDesk();
  const countLabel =
    matchCount == null
      ? "Matched candidates"
      : matchCount === 0
        ? "No matches yet"
        : `${matchCount} matched candidate${matchCount === 1 ? "" : "s"}`;

  return (
    <>
      <aside className="hire-journey" aria-label="Hiring workflow" data-step={step}>
        <span className="hire-journey__track" aria-hidden="true">
          <span className="hire-journey__track-fill" />
        </span>
        <div className={`hire-journey__stage ${step === 1 ? "is-active" : ""}`}>
          <span className={`hire-node ${step === 1 ? "hire-node--on" : step > 1 ? "hire-node--done" : "hire-node--off"}`}>
            {step > 1 ? "✓" : "1"}
          </span>
          <div>
            <h2 className="hire-journey__title">Tell us who you&apos;re looking for</h2>
            <p className="hire-journey__desc">
              Describe the role in plain language. Scout ranks candidates on
              work the platform actually verified — missions, commits, projects
              and interviews. Never resumes.
            </p>
          </div>
        </div>
        <div className={`hire-journey__stage ${step === 2 ? "is-active" : ""}`}>
          <span className={`hire-node ${step >= 2 ? "hire-node--on" : "hire-node--off"}`}>
            2
          </span>
          <div>
            <h2 className="hire-journey__title">{countLabel}</h2>
            <p className="hire-journey__desc">
              {gap?.trim() ||
                "Once you search, ranked profiles appear beside the conversation. Availability is confirmed with the candidate before we share contact."}
            </p>
          </div>
        </div>
        <div className={`hire-journey__stage ${step === 3 ? "is-active" : ""}`}>
          <span className={`hire-node ${step === 3 ? "hire-node--on" : step > 3 ? "hire-node--done" : "hire-node--off"}`}>
            3
          </span>
          <div>
            <h2 className="hire-journey__title">Track your requests</h2>
            <p className="hire-journey__desc">
              Everything with our team happens here. We confirm availability
              with the candidate first, then share their details.{" "}
              <Link href="/hire/requests" className="hire-journey__link">
                Open requests
              </Link>
            </p>
          </div>
        </div>
      </aside>
      <section className="hire-rail" aria-label="Hiring workflow">
        <div className="hire-rail__nodes" aria-hidden="true">
          <span className={step === 1 ? "is-on" : step > 1 ? "is-done" : ""}>1</span>
          <i />
          <span className={step === 2 ? "is-on" : step > 2 ? "is-done" : ""}>2</span>
          <i />
          <span className={step === 3 ? "is-on" : ""}>3</span>
        </div>
        <p>
          <strong>
            {step === 1 ? "Tell us who you're looking for" : countLabel}
          </strong>
          Scout ranks candidates on verified platform work — never resumes.
        </p>
      </section>
    </>
  );
}
