"use client";

import Link from "next/link";
import type { CandidateRecruiterView } from "@/features/profile/recruiter-view";
import { CardNote, SearchCardPreview } from "./search-card-preview";
import { EvidenceMeter } from "./evidence-meter";
import { PanelPreview } from "./panel-preview";
import { FindabilityPanel } from "./findability-panel";
import { ArrowLeftIcon } from "./rv-icons";

/**
 * `/profile/recruiter-view` — the candidate's own record as a recruiter's search
 * returns it (plan 155).
 *
 * Client only for the detail panel's tab state. Everything rendered arrives as one
 * plain serialisable object from `getCandidateRecruiterView` on the server: no
 * functions, no icon elements, no `Date`s cross this boundary.
 *
 * Read-only by design. Every edit affordance points back at `/profile`.
 */
export function RecruiterViewScreen({ view }: { view: CandidateRecruiterView }) {
  const noLocation = !view.card.pills.some((p) => p.kind === "location");

  return (
    <div className="rv-root">
      <div className="rv-shell">
        <header className="rv-head">
          <Link className="rv-back" href="/profile">
            <ArrowLeftIcon />
            Back to your profile
          </Link>
          <h1 className="rv-title">How recruiters see you</h1>
          <p className="rv-lede">
            This is your own record, read the way a recruiter&rsquo;s search returns
            it. Nothing here is editable and nothing here is a guess — every figure
            comes from the same code that builds a recruiter&rsquo;s results.
          </p>
        </header>

        <section className="rv-section">
          <div className="rv-section__head">
            <span className="rv-section__num">Step one</span>
            <h2 className="rv-section__title">In their search results</h2>
            <p className="rv-section__note">
              The card a recruiter meets before they have opened anything.
            </p>
          </div>
          <SearchCardPreview card={view.card} />
          <CardNote
            masked={view.card.maskedLength !== null}
            availabilityUnknown={view.card.availabilityUnknown}
            noLocation={noLocation}
          />
        </section>

        <section className="rv-section">
          <div className="rv-section__head">
            <span className="rv-section__num">Step two</span>
            <h2 className="rv-section__title">What the ranking measures</h2>
            <p className="rv-section__note">
              Recruiters see one score per candidate, and it is computed against the
              role they are searching for. Five parts of it are about you and hold
              still whoever is searching — those are the numbers below. The other
              three only exist once someone types a role and a stack, so there is no
              honest number to show you for them.
            </p>
          </div>
          <div className="rv-meters">
            {view.dims.map((dim) => (
              <EvidenceMeter dim={dim} key={dim.key} />
            ))}
          </div>
        </section>

        <section className="rv-section">
          <div className="rv-section__head">
            <span className="rv-section__num">Step three</span>
            <h2 className="rv-section__title">When they open you</h2>
            <p className="rv-section__note">
              Your evidence leads, because it is the one part of a profile a CV
              cannot claim. Your email, phone number and résumé are not on this
              panel — a recruiter pays separately to reach those.
            </p>
          </div>
          <PanelPreview tabs={view.tabs} />
        </section>

        <section className="rv-section">
          <div className="rv-section__head">
            <span className="rv-section__num">Step four</span>
            <h2 className="rv-section__title">Can they find you at all</h2>
            <p className="rv-section__note">
              None of the above matters if a search never returns you. This is the
              real gate, run against your account.
            </p>
          </div>
          <FindabilityPanel
            findability={view.findability}
            performance={view.performance}
          />
        </section>
      </div>
    </div>
  );
}
