"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, X } from "lucide-react";

const TOUR_KEY = "abtalks_tour_done"; // set by DashboardWalkthrough when finished
// Bump the version suffix to re-show the popup to everyone after a change.
const SEEN_KEY = "abtalks_figma_workshop_promo_v2";
// Aug 1, 2026 · 6:00 PM IST
const TARGET = new Date("2026-08-01T12:30:00Z").getTime();

const AVATARS = [
  { i: "A", g: "linear-gradient(135deg,var(--color-accent-500),var(--color-accent-500))" },
  { i: "R", g: "linear-gradient(135deg,var(--color-accent-500),var(--color-accent-400))" },
  { i: "P", g: "linear-gradient(135deg,var(--color-accent-400),var(--color-accent-500))" },
  { i: "S", g: "linear-gradient(135deg,var(--color-accent-400),var(--color-accent-600))" },
];

export function WorkshopPromoModal() {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState({ d: 0, h: 0, m: 0, s: 0 });
  const glowRef = useRef<HTMLDivElement>(null);

  function closeTemporarily() {
    setOpen(false);
  }

  function dismissPermanently() {
    localStorage.setItem(SEEN_KEY, "1");
    setOpen(false);
  }

  // Show on every refresh unless the user chose "Not interested".
  // If the first-visit walkthrough is still running, wait for it to finish.
  useEffect(() => {
    if (localStorage.getItem(SEEN_KEY)) return;

    let showTimer: ReturnType<typeof setTimeout>;
    let poll: ReturnType<typeof setInterval>;

    const show = () => {
      showTimer = setTimeout(() => setOpen(true), 3000);
    };

    const tourDone = () => !!localStorage.getItem(TOUR_KEY);

    if (tourDone()) {
      show();
    } else {
      poll = setInterval(() => {
        if (tourDone()) {
          clearInterval(poll);
          show();
        }
      }, 500);
    }

    return () => {
      clearTimeout(showTimer);
      clearInterval(poll);
    };
  }, []);

  // Lock background scroll while the popup is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // live countdown while open
  useEffect(() => {
    if (!open) return;
    const tick = () => {
      const diff = Math.max(0, TARGET - Date.now());
      setT({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [open]);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = glowRef.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.style.opacity = "1";
    el.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
  };
  const onLeave = () => {
    if (glowRef.current) glowRef.current.style.opacity = "0";
  };

  const pad = (n: number) => n.toString().padStart(2, "0");
  const units = [
    { v: t.d, l: "Days" },
    { v: t.h, l: "Hrs" },
    { v: t.m, l: "Min" },
    { v: t.s, l: "Sec" },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="wk-promo fixed inset-0 z-70 flex items-center justify-center px-4 backdrop-blur-md"
          style={{ background: "rgba(5, 10, 23, 0.72)" }}
        >
          <style>{`
            .wk-promo {
              --wk-bg: var(--color-ink-900);
              --wk-surface: var(--color-ink-900);
              --wk-text: var(--color-ink-100);
              --wk-a1: var(--color-accent-500);
              --wk-a1-rgb: 99, 102, 241;
              --wk-a1-light: var(--color-accent-400);
              --wk-a1-deep: var(--color-accent-600);
              --wk-a2: var(--color-accent-500);
              --wk-a2-rgb: 139, 92, 246;
              --wk-a3: var(--color-accent-400);
              --wk-grad: linear-gradient(135deg, var(--wk-a1) 0%, var(--wk-a2) 100%);
            }
            @keyframes wk-promo-halo { to { transform: rotate(360deg); } }
            @keyframes wk-promo-live {
              0%, 100% { opacity: 1; transform: scale(1); }
              50% { opacity: 0.45; transform: scale(0.82); }
            }
            @keyframes wk-promo-shine-text {
              0% { background-position: 200% center; }
              100% { background-position: -200% center; }
            }
            @keyframes wk-promo-cta-glow {
              0%, 100% {
                box-shadow: 0 12px 34px -10px rgba(var(--wk-a2-rgb), 0.55),
                  inset 0 1px 0 rgba(255, 255, 255, 0.25);
              }
              50% {
                box-shadow: 0 18px 44px -8px rgba(var(--wk-a2-rgb), 0.85),
                  0 0 24px 2px rgba(var(--wk-a1-rgb), 0.35),
                  inset 0 1px 0 rgba(255, 255, 255, 0.3);
              }
            }
            @keyframes wk-promo-cta-shine {
              0%, 55% { transform: translateX(-130%) skewX(-15deg); }
              100% { transform: translateX(130%) skewX(-15deg); }
            }
            .wk-promo-cta {
              position: relative;
              overflow: hidden;
              animation: wk-promo-cta-glow 2.6s ease-in-out infinite;
            }
            .wk-promo-cta::after {
              content: "";
              position: absolute;
              inset: 0;
              background: linear-gradient(
                105deg,
                transparent 40%,
                rgba(255, 255, 255, 0.38) 50%,
                transparent 60%
              );
              transform: translateX(-130%) skewX(-15deg);
              animation: wk-promo-cta-shine 3.6s ease-in-out infinite;
              pointer-events: none;
            }
            .wk-promo-cta:hover {
              transform: translateY(-2px);
            }
          `}</style>

          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.9, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-[440px]"
          >
            {/* rotating indigo/violet halo */}
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-6 rounded-[42px] opacity-50 blur-2xl"
              style={{
                background:
                  "conic-gradient(from 0deg, var(--color-accent-500), var(--color-accent-500), var(--color-accent-400), var(--color-accent-600), var(--color-accent-500))",
                animation: "wk-promo-halo 8s linear infinite",
              }}
            />

            {/* card */}
            <div
              onMouseMove={onMove}
              onMouseLeave={onLeave}
              className="relative overflow-hidden rounded-[28px] p-7 sm:p-8"
              style={{
                background:
                  "radial-gradient(120% 90% at 50% -10%, #121a33 0%, var(--wk-bg) 58%)",
                border: "1px solid rgba(255,255,255,0.09)",
                boxShadow: "0 40px 100px -30px rgba(0,0,0,0.9)",
                color: "var(--wk-text)",
              }}
            >
              {/* soft aurora orbs */}
              <div
                aria-hidden
                className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-none blur-3xl"
                style={{
                  background:
                    "radial-gradient(circle, rgba(var(--wk-a1-rgb),0.28), transparent 65%)",
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -bottom-24 -right-16 h-60 w-60 rounded-none blur-3xl"
                style={{
                  background:
                    "radial-gradient(circle, rgba(var(--wk-a2-rgb),0.22), transparent 65%)",
                }}
              />

              {/* subtle grid */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
                  backgroundSize: "40px 40px",
                  maskImage:
                    "radial-gradient(ellipse 80% 55% at 50% 0%, hsl(var(--foreground)) 35%, transparent 100%)",
                  WebkitMaskImage:
                    "radial-gradient(ellipse 80% 55% at 50% 0%, hsl(var(--foreground)) 35%, transparent 100%)",
                }}
              />

              {/* top accent line */}
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-px"
                style={{
                  background:
                    "linear-gradient(to right, transparent, rgba(var(--wk-a1-rgb),0.7), rgba(var(--wk-a2-rgb),0.7), transparent)",
                }}
              />

              {/* pointer-follow glow */}
              <div
                ref={glowRef}
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 h-[360px] w-[360px] rounded-none opacity-0 transition-opacity duration-300"
                style={{
                  marginLeft: -180,
                  marginTop: -180,
                  background:
                    "radial-gradient(circle, rgba(var(--wk-a2-rgb),0.16), transparent 60%)",
                }}
              />

              {/* close */}
              <button
                type="button"
                onClick={closeTemporarily}
                aria-label="Close"
                className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-none text-white/40 transition-colors hover:bg-white/5 hover:text-white/80"
              >
                <X className="size-4" aria-hidden />
              </button>

              <div className="relative">
                {/* live pill */}
                <span
                  className="inline-flex items-center gap-2 rounded-none px-3.5 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.18em]"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.75)",
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-none"
                    style={{
                      background: "var(--wk-a2)",
                      boxShadow: "0 0 8px 1px rgba(var(--wk-a2-rgb),0.8)",
                      animation: "wk-promo-live 1.8s ease-in-out infinite",
                    }}
                  />
                  Free Live Workshop
                </span>

                <h2 className="mt-4 font-display text-[26px] font-extrabold leading-[1.12] tracking-tight text-white sm:text-[30px]">
                  From {" "}
                  <span
                    style={{
                      background:
                        "linear-gradient(120deg, var(--wk-a1-light) 0%, var(--wk-a2) 55%, var(--wk-a3) 100%)",
                      backgroundSize: "200% auto",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                      animation: "wk-promo-shine-text 6s linear infinite",
                    }}
                  >
                    Design to Production
                  </span>{" "}
                  using AI
                </h2>

                <p className="mt-3 text-[13.5px] leading-relaxed text-white/55">
                  Learn how to design modern UIs in Figma and instantly convert
                  them into working code using Cursor with the official Figma
                  MCP. This hands-on workshop covers Figma basics, UI design
                  principles, MCP concepts, setup, AI-powered development
                  workflow, and a live demo of building a responsive application
                  from design to code.
                </p>

                {/* countdown */}
                <div className="mt-6">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">
                    Starts in
                  </p>
                  <div className="flex items-center gap-2">
                    {units.map((u, i) => (
                      <div key={u.l} className="flex items-center gap-2">
                        <div
                          className="flex min-w-[52px] flex-col items-center rounded-xl px-2 py-2"
                          style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            backdropFilter: "blur(6px)",
                          }}
                        >
                          <span className="font-mono text-lg font-bold tabular-nums text-white">
                            {pad(u.v)}
                          </span>
                          <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-widest text-white/35">
                            {u.l}
                          </span>
                        </div>
                        {i < units.length - 1 && (
                          <span className="text-white/20">:</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                

                {/* CTA */}
                <Link
                  href="/ai-workshop"
                  onClick={closeTemporarily}
                  className="wk-promo-cta group relative mt-7 flex w-full items-center justify-center gap-2 rounded-none py-3.5 text-[15px] font-semibold text-white transition-transform duration-200"
                  style={{ background: "var(--wk-grad)" }}
                >
                  <span className="relative z-10">Register now</span>
                  <ArrowRight
                    className="relative z-10 size-4 transition-transform group-hover:translate-x-1"
                    aria-hidden
                  />
                </Link>

                <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-white/30">
                  <span>Live on YouTube</span>
                  <span className="text-white/15">•</span>
                  <span>Limited seats</span>
                </div>

                <button
                  type="button"
                  onClick={dismissPermanently}
                  className="mt-4 w-full text-center text-[12.5px] font-medium text-white/35 transition-colors hover:text-white/60"
                >
                  Not interested
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
