"use client";

import { useState, type ComponentPropsWithoutRef } from "react";
import type { Components } from "react-markdown";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function useCopyCode() {
  const [copied, setCopied] = useState(false);

  async function copy(text: string) {
    const value = text.replace(/\n$/, "");
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  }

  return { copied, copy };
}

/** Inline Notion-style chip; fenced blocks defer copy to `ProgramMarkdownPre`. */
export function ProgramMarkdownCode({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"code">) {
  const { copied, copy } = useCopyCode();
  const text = String(children).replace(/\n$/, "");
  const isBlock = Boolean(className);

  if (isBlock) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return (
    <button
      type="button"
      title="Click to copy"
      aria-label={`Copy ${text}`}
      onClick={() => void copy(text)}
      className={cn(
        "mx-0.5 inline-flex max-w-full items-center rounded-[4px] border border-white/15 bg-white/10 px-1.5 py-0.5 align-baseline font-mono text-[0.85em] leading-snug text-[#E8E6E3] transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#968BEC]",
        copied && "ring-2 ring-emerald-400/70",
      )}
    >
      {text}
    </button>
  );
}

export function ProgramMarkdownPre({
  children,
  className,
  onClick,
  onKeyDown,
  ...props
}: ComponentPropsWithoutRef<"pre">) {
  const { copied, copy } = useCopyCode();

  function handleCopy(el: HTMLElement) {
    void copy(el.innerText);
  }

  return (
    <pre
      {...props}
      title="Click to copy"
      role="button"
      tabIndex={0}
      className={cn(
        className,
        "cursor-pointer transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#968BEC]",
        copied && "ring-2 ring-emerald-400/50",
      )}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) handleCopy(e.currentTarget);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCopy(e.currentTarget);
        }
      }}
    >
      {children}
    </pre>
  );
}

export const programMdComponents: Components = {
  code: ProgramMarkdownCode,
  pre: ProgramMarkdownPre,
};
