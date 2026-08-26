"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const CLAUDE_FAQS = [
  {
    question: "Is purchasing a Claude subscription mandatory for this challenge?",
    answer:
      "No, purchasing a Claude subscription is not mandatory. Throughout the 60-day journey, we'll guide you on continuing your learning even if free-tier token limits are exhausted. We'll also help you explore alternative AI platforms so you can progress without interruptions. A subscription may improve workflow efficiency but is entirely optional.",
  },
  {
    question: "Do I need to create a Claude account?",
    answer:
      "Yes, we strongly recommend creating a Claude account for the best experience. We also encourage creating accounts on ChatGPT, Google Gemini, and other AI productivity tools. Using multiple platforms helps you compare outputs, explore different capabilities, and build broader AI tool familiarity.",
  },
  {
    question: "Where can I find the daily task?",
    answer: "Daily tasks are available on the challenge dashboard.",
  },
  {
    question: "Will I receive daily tasks or teaching sessions?",
    answer:
      "Starting June 1, 2026, you'll receive daily AI-based tasks through the ABTalks platform: Claude AI implementation, prompt engineering, AI productivity, and real-world workflows. You're expected to complete tasks consistently, share learnings on LinkedIn daily, and maintain discipline. Detailed walkthroughs are available on the ABTalks on AI YouTube channel.",
  },
  {
    question: "What if I miss a day's task?",
    answer:
      "If you miss a task, don't worry. ABTalks provides a 5-day submission window, allowing you to complete and submit any missed tasks from the previous five days through the challenge dashboard.",
  },
  {
    question: "Will I receive goodies after completing the challenge?",
    answer:
      "Yes. Participants who successfully complete the 60-day challenge with consistency, dedication, and daily engagement may receive goodies, rewards, and recognition from the ABTalks team. The challenge is designed to reward commitment and continuous learning.",
  },
  {
    question: "Who should I contact if I have an issue with a task?",
    answer:
      "Reach out to the ABTalks support team(Admins) through the official WhatsApp group. You can also share your query on Discord dicussion group in the 60 Days Claude Challenge Category.",
  },
  {
    question: "Is there any YouTube channel for the Claude Challenge?",
    answer:
      "The ABTalks On AI YouTube channel provides detailed task explanations, step-by-step guidance, complete walkthroughs, and concept clarification videos to help you continue progressing smoothly throughout the challenge.",
  },
  {
    question: "Will we explore different AI tools during the challenge?",
    answer:
      "Yes, participants will be introduced to various AI tools, resources, and opportunities throughout the challenge.",
  },
  {
    question: "Can I use tools other than Claude for the challenge?",
    answer:
      "Unless a task specifically requires a particular tool, you are encouraged to explore and learn from different AI tools. Always check the task instructions for any tool-specific requirements",
  },
] as const;

function renderAnswerWithInlineUrls(text: string) {
  const urlPattern = /https?:\/\/[^\s,]+/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(urlPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index));
    }
    parts.push(
      <code
        key={index}
        className="rounded bg-[#FFECE3] px-1 py-0.5 font-mono text-xs text-[#C9411C]"
      >
        {match[0]}
      </code>,
    );
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

/** FAQ accordion body for embedding inside ClaudeChallengeView. */
export function ClaudeFaqBody() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      {CLAUDE_FAQS.map((faq, i) => (
        <div
          key={faq.question}
          className={cn(
            "overflow-hidden rounded-[12px] border border-[#E0E0E0] bg-[#FBF9F7]",
            openIndex === i && "bg-white",
          )}
        >
          <button
            type="button"
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-[#FFF5F0]"
            aria-expanded={openIndex === i}
          >
            <span className="flex-1 text-sm font-medium text-[#111111]">
              {faq.question}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-[#8F8F8F] transition-transform",
                openIndex === i && "rotate-180",
              )}
            />
          </button>
          {openIndex === i ? (
            <div className="px-4 pb-4 text-sm leading-relaxed text-[#4B4B4B]">
              {renderAnswerWithInlineUrls(faq.answer)}
            </div>
          ) : null}
        </div>
      ))}

      <div className="mt-4 rounded-[12px] border border-[#E0E0E0] bg-[#FBF9F7] p-4">
        <p className="text-xs text-[#8F8F8F]">
          Still have questions? Reach out via the{" "}
          <a
            href="https://chat.whatsapp.com/LSru1BgvifpEB4OMZsaZEi"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#E05226] hover:underline"
          >
            WhatsApp community
          </a>{" "}
          or check the{" "}
          <a
            href="https://www.youtube.com/@ABTalksonAI"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#E05226] hover:underline"
          >
            ABTalks on AI YouTube channel
          </a>
          .
        </p>
      </div>
    </div>
  );
}

/** Standalone FAQ card (pre-start dashboard). */
export function ClaudeFAQ() {
  return (
    <section className="rounded-[12px] border border-[#E0E0E0] bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <div className="mb-6">
        <h2 className="font-heading text-xl font-semibold text-[#111111]">
          Frequently Asked Questions
        </h2>
        <p className="mt-1 text-xs text-[#8F8F8F]">
          Everything you need to know
        </p>
      </div>
      <ClaudeFaqBody />
    </section>
  );
}
