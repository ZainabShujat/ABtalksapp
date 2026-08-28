"use client";

import { useRef, type PointerEvent } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";

const ROWS = [
  { label: "Submitted work — 3 projects", status: "visible" },
  { label: "Rubric score — cohort 14", status: "visible" },
  { label: "Mentor review notes", status: "visible" },
  {
    label: "Name, contact, employer",
    status: "hidden until approved",
    accent: true,
  },
];

const MAX_TILT = 50;
const PARALLAX = 30;
const SPRING = { stiffness: 160, damping: 18, mass: 0.55 };

export function ConsentTiltCard() {
  const cardRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const rawGlare = useMotionValue(0);

  const x = useSpring(rawX, SPRING);
  const y = useSpring(rawY, SPRING);
  const glareOpacity = useSpring(rawGlare, SPRING);

  const rotateX = useTransform(y, [-0.5, 0.5], [MAX_TILT, -MAX_TILT]);
  const rotateY = useTransform(x, [-0.5, 0.5], [-MAX_TILT, MAX_TILT]);
  const parallaxX = useTransform(x, [-0.5, 0.5], [-PARALLAX, PARALLAX]);
  const parallaxY = useTransform(y, [-0.5, 0.5], [-PARALLAX, PARALLAX]);

  const glareX = useTransform(x, [-0.5, 0.5], [0, 100]);
  const glareY = useTransform(y, [-0.5, 0.5], [0, 100]);
  const glareBackground = useMotionTemplate`radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.12) 35%, transparent 65%)`;

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (reduce) return;
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / Math.max(1, rect.width);
    const py = (e.clientY - rect.top) / Math.max(1, rect.height);
    rawX.set(px - 0.5);
    rawY.set(py - 0.5);
    rawGlare.set(0.55);
  }

  function handlePointerLeave() {
    if (reduce) return;
    rawX.set(0);
    rawY.set(0);
    rawGlare.set(0);
  }

  return (
    <div className="hub-consent-stage">
      <motion.div
        ref={cardRef}
        className="hub-consent-card"
        style={{
          rotateX: reduce ? 0 : rotateX,
          rotateY: reduce ? 0 : rotateY,
          transformStyle: "preserve-3d",
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerLeave}
      >
        <motion.div
          className="hub-consent-glare"
          aria-hidden
          style={{
            opacity: reduce ? 0 : glareOpacity,
            background: glareBackground,
          }}
        />

        <motion.div
          className="hub-consent-parallax"
          style={{
            x: reduce ? 0 : parallaxX,
            y: reduce ? 0 : parallaxY,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 16,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ color: "#888" }}>What a company sees</span>
            <span style={{ color: "var(--hub-accent)" }}>Awaiting consent</span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--hub-lavender)",
              borderRadius: 4,
              padding: "12px",
              marginBottom: 20,
            }}
          >
            <div
              aria-hidden
              style={{
                width: 40,
                height: 40,
                borderRadius: 4,
                background: "var(--hub-border)",
                flex: "none",
              }}
            />
            <div>
              <p
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--hub-text)",
                }}
              >
                Candidate #4128
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#555" }}>
                Frontend & product · cohort 14
              </p>
            </div>
          </div>

          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {ROWS.map((row) => (
              <li
                key={row.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: "1px solid #eee",
                  fontSize: 13,
                  fontWeight: row.accent ? 600 : 400,
                }}
              >
                <span
                  style={{ color: row.accent ? "var(--hub-text)" : "#555" }}
                >
                  {row.label}
                </span>
                <span
                  style={{
                    color: row.accent ? "var(--hub-accent)" : "#888",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.status}
                </span>
              </li>
            ))}
          </ul>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 12,
              marginTop: 22,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 35,
                padding: "0 16px",
                borderRadius: 4,
                background: "var(--hub-accent)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Request access
            </span>
            <span style={{ fontSize: 12, color: "#555" }}>
              The request goes to the candidate, not to us.
            </span>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
