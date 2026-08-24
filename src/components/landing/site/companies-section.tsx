"use client";

import { useSafeReducedMotion } from "@/lib/motion";
import { COMPANY_LOGOS } from "./landing-content";

/** Repeat the set so one group is wider than the viewport on most screens. */
const LOOP_SET = [...COMPANY_LOGOS, ...COMPANY_LOGOS] as const;

function LogoGroup({ hidden }: { hidden?: boolean }) {
  return (
    <div className="companies__group" aria-hidden={hidden || undefined}>
      {LOOP_SET.map((logo, i) => (
        <img
          key={`${hidden ? "b" : "a"}-${logo.name}-${i}`}
          src={logo.src}
          alt={hidden ? "" : logo.name}
          className="companies__logo"
          width={120}
          height={32}
        />
      ))}               
    </div>
  );
}

export function CompaniesSection() {
  const reduce = useSafeReducedMotion();

  return (
    <section className="section companies" aria-label="Companies">
      <div className="container companies__head">
        <h2 className="companies__title">USED BY PROFESSIONALS FROM</h2>
      </div>

      <div className="companies__marquee">
        <div className="companies__track">
          <LogoGroup />
          {reduce ? null : <LogoGroup hidden />}
        </div>
      </div>
    </section>
  );
}
