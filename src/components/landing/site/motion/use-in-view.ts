"use client";

import { useEffect, useRef, type RefObject } from "react";

type InViewOptions = {
  threshold?: number;
  rootMargin?: string;
};

export function useInView(
  ref: RefObject<Element | null>,
  onEnter: () => void,
  options: InViewOptions = {},
) {
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const threshold = options.threshold ?? 0.2;
  const rootMargin = options.rootMargin ?? "0px 0px -40px";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      onEnterRef.current();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onEnterRef.current();
            io.unobserve(entry.target);
          }
        }
      },
      { threshold, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold, rootMargin]);
}
