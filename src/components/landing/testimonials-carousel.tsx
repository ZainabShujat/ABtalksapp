import Image from "next/image";
import { TestimonialsScroller } from "./testimonials-scroller";

export type Testimonial = {
  name: string;
  org: string | null;
  /** Square crop in `public/testimonials/`. Null renders an initials avatar. */
  photo: string | null;
  quote: string;
};

export const TESTIMONIALS: Testimonial[] = [
  {
    name: "Samridhi Gupta",
    org: "Axis Institute of Technology and Management, Kanpur",
    photo: "/testimonials/samridhi-gupta.webp",
    quote:
      "The 60-Day Claude Challenge reshaped how I approach both AI and discipline. I learned prompt engineering from the ground up, but the real transformation was consistency. Sixty days later, I don't just write better prompts, I finish what I start.",
  },
  {
    name: "Vivek",
    org: "IT Leader · 20+ years of industry experience",
    photo: "/testimonials/vivek.webp",
    quote:
      "I wasn't looking for another certificate. I was looking for a new way of thinking. With over 20 years in IT leadership, stepping into Generative AI made me feel like a beginner again, and honestly that was the best part. The challenge may have ended, but my AI journey has just begun.",
  },
  {
    name: "Lakshay",
    org: null,
    photo: "/testimonials/lakshay.webp",
    quote:
      "60 days ago, I used AI mainly for everyday questions. Today I use it to build complete projects, craft professional resumes, automate workflows, and solve real-world problems. It completely changed the way I think about and use AI.",
  },
  {
    name: "Rida Khan",
    org: "AI Enthusiast",
    photo: "/testimonials/rida-khan.webp",
    quote:
      "I joined with curiosity, but also with doubts about whether I could stay consistent for all 60 days. To my surprise, I did it. This wasn't just a 60-day challenge. It was a journey that taught me consistency can turn uncertainty into achievement.",
  },
  {
    name: "Devpal Singh Anand",
    org: null,
    photo: "/testimonials/devpal-singh-anand.webp",
    quote:
      "From exploring AI concepts to building production-ready projects, every challenge strengthened my technical skills and encouraged me to think like an engineer. Today AI isn't just something I learn. It's a tool I use to solve meaningful problems.",
  },
  {
    name: "Nandika Sharma",
    org: "IMS Noida",
    photo: "/testimonials/nandika-sharma.webp",
    quote:
      "More than just creating projects, I learned the art of prompt engineering: how to give clear instructions and solve complex problems step by step. ABTalks didn't just teach me AI, it empowered me to build the future with it.",
  },
  {
    name: "Komal Goswami",
    org: "MPGI Kanpur",
    photo: "/testimonials/komal-goswami.webp",
    quote:
      "Joining the ABTalks 60-Day Claude AI Challenge transformed my AI journey. I mastered prompt engineering, learned to build smarter with AI, and gained the confidence to solve real-world problems.",
  },
  {
    name: "Yashaswani Singh",
    org: "AI Enthusiast",
    photo: "/testimonials/yashaswani-singh.webp",
    quote:
      "What started as curiosity about AI soon became a daily habit of learning, building, and improving. More than technical skills, I gained a growth mindset: the confidence to embrace new technologies and keep learning every day.",
  },
  {
    name: "Divya",
    org: "Aspiring Software Developer",
    photo: "/testimonials/divya.webp",
    quote:
      "I gained hands-on experience in prompt engineering, AI tools, automation, Git & GitHub, and building real-world AI-powered projects. Every challenge encouraged me to think critically, build with confidence, and continuously improve.",
  },
];

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
