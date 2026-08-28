import Image from "next/image";
import { TestimonialsScroller } from "./testimonials-scroller";
import {
  TESTIMONIALS,
  type Testimonial,
} from "./testimonials-data";

export type { Testimonial };
export { TESTIMONIALS };

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

function TestimonialCard({ name, org, photo, quote }: Testimonial) {
  return (
    <figure className="flex h-auto w-[300px] shrink-0 snap-start flex-col rounded-2xl border border-border/60 bg-card/60 p-6 shadow-card backdrop-blur-md sm:w-[360px]">
      <span
        className="font-display text-4xl leading-none text-primary/40"
        aria-hidden
      >
        &rdquo;
      </span>
      <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
        {quote}
      </blockquote>
      <figcaption className="mt-5 flex items-center gap-3 border-t border-border/60 pt-4">
        {photo ? (
          <Image
            src={photo}
            alt=""
            width={44}
            height={44}
            loading="lazy"
            className="h-11 w-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-display text-sm font-bold text-primary"
            aria-hidden
          >
            {initials(name)}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-bold text-foreground">
            {name}
          </p>
          {org ? <p className="truncate text-xs text-muted-foreground">{org}</p> : null}
        </div>
      </figcaption>
    </figure>
  );
}

export function TestimonialsCarousel() {
  return (
    <section
      aria-label="What our builders say"
      className="relative pb-20 md:pb-24"
    >
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <div className="text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            What our builders say
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
            Real stories from students and professionals who finished the 60-Day
            Claude Challenge.
          </p>
        </div>
      </div>

      <TestimonialsScroller>
        {TESTIMONIALS.map((testimonial) => (
          <TestimonialCard key={testimonial.name} {...testimonial} />
        ))}
      </TestimonialsScroller>
    </section>
  );
}
