"use client";

// Cards grid is temporarily hidden — restore these imports with it.
// import { useRef, useState } from "react";
// import Link from "next/link";
// import { useSafeReducedMotion } from "@/lib/motion";
// import { useInView } from "./motion/use-in-view";
import { Reveal } from "./motion/reveal";
import { CohortBanner } from "./cohort-banner";
import type { CohortCard } from "./landing-content";

type Props = {
  cards: CohortCard[];
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `cards` returns with the grid below
export function CohortsSection({ cards }: Props) {
  // const reduce = useSafeReducedMotion();
  // const gridRef = useRef<HTMLDivElement>(null);
  // const [inView, setInView] = useState(false);
  // useInView(gridRef, () => setInView(true), { threshold: 0.15 });
  //
  // const shown = reduce || inView;

  return (
    <section className="section open" id="cohorts">
      {/* Heading sits inside the normal container */}
      <div className="container" style={{ textAlign: "center" }}>
        <Reveal as="p" className="section-label">
          This is where you build.
        </Reveal>
        <Reveal as="h2" className="h2">
          Challenges, cohorts, and opportunities.
        </Reveal>
      </div>

      {/* Banner is full-bleed — it sits below the heading container */}
      <CohortBanner />

      {/* Cards grid — temporarily hidden.
      <div className="container">
        <div
          className={shown ? "open__grid is-in" : "open__grid"}
          id="openGrid"
          ref={gridRef}
        >
          {cards.map((card) => (
            <Link
              key={card.key}
              className="challenge"
              href={card.href}
              data-order={card.order}
              style={{ ["--lp-order" as string]: String(card.order) }}
            >
              <span className="challenge__badge">{card.badge}</span>
              <span className="challenge__arrow" aria-hidden="true">
                ↗
              </span>
              <h3 className="challenge__title">{card.title}</h3>
              <ul className="challenge__list">
                {card.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </Link>
          ))}
        </div>
      </div>
      */}
    </section>
  );
}
