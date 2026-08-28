"use client";

import { motion } from "framer-motion";
import { useSafeReducedMotion } from "@/lib/motion";

const ease = [0.22, 1, 0.36, 1] as const;

export function AnimatedNode({
  active,
  accent,
  accentRgb,
}: {
  active: boolean;
  accent: string;
  accentRgb: string;
}) {
  const reduceMotion = useSafeReducedMotion();

  return (
    <motion.div
      className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full"
      initial={false}
      animate={{
        scale: active && !reduceMotion ? 1 : reduceMotion && active ? 1 : 0.92,
      }}
      transition={
        reduceMotion
          ? { duration: 0.15 }
          : { duration: 0.18, ease }
      }
    >
      <motion.div
        className="flex size-full items-center justify-center rounded-full border-[3px] bg-[radial-gradient(circle,rgba(224,82,38,1)_0%,rgba(0,0,0,1)_100%)]"
        animate={{
          borderColor: active ? accent : "#111111",
        }}
        transition={{ duration: reduceMotion ? 0 : 0.18, ease }}
        style={
          active
            ? {
                // circular neon glow only — no square box-shadow on a rect wrapper
                filter: `drop-shadow(0 0 6px rgba(${accentRgb}, 0.85)) drop-shadow(0 0 12px rgba(${accentRgb}, 0.45))`,
              }
            : undefined
        }
      >
        <motion.span
          className="size-2 rounded-full"
          animate={{
            backgroundColor: active ? accent : "rgba(255,255,255,0.15)",
            scale: active && !reduceMotion ? [1, 1.2, 1] : 1,
          }}
          transition={
            reduceMotion
              ? { duration: 0.15 }
              : { duration: 0.18, ease }
          }
        />
      </motion.div>
    </motion.div>
  );
}
