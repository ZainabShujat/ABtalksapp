"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";
import type { Components } from "react-markdown";
import {
  DaySectionCard,
} from "@/components/program/day-section-card";
import {
  programMdComponents,
  ProgramMarkdownCode,
  ProgramMarkdownPre,
} from "@/components/program/markdown-code";
import { useSafeReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MAX_VISIBLE_STEPS = 5;

const stepNavBtn =
  "inline-flex h-9 items-center justify-center rounded-[12px] border border-black bg-[#7364E6] px-4 text-sm font-bold text-white shadow-[inset_3px_3px_3px_0_rgba(0,0,0,0.5)] hover:bg-[#7364E6]/90 disabled:cursor-not-allowed disabled:opacity-40";

const pointerSpring = { type: "spring" as const, stiffness: 420, damping: 34 };
const stepSpring = { type: "spring" as const, stiffness: 380, damping: 28 };

/** Build-step prose: white body/bold/code; looser line spacing for readability. */
const buildStepMdClassName =
  "text-sm leading-7 text-white [&_a]:font-medium [&_a]:text-white [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-[#1a0a3a] [&_code]:px-1 [&_code]:text-xs [&_code]:text-white [&_li]:ml-1 [&_li]:list-disc [&_li]:leading-7 [&_li]:marker:text-[#968BEC] [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:space-y-2.5 [&_ol]:pl-5 [&_p]:mb-3 [&_p]:leading-8 [&_p]:last:mb-0 [&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-[#8365E3]/40 [&_pre]:bg-[#110528] [&_pre]:p-3 [&_pre]:text-xs [&_pre]:leading-6 [&_pre]:text-[#E9E9E9] [&_strong]:font-bold [&_strong]:text-white [&_ul]:mb-3 [&_ul]:space-y-2.5 [&_ul]:pl-5";

/**
 * Normalize step markdown for clearer reading:
 * - strip em/en dashes
 * - wrap bare URLs in backticks (click-to-copy via code chip)
 * - turn dense **Label:** / semicolon chunks into bullet lists
 */
function formatBuildStepContent(raw: string): string {
  let text = raw
    .replace(/\u2014/g, " - ")
    .replace(/—/g, " - ")
    .replace(/\u2013/g, "-")
    .replace(/–/g, "-")
    .trim();

  // Normalize mid-sentence " - " spacing only — never touch markdown list markers
  // (a prior global /\s+-\s+/g flattened `\n   - item` into one paragraph).
  text = text
    .split("\n")
    .map((line) => {
      if (/^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
        return line;
      }
      return line.replace(/\s+-\s+/g, " - ");
    })
    .join("\n");

  // Bare URLs → inline code (click-to-copy). Skip ones already in backticks.
  text = text.replace(
    /(^|[\s([{}])(https?:\/\/[^\s<>\]`)'"]+)/g,
    "$1`$2`",
  );

  if (/^\s*[-*+]\s/m.test(text) || /^\s*\d+\.\s/m.test(text)) {
    return text;
  }

  // **Label:** sections → bullets
  const labeled = text
    .split(/(?=\*\*[^*\n]+?\*\*:)/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (labeled.length >= 2) {
    return labeled.map((chunk) => `- ${chunk}`).join("\n\n");
  }

  // Long semicolon lists (e.g. RAM → command options)
  const semiParts = text.split(/\s*;\s+/).map((s) => s.trim()).filter(Boolean);
  if (semiParts.length >= 3) {
    return semiParts
      .map((part, i) => {
        const cleaned = part.replace(/\.$/, "");
        return `- ${cleaned}${i === semiParts.length - 1 && part.endsWith(".") ? "." : ""}`;
      })
      .join("\n\n");
  }

  // Sentence breaks before a new **bold** lead-in
  const boldBeats = text
    .split(/(?<=\.)\s+(?=\*\*)/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (boldBeats.length >= 2) {
    return boldBeats.map((chunk) => `- ${chunk}`).join("\n\n");
  }

  return text;
}

function CopyableLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      toast.success("Link copied");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <button
      type="button"
      title="Click to copy link"
      aria-label={`Copy link ${href}`}
      onClick={() => void copy()}
      className={cn(
        "inline max-w-full break-all font-medium text-white underline underline-offset-2 transition-colors hover:text-[#E9E9E9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#968BEC]",
        copied && "ring-2 ring-emerald-400/70",
      )}
    >
      {children}
    </button>
  );
}

const buildStepMdComponents: Components = {
  ...programMdComponents,
  code: ProgramMarkdownCode,
  pre: ProgramMarkdownPre,
  a: ({ href, children }) => {
    if (!href) return <span>{children}</span>;
    return <CopyableLink href={href}>{children}</CopyableLink>;
  },
};

/** Figma 246:20 — triple chevron pointing right (active step marker). */
function StepActiveArrow() {
  return (
    <svg
      width="60"
      height="40"
      viewBox="0 0 60 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M30.8127 15.7334C34.0034 17.683 34.0034 22.317 30.8127 24.2666L17.0558 32.6724C13.7241 34.7082 9.44883 32.3104 9.44883 28.4059V11.5942C9.44883 7.68964 13.7241 5.29178 17.0558 7.32759L30.8127 15.7334Z"
        fill="#2C1BA9"
      />
      <path
        d="M41.6788 15.7334C44.8695 17.683 44.8695 22.317 41.6788 24.2666L27.9219 32.6724C24.5902 34.7082 20.3149 32.3104 20.3149 28.4059V11.5942C20.3149 7.68964 24.5902 5.29178 27.9219 7.32759L41.6788 15.7334Z"
        fill="#503EE0"
      />
      <path
        d="M53.0174 15.7334C56.2081 17.683 56.2081 22.317 53.0174 24.2666L39.2605 32.6724C35.9288 34.7082 31.6535 32.3104 31.6535 28.4059V11.5942C31.6535 7.68964 35.9288 5.29178 39.2605 7.32759L53.0174 15.7334Z"
        fill="#7364E6"
      />
    </svg>
  );
}

/** Figma 246:14 — purple dotted connector (`stroke-dasharray: 6 6`). */
function StepDottedLine() {
  return (
    <svg
      className="mx-1 h-[2px] min-w-3 flex-1"
      viewBox="0 0 100 2"
      preserveAspectRatio="none"
      aria-hidden
    >
      <line
        x1="0"
        y1="1"
        x2="100"
        y2="1"
        stroke="#7528C9"
        strokeOpacity="0.54"
        strokeWidth="2"
        strokeDasharray="6 6"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function DayBuildSteps({ steps }: { steps: string[] }) {
  const [active, setActive] = useState(0);
  const [direction, setDirection] = useState(1);
  const reduceMotion = useSafeReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [pointerX, setPointerX] = useState<number | null>(null);

  const formattedSteps = useMemo(
    () => steps.map((step) => formatBuildStepContent(step)),
    [steps],
  );

  const windowStart = useMemo(() => {
    if (steps.length <= MAX_VISIBLE_STEPS) return 0;
    const half = Math.floor(MAX_VISIBLE_STEPS / 2);
    return Math.max(
      0,
      Math.min(active - half, steps.length - MAX_VISIBLE_STEPS),
    );
  }, [active, steps.length]);

  const visibleIndices = useMemo(
    () =>
      Array.from(
        { length: Math.min(MAX_VISIBLE_STEPS, steps.length) },
        (_, i) => windowStart + i,
      ),
    [windowStart, steps.length],
  );

  useLayoutEffect(() => {
    function updatePointer() {
      const track = trackRef.current;
      const btn = stepRefs.current.get(active);
      if (!track || !btn) return;

      const trackRect = track.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setPointerX(btnRect.left + btnRect.width / 2 - trackRect.left);
    }

    updatePointer();
    window.addEventListener("resize", updatePointer);
    return () => window.removeEventListener("resize", updatePointer);
  }, [active, windowStart, visibleIndices]);

  if (steps.length === 0) return null;

  const isFirst = active <= 0;
  const isLast = active >= steps.length - 1;

  function goToStep(next: number) {
    if (next === active) return;
    setDirection(next > active ? 1 : -1);
    setActive(next);
  }

  function handleNext() {
    if (isLast) {
      document
        .getElementById("mission-verify")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    goToStep(Math.min(active + 1, steps.length - 1));
  }

  function handleBack() {
    goToStep(Math.max(active - 1, 0));
  }

  return (
    <DaySectionCard title="Build Steps" icon="build">
      <div className="relative mb-8 min-h-[4.75rem] pt-1">
        <div
          ref={trackRef}
          className="relative flex w-full items-center justify-between gap-1"
        >
          {/* Active arrow slides along the track, replacing the circle at the current step */}
          {pointerX !== null && (
            <motion.div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2"
              initial={false}
              animate={{ left: pointerX }}
              transition={reduceMotion ? { duration: 0 } : pointerSpring}
              aria-hidden
            >
              <StepActiveArrow />
            </motion.div>
          )}

          {visibleIndices.map((stepIndex, vi) => {
            const isActive = stepIndex === active;
            const isLastVisible = vi === visibleIndices.length - 1;
            return (
              <div key={stepIndex} className="flex min-w-0 flex-1 items-start">
                <button
                  ref={(el) => {
                    if (el) stepRefs.current.set(stepIndex, el);
                    else stepRefs.current.delete(stepIndex);
                  }}
                  type="button"
                  onClick={() => goToStep(stepIndex)}
                  className="flex min-w-0 flex-1 flex-col items-center"
                  aria-current={isActive ? "step" : undefined}
                >
                  {/* Marker slot: Figma arrow 60×40; circle 20×20 centered on the dotted line */}
                  <span className="relative flex h-10 w-[60px] items-center justify-center">
                    <motion.span
                      className="size-5 rounded-full border-[3px] border-[#7528C9] bg-[#040C20]"
                      initial={false}
                      animate={{
                        opacity: isActive ? 0 : 1,
                        scale: isActive ? 0.6 : 1,
                      }}
                      transition={reduceMotion ? { duration: 0 } : stepSpring}
                      aria-hidden
                    />
                  </span>
                  <motion.span
                    className="mt-1.5 flex h-6 w-full origin-center items-center justify-center truncate text-center text-xs leading-none"
                    initial={false}
                    animate={{
                      scale: isActive && !reduceMotion ? 1.35 : 1,
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? "#D2D2D2" : "#A5A5A5",
                    }}
                    transition={reduceMotion ? { duration: 0 } : stepSpring}
                  >
                    Step {stepIndex + 1}
                  </motion.span>
                </button>
                {/* Align connector to marker midpoint (h-10 → 20px − 1px line) */}
                {!isLastVisible && (
                  <div className="mt-[19px] flex min-w-3 flex-1 items-center">
                    <StepDottedLine />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleBack}
          disabled={isFirst}
          className={stepNavBtn}
        >
          ← Back
        </button>
        <button type="button" onClick={handleNext} className={stepNavBtn}>
          {isLast ? "Done" : "Next →"}
        </button>
      </div>

      <div className="rounded-[16px] border border-[#8365E3] bg-[#110528] p-4 md:p-5">
        <motion.div
          key={`content-${active}`}
          className={cn(buildStepMdClassName, "min-h-[80px]")}
          initial={
            reduceMotion ? false : { opacity: 0, x: direction * 12 }
          }
          animate={{ opacity: 1, x: 0 }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.25, ease: "easeOut" }
          }
        >
          <ReactMarkdown components={buildStepMdComponents}>
            {formattedSteps[active] ?? ""}
          </ReactMarkdown>
        </motion.div>
      </div>
    </DaySectionCard>
  );
}
