"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useSafeReducedMotion } from "@/lib/motion";
import { ScrollEngine } from "./scroll-engine";

export function useScrollScene(
  ref: RefObject<HTMLElement | null>,
  onProgress: (p: number) => void,
  { pinned = true }: { pinned?: boolean } = {},
) {
  const reduce = useSafeReducedMotion();
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  useEffect(() => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    return ScrollEngine.add(
      el,
      (p) => onProgressRef.current(p),
      pinned,
    );
  }, [ref, pinned, reduce]);
}
