import type { CSSProperties } from "react";
import Link from "next/link";
import { GLOBE_LATS } from "./landing-content";

export function CtaBand() {
  return (
    <section className="cta-band">
      <div className="cta-band__rings" aria-hidden="true">
        <div className="globe">
          {GLOBE_LATS.map((lat) => (
            <span
              className="globe__lat"
              key={`${lat.r}-${lat.h}`}
              style={
                {
                  "--lp-r": lat.r,
                  "--lp-h": lat.h,
                } as CSSProperties
              }
            ></span>
          ))}
        </div>
      </div>
      <div className="container cta-band__inner">
        <h2 className="cta-band__title">
          Stop guessing in interviews.
          <br />
          Hire what you have already seen.
        </h2>
        <div className="cta-band__actions">
          <Link href="/talent" className="btn btn--outline-light">
            Post a requirement
          </Link>
          <a href="#cohorts" className="btn btn--white">
            Join the next cohort
          </a>
        </div>
      </div>
    </section>
  );
}
