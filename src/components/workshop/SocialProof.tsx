"use client";

import { useState, useEffect } from "react";
import type { RecentRegistrant } from "@/features/workshop/get-recent-registrations";

// Shown only before there are real registrations, so the ticker is never empty.
const FALLBACK: RecentRegistrant[] = [
  { name: "Ayushi", org: "ABES Engineering College" },
  { name: "Rahul", org: "IIT Delhi" },
  { name: "Priya", org: "TCS" },
  { name: "Aman", org: "BITS Pilani" },
  { name: "Sneha", org: "Infosys" },
  { name: "Vikram", org: "NIT Warangal" },
  { name: "Ananya", org: "Wipro" },
  { name: "Karan", org: "DTU" },
];

export default function SocialProof({ users }: { users?: RecentRegistrant[] }) {
  const list = users && users.length > 0 ? users : FALLBACK;
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setShow(false);
      setTimeout(() => {
        setIdx((p) => (p + 1) % list.length);
        setShow(true);
      }, 400);
    }, 4000);
    return () => clearInterval(id);
  }, [list.length]);

  const u = list[idx % list.length];

  return (
    <div className="flex justify-center">
      <div
        className="inline-flex items-center gap-2.5 rounded-full px-4 py-2"
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-green-400"
          style={{ boxShadow: "0 0 8px 1px rgba(74,222,128,0.7)", animation: "sp-pulse 2s infinite" }}
        />
        <span
          className="text-[13px] leading-none transition-opacity duration-400"
          style={{ opacity: show ? 1 : 0 }}
        >
          <span className="font-semibold text-white/90">{u.name}</span>
          {u.org ? (
            <>
              <span className="mx-1.5 text-white/35">from</span>
              <span className="font-semibold text-white/90">{u.org}</span>
            </>
          ) : null}
          <span className="ml-1.5 italic text-white/40">just joined</span>
        </span>
        <style>{`@keyframes sp-pulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
      </div>
    </div>
  );
}
