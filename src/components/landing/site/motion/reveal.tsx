"use client";

import {
  createElement,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from "react";
import { useSafeReducedMotion } from "@/lib/motion";
import { useInView } from "./use-in-view";

type RevealProps = {
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  id?: string;
} & Record<string, unknown>;

export function Reveal({
  as: Tag = "div",
  className,
  children,
  ...rest
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const reduce = useSafeReducedMotion();
  const [visible, setVisible] = useState(false);

  useInView(ref, () => setVisible(true), {
    threshold: 0.12,
    rootMargin: "0px 0px -60px",
  });

  const shown = reduce || visible;
  const classes = ["reveal", shown ? "is-visible" : "", className]
    .filter(Boolean)
    .join(" ");

  return createElement(Tag, { ref, className: classes, ...rest }, children);
}
