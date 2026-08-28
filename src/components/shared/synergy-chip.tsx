"use client";

import Link from "next/link";
import { Flame } from "lucide-react";
import { useSynergy } from "@/components/shared/synergy-provider";

export function SynergyChip() {
  const { points } = useSynergy();

  return (
    <Link
      href="/marketplace"
      aria-label="View your synergy and open rewards"
      className="synergy-glow inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary shadow-sm transition-colors hover:bg-primary/25"
    >
      <Flame className="size-3.5" aria-hidden />
      <span className="tabular-nums">{points ?? "…"}</span>
    </Link>
  );
}
