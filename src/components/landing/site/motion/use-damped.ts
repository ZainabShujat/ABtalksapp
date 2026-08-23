"use client";

import { useCallback, useEffect, useRef } from "react";

export function useDamped(
  smooth: number,
  epsilon: number,
  paint: (value: number) => void,
) {
  const valueRef = useRef(0);
  const targetRef = useRef(0);
  const runningRef = useRef(false);
  const rafRef = useRef(0);
  const paintRef = useRef(paint);
  paintRef.current = paint;

  const tick = useCallback(() => {
    const delta = targetRef.current - valueRef.current;
    if (Math.abs(delta) < epsilon) {
      valueRef.current = targetRef.current;
      paintRef.current(valueRef.current);
      runningRef.current = false;
      return;
    }
    valueRef.current += delta * smooth;
    paintRef.current(valueRef.current);
    rafRef.current = window.requestAnimationFrame(tick);
  }, [smooth, epsilon]);

  const setTarget = useCallback(
    (value: number) => {
      targetRef.current = value;
      if (!runningRef.current) {
        runningRef.current = true;
        rafRef.current = window.requestAnimationFrame(tick);
      }
    },
    [tick],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      runningRef.current = false;
    };
  }, []);

  return setTarget;
}
