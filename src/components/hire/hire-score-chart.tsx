"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { PublicScoreSlice } from "@/components/hire/match-card";

const SIZE = 200;
const CX = 100;
const CY = 100;
const R_OUTER = 88;
const R_INNER = 44;
const EXPLODE = 5;
const ROUND = 7;

const PARAMS: {
  key: keyof PublicScoreSlice;
  label: string;
  color: { base: string; lift: string; edge: string };
}[] = [
  { key: "stack", label: "Stack match", color: { base: "#EC6A42", lift: "#FFC2A3", edge: "#C04A22" } },
  { key: "missions", label: "Missions", color: { base: "#F2AC48", lift: "#FFE0AE", edge: "#C8821F" } },
  { key: "cleanPass", label: "First-attempt", color: { base: "#4F9DEA", lift: "#B2D9FF", edge: "#2E77BE" } },
  { key: "projects", label: "Projects", color: { base: "#35BAA6", lift: "#9AEDE1", edge: "#1D8C7B" } },
  { key: "consistency", label: "Commit consistency", color: { base: "#8C7FEC", lift: "#CFC8FF", edge: "#6355C6" } },
  { key: "interview", label: "Interview", color: { base: "#E06B9A", lift: "#FFC2D6", edge: "#B54470" } },
  { key: "experience", label: "Experience", color: { base: "#6B8AA8", lift: "#C5D7E8", edge: "#3E5C78" } },
];

function polar(r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
}

function ringPath(startDeg: number, endDeg: number, rIn: number, rOut: number) {
  const a = polar(rOut, startDeg);
  const b = polar(rOut, endDeg);
  const c = polar(rIn, endDeg);
  const d = polar(rIn, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return (
    `M${a.x.toFixed(1)},${a.y.toFixed(1)}` +
    ` A${rOut},${rOut} 0 ${large} 1 ${b.x.toFixed(1)},${b.y.toFixed(1)}` +
    ` L${c.x.toFixed(1)},${c.y.toFixed(1)}` +
    ` A${rIn},${rIn} 0 ${large} 0 ${d.x.toFixed(1)},${d.y.toFixed(1)} Z`
  );
}

/**
 * Donut of the seven ranking dimensions. Slice size is share of the combined
 * known score; a missing dimension is listed as "Not scored", never drawn as 0.
 */
export function HireScoreChart({
  scores,
  total,
}: {
  scores: PublicScoreSlice;
  total: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [formed, setFormed] = useState(
    () => typeof IntersectionObserver !== "function",
  );

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const box = entry.rootBounds;
          const scrolledPast =
            box && entry.boundingClientRect.bottom < box.top + 40;
          if (!entry.isIntersecting && !scrolledPast) continue;
          setFormed(true);
          io.disconnect();
        }
      },
      { threshold: [0, 0.4] },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const rows = PARAMS.map((p) => ({ ...p, value: scores[p.key] }));
  const known = rows.filter((r) => r.value !== null);
  if (known.length === 0) {
    return (
      <p className="hire-detail__p">
        Evaluation scores have not been recorded for this candidate yet.
      </p>
    );
  }

  const sum = known.reduce((s, r) => s + (r.value ?? 0), 0) || 1;
  const gap = 1.6;
  const numbered = rows
    .map((row, index) => ({ row, index }))
    .filter(
      (item): item is { row: (typeof rows)[number] & { value: number }; index: number } =>
        item.row.value !== null,
    );
  const sweeps = numbered.map((item) => (360 * item.row.value) / sum);
  const slices = numbered.map((item, i) => {
    const used = sweeps.slice(0, i).reduce((s, n) => s + n, 0);
    const sweep = sweeps[i]!;
    const start = used + gap;
    const end = used + sweep - gap;
    const mid = (start + end) / 2;
    const out = polar(1, mid);
    return {
      index: item.index,
      color: item.row.color,
      start,
      end,
      px: out.x * EXPLODE,
      py: out.y * EXPLODE,
      ox: out.x,
      oy: out.y,
    };
  });

  return (
    <div ref={rootRef} className={formed ? "hire-pie is-formed" : "hire-pie"}>
      <svg
        className="hire-pie__svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Candidate evaluation scores as a donut chart. Exact values out of 100 are listed beside it."
      >
        <defs>
          {slices.map((s) => (
            <linearGradient
              key={s.index}
              id={`hire-clay${s.index}`}
              x1="12%"
              y1="0%"
              x2="88%"
              y2="100%"
            >
              <stop offset="0%" stopColor={s.color.lift} />
              <stop offset="52%" stopColor={s.color.base} />
              <stop offset="100%" stopColor={s.color.edge} />
            </linearGradient>
          ))}
        </defs>
        <g transform={`translate(${CX},${CY})`}>
          {slices.map((s) => (
            <g
              key={s.index}
              className="hire-pie__slice"
              style={
                {
                  "--i": s.index,
                  "--tx": `${(s.ox * 34).toFixed(1)}px`,
                  "--ty": `${(s.oy * 34).toFixed(1)}px`,
                } as CSSProperties
              }
            >
              <g transform={`translate(${s.px.toFixed(1)},${s.py.toFixed(1)})`}>
                <path
                  className="hire-pie__wedge"
                  d={ringPath(s.start, s.end, R_INNER, R_OUTER)}
                  fill={`url(#hire-clay${s.index})`}
                  stroke={`url(#hire-clay${s.index})`}
                  strokeWidth={ROUND}
                  strokeLinejoin="round"
                  paintOrder="stroke fill"
                />
                <path
                  className="hire-pie__gloss"
                  d={ringPath(s.start, s.end, R_INNER, R_OUTER)}
                />
              </g>
            </g>
          ))}
          <circle className="hire-pie__hub" cx="0" cy="0" r={R_INNER - 9} />
          <text className="hire-pie__hubscore" x="0" y="2" textAnchor="middle">
            {total}
          </text>
          <text className="hire-pie__hubunit" x="0" y="15" textAnchor="middle">
            OUT OF 100
          </text>
        </g>
      </svg>
      <ul className="hire-pie__legend">
        {rows.map((row, index) => (
          <li
            key={row.key}
            className="hire-pie__row"
            style={
              {
                "--i": index,
                "--clay": row.color.base,
                "--clay-lift": row.color.lift,
              } as CSSProperties
            }
          >
            <span className="hire-pie__swatch" aria-hidden="true" />
            <span className="hire-pie__label">{row.label}</span>
            {row.value === null ? (
              <span className="hire-pie__value is-empty">Not scored</span>
            ) : (
              <span className="hire-pie__value">
                <b>{row.value}</b>/100
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
