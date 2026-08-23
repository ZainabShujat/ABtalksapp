"use client";

import { useState } from "react";
import { DASHBOARD_FAQ } from "./faq-content";
import { cn } from "@/lib/utils";

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="scroll-mt-20 px-4 py-12 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[2fr_3fr] lg:gap-12">
        {/* Left column: heading + subtitle */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <h2 className="text-3xl font-fredoka font-bold leading-tight tracking-tight text-black sm:text-4xl">
            Frequently asked
            <br />
            <span className="italic text-[#e05226]">questions</span>
          </h2>
          <p className="mt-4 font-fredoka text-sm leading-relaxed text-[#555555]">
            Everything you need to know about the ABTalks 60-day challenge,
            submissions, streaks, and more.
          </p>
        </div>

        {/* Right column: accordion cards */}
        <div className="space-y-3">
          {DASHBOARD_FAQ.map((item, index) => {
            const isOpen = openIndex === index;
            const panelId = `faq-panel-${index}`;

            return (
              <div
                key={item.q}
                  className="overflow-hidden rounded-xl bg-[#F7E9E3] transition-colors duration-200 ease-[var(--ease-spark)] hover:bg-[#FFF5F0]"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold font-inter text-black transition-colors duration-200 ease-[var(--ease-spark)] hover:text-[#C9411C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#E05226]"
                >
                  {item.q}
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full bg-[#e05226] text-white transition-transform duration-200 ease-[var(--ease-spark)]",
                      isOpen && "rotate-45",
                    )}
                    aria-hidden
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M7 1v12M1 7h12"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </button>
                {isOpen ? (
                  <div
                    id={panelId}
                    className="px-5 pb-4 text-sm leading-relaxed text-[#555555]"
                  >
                    {item.a}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
