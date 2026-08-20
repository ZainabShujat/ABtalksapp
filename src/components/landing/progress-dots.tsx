"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ProgressDotsProps {
  total: number;
  current: number;
  onSelect: (index: number) => void;
}

export function ProgressDots({ total, current, onSelect }: ProgressDotsProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(i)}
          aria-label={`Go to slide ${i + 1}`}
          className="group relative h-2 cursor-pointer"
          style={{ width: i === current ? 24 : 8 }}
        >
          <motion.div
            initial={false}
            animate={{ width: i === current ? 24 : 8 }}
            transition={{ duration: 0.3 }}
            className={cn(
              "absolute inset-0 rounded-full transition-colors",
              i === current
                ? "bg-primary"
                : "bg-muted-foreground/30 group-hover:bg-muted-foreground/50"
            )}
          />
        </button>
      ))}
    </div>
  );
}
