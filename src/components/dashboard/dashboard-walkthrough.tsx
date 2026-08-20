"use client";

import { useCallback, useEffect, useState } from "react";

const STEPS = [
  {
    selector: '[aria-label="View your synergy and open rewards"]',
    title: "Synergy Points",
    body: "Earn Synergy by completing daily challenges, then redeem it for rewards in the Marketplace.",
  },
  {
    selector: '[href="/jobs"]',
    title: "Explore Opportunities",
    body: "Browse and apply for jobs that match your skills, and get discovered by recruiters.",
  },
  {
    selector: '[href="/profile"], [aria-label="Open profile menu"]',
    title: "Your Profile",
    body: "Track your progress, showcase your work, and keep your details ready for recruiters.",
  },
];

const TOUR_KEY = "abtalks_tour_done";
const PAD = 10;
const TOOLTIP_W = 264;

type Rect = { top: number; left: number; width: number; height: number };

// Pick the first *visible* element matching the selector (handles responsive
// duplicates like header nav vs. mobile bottom nav where one is display:none).
function findVisible(selector: string): HTMLElement | null {
  const els = Array.from(
    document.querySelectorAll(selector),
  ) as HTMLElement[];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export function DashboardWalkthrough() {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [mounted, setMounted] = useState(false);
  const [done, setDone] = useState(false);

  const measure = useCallback((s: number) => {
    const el = findVisible(STEPS[s]?.selector ?? "");
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, []);

  useEffect(() => {
    if (localStorage.getItem(TOUR_KEY)) {
      setDone(true);
      return;
    }
    // Wait 1.5s after load so the page settles before the tour appears.
    const t = setTimeout(() => {
      setMounted(true);
      measure(0);
    }, 1500);
    return () => clearTimeout(t);
  }, [measure]);

  useEffect(() => {
    if (mounted && !done) measure(step);
  }, [step, mounted, done, measure]);

  useEffect(() => {
    if (!mounted || done) return;
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => measure(step), 100);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(t);
    };
  }, [mounted, done, step, measure]);

  const finish = useCallback(() => {
    localStorage.setItem(TOUR_KEY, "1");
    setDone(true);
  }, []);

  const next = useCallback(() => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else finish();
  }, [step, finish]);

  if (!mounted || done || !rect) return null;

  const { top, left, width, height } = rect;
  const bottom = top + height;
  const right = left + width;
  const isLast = step === STEPS.length - 1;

  // Spotlight ring geometry, clamped to stay fully inside the viewport so no
  // border gets clipped when the target sits near a screen edge (e.g. the
  // profile button at the very top of the header).
  const EDGE = 6;
  const ringTop = Math.max(top - PAD, EDGE);
  const ringLeft = Math.max(left - PAD, EDGE);
  const ringRight = Math.min(right + PAD, window.innerWidth - EDGE);
  const ringBottom = Math.min(bottom + PAD, window.innerHeight - EDGE);
  const ringW = ringRight - ringLeft;
  const ringH = ringBottom - ringTop;

  const spaceBelow = window.innerHeight - bottom - PAD;
  const above = spaceBelow < 190;

  const targetCenterX = left + width / 2;
  let ttLeft = targetCenterX - TOOLTIP_W / 2;
  ttLeft = Math.max(12, Math.min(ttLeft, window.innerWidth - TOOLTIP_W - 12));

  // Arrow x-position relative to the tooltip card, clamped to stay on-card.
  const arrowLeft = Math.max(20, Math.min(targetCenterX - ttLeft, TOOLTIP_W - 20));

  const EASE = "cubic-bezier(0.22,1,0.36,1)";
  const MOVE = `0.45s ${EASE}`;

  const panelStyle = (s: React.CSSProperties): React.CSSProperties => ({
    position: "fixed",
    background: "rgba(3,6,15,0.68)",
    zIndex: 9998,
    pointerEvents: "auto",
    cursor: "default",
    transition: `top ${MOVE}, left ${MOVE}, right ${MOVE}, bottom ${MOVE}, width ${MOVE}, height ${MOVE}`,
    ...s,
  });

  const CARD_BG = "rgba(20,25,40,0.78)";
  const CARD_BORDER = "rgba(255,255,255,0.12)";
  const GLASS = "blur(24px) saturate(160%)";

  return (
    <>
      <style>{`
        @keyframes tour-swap {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .tour-content { animation: tour-swap 0.32s cubic-bezier(0.22,1,0.36,1) both; }
        .tour-dot { transition: width 0.3s ease, background 0.3s ease; }
      `}</style>
      {/* Overlay panels around the spotlight — block interaction but do NOT
          dismiss on outside tap; only Skip / Next / Done can close the tour. */}
      <div style={panelStyle({ top: 0, left: 0, right: 0, height: Math.max(0, top - PAD) })} />
      <div style={panelStyle({ top: bottom + PAD, left: 0, right: 0, bottom: 0 })} />
      <div style={panelStyle({ top: top - PAD, left: 0, width: Math.max(0, left - PAD), height: height + PAD * 2 })} />
      <div style={panelStyle({ top: top - PAD, left: right + PAD, right: 0, height: height + PAD * 2 })} />

      {/* Spotlight ring */}
      <div
        style={{
          position: "fixed",
          top: ringTop,
          left: ringLeft,
          width: ringW,
          height: ringH,
          borderRadius: 14,
          border: "1.5px solid rgba(20,184,166,0.7)",
          boxShadow: "0 0 0 3px rgba(20,184,166,0.18), 0 0 24px 4px rgba(20,184,166,0.28)",
          zIndex: 9999,
          pointerEvents: "none",
          transition: `top ${MOVE}, left ${MOVE}, width ${MOVE}, height ${MOVE}`,
        }}
      />

      {/* Tooltip */}
      <div
        style={{
          position: "fixed",
          top: above ? undefined : bottom + PAD + 12,
          bottom: above ? window.innerHeight - (top - PAD - 12) : undefined,
          left: ttLeft,
          width: TOOLTIP_W,
          zIndex: 10000,
          pointerEvents: "auto",
          transition: `top ${MOVE}, left ${MOVE}, bottom ${MOVE}`,
        }}
      >
        {/* Arrow pointer */}
        <div
          style={{
            position: "absolute",
            left: arrowLeft - 7,
            transition: `left ${MOVE}`,
            top: above ? undefined : -6,
            bottom: above ? -6 : undefined,
            width: 14,
            height: 14,
            background: CARD_BG,
            backdropFilter: GLASS,
            WebkitBackdropFilter: GLASS,
            borderTop: above ? "none" : `1px solid ${CARD_BORDER}`,
            borderLeft: above ? "none" : `1px solid ${CARD_BORDER}`,
            borderBottom: above ? `1px solid ${CARD_BORDER}` : "none",
            borderRight: above ? `1px solid ${CARD_BORDER}` : "none",
            transform: "rotate(45deg)",
          }}
        />
        <div
          style={{
            position: "relative",
            background: CARD_BG,
            backdropFilter: GLASS,
            WebkitBackdropFilter: GLASS,
            border: `1px solid ${CARD_BORDER}`,
            borderRadius: 18,
            padding: "13px 18px 11px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.45), 0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)",
            display: "flex",
            flexDirection: "column",
            gap: 5,
          }}
        >
          <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 1 }}>
            {STEPS.map((_, i) => (
              <span
                key={i}
                className="tour-dot"
                style={{
                  height: 5,
                  width: i === step ? 16 : 5,
                  borderRadius: 100,
                  background:
                    i === step
                      ? "linear-gradient(135deg, #6b7ad4, #4b5aa8)"
                      : "rgba(255,255,255,0.16)",
                }}
              />
            ))}
          </div>
          <div key={step} className="tour-content" style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <p style={{ fontSize: 18, fontWeight: 800, color: "#ffffff", margin: 0, letterSpacing: "-0.01em", lineHeight: 1.15 }}>
              {STEPS[step].title}
            </p>
            <p style={{ fontSize: 12.5, color: "#98a2b3", margin: 0, lineHeight: 1.5 }}>
              {STEPS[step].body}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 3 }}>
            <button
              onClick={finish}
              style={{ fontSize: 13, color: "#6b7688", background: "none", border: "none", cursor: "pointer", padding: "6px 4px", fontWeight: 500 }}
            >
              Skip
            </button>
            <button
              onClick={next}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.filter = "brightness(1.12)";
                e.currentTarget.style.boxShadow =
                  "0 6px 22px rgba(50,68,170,0.55), 0 0 26px 4px rgba(80,105,225,0.35), inset 0 1px 0 rgba(255,255,255,0.2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.filter = "brightness(1)";
                e.currentTarget.style.boxShadow =
                  "0 4px 16px rgba(50,68,170,0.5), 0 0 20px 2px rgba(80,105,225,0.28), inset 0 1px 0 rgba(255,255,255,0.16)";
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 22px",
                borderRadius: 100,
                border: "1px solid rgba(135,155,235,0.42)",
                background: "linear-gradient(135deg, #4b5aa8 0%, #2b3670 100%)",
                boxShadow: "0 4px 16px rgba(50,68,170,0.5), 0 0 20px 2px rgba(80,105,225,0.28), inset 0 1px 0 rgba(255,255,255,0.16)",
                color: "#f0f3ff",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                letterSpacing: "0.01em",
                transition: "transform 0.18s ease, filter 0.18s ease, box-shadow 0.18s ease",
              }}
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
