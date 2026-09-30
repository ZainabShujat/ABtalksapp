import type { CSSProperties, ReactNode } from "react";
// The builder's styles live in the recruiter desk stylesheet. Every rule it
// uses is scoped to .hire-assess* classes, so nothing leaks into admin.
import "@/app/hire/hire-scout.css";

/**
 * Plan 166 — hosts the shared assessment builder on admin pages.
 *
 * Deliberately NOT `.hire-app`: that class is the recruiter desk's page shell
 * (flex column, full-viewport min-height, its own background), which fights
 * admin's internally scrolling <main>. The builder only needs the desk's
 * colour tokens, so they are set here and nothing else.
 *
 * The width/margin overrides use `!` because hire-scout.css is unlayered and
 * would otherwise beat Tailwind's layered utilities.
 */
const BUILDER_TOKENS = {
  "--h-primary": "#03535F",
  "--h-primary-hover": "#076573",
  "--h-peach": "#E7F2F3",
  "--h-peach-wash": "#EEF6F6",
  "--h-ink": "#000000",
  "--h-gray-700": "#626262",
  "--h-gray-600": "#787878",
  "--h-gray-500": "#8f8f8f",
  "--h-gray-400": "#a5a5a5",
  "--h-border": "#E9E9E9",
  "--h-surface": "#ffffff",
  "--h-pill": "#F4F4F4",
  "--ease": "cubic-bezier(0.4, 0, 0.2, 1)",
} as CSSProperties;

export function PlatformBuilderFrame({ children }: { children: ReactNode }) {
  return (
    <div
      style={BUILDER_TOKENS}
      className="text-black [&_.hire-assess]:m-0! [&_.hire-assess]:w-full!"
    >
      {children}
    </div>
  );
}
