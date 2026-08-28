"use client";

import { TESTIMONIALS } from "@/components/landing/testimonials-data";
import { useSafeReducedMotion } from "@/lib/motion";
import { Reveal } from "./motion/reveal";
import { QUOTE_TINTS } from "./landing-content";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0] + parts[1]![0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

function QuoteCard({
  name,
  org,
  quote,
  tint,
  hidden,
}: {
  name: string;
  org: string | null;
  quote: string;
  tint: (typeof QUOTE_TINTS)[number];
  hidden?: boolean;
}) {
  return (
    <article className={`quote quote--${tint}`} aria-hidden={hidden || undefined}>
      <p>“{quote}”</p>
      <footer>
        <span className="avatar">{initials(name)}</span>
        <span>
          <strong>{name}</strong>
          {org ? <small>{org}</small> : null}
        </span>
      </footer>
    </article>
  );
}

export function TestimonialsSection() {
  const reduce = useSafeReducedMotion();
  const cards = TESTIMONIALS.map((item, i) => (
    <QuoteCard
      key={item.name + i}
      name={item.name}
      org={item.org}
      quote={item.quote}
      tint={QUOTE_TINTS[i % QUOTE_TINTS.length]!}
    />
  ));

  return (
    <section className="section testimonials">
      <div className="container testimonials__head">
        <Reveal as="h2" className="h2">
          What people are saying?
        </Reveal>
        <Reveal as="p" className="p">
          Don&apos;t just take our word for it. See what our members have to
          say about their experience.
        </Reveal>
      </div>

      <div className="marquee" id="marquee">
        <div className="marquee__track" id="marqueeTrack">
          {cards}
          {reduce
            ? null
            : TESTIMONIALS.map((item, i) => (
                <QuoteCard
                  key={`dup-${item.name}-${i}`}
                  name={item.name}
                  org={item.org}
                  quote={item.quote}
                  tint={QUOTE_TINTS[i % QUOTE_TINTS.length]!}
                  hidden
                />
              ))}
        </div>
      </div>
    </section>
  );
}
