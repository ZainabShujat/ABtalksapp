import Image from "next/image";
import { TestimonialsScroller } from "@/components/landing/testimonials-scroller";
import {
  TESTIMONIALS,
  type Testimonial,
} from "@/components/landing/testimonials-carousel";

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

function TestimonialCard({ name, org, photo, quote }: Testimonial) {
  return (
    <figure className="flex h-auto w-[300px] shrink-0 snap-start flex-col rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:w-[360px]">
      <span
        className="font-heading text-4xl leading-none text-neutral-300"
        aria-hidden
      >
        &rdquo;
      </span>
      <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-[#555555]">
        {quote}
      </blockquote>
      <figcaption className="mt-5 flex items-center gap-3 border-t border-neutral-100 pt-4">
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
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 font-heading text-sm font-bold text-neutral-700"
            aria-hidden
          >
            {initials(name)}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-inter text-sm font-bold text-black">
            {name}
          </p>
          {org ? (
            <p className="truncate text-xs text-[#555555]">{org}</p>
          ) : null}
        </div>
      </figcaption>
    </figure>
  );
}

export function TestimonialsSection() {
  return (
    <section id="testimonials" className="scroll-mt-20 py-8">
      <div className="px-4 sm:px-6 lg:ml-4">
        <h2 className="font-heading text-xl font-semibold uppercase text-[#e05226] lg:ml-4">
          WHAT STUDENTS SAY
        </h2>
      </div>
      <TestimonialsScroller>
        {TESTIMONIALS.map((testimonial) => (
          <TestimonialCard key={testimonial.name} {...testimonial} />
        ))}
      </TestimonialsScroller>
    </section>
  );
}
