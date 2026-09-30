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

/**
 * Seven parameters, seven hues.
 *
 * Five of these were the same forest green at slightly different lightness, so
 * the donut read as one teal blob and the legend swatch beside "Projects" was
 * indistinguishable from the one beside "Experience" — which is the whole job
 * of a legend. The brand teal keeps the lead slice; the rest step round the
 * wheel far enough to be told apart at swatch size, and each keeps the same
 * light/base/edge construction so the clay shading is unchanged.
 *
 * Colour is not the only cue: the exact value out of 100 is printed next to
 * every row, so a reader who cannot separate two hues loses nothing.
 *
 * Exported because the standalone report draws the same seven parameters as
 * bars rather than slices. Two encodings, one palette: a reader who sees the
 * donut in the panel and the bars on the report must not have to learn the
 * colours twice.
 */
export const SCORE_PARAMS: {
  key: keyof PublicScoreSlice;
  label: string;
  color: { base: string; lift: string; edge: string };
}[] = [
  { key: "stack", label: "Stack match", color: { base: "#03535F", lift: "#A6D2D5", edge: "#02434D" } },
  { key: "missions", label: "Missions", color: { base: "#AA821D", lift: "#FFEDB0", edge: "#8A6A17" } },
  { key: "cleanPass", label: "First-attempt", color: { base: "#18A97C", lift: "#C7F4E4", edge: "#0F7D5B" } },
  { key: "projects", label: "Projects", color: { base: "#4C5FD5", lift: "#D3D8F8", edge: "#3A49AC" } },
  { key: "consistency", label: "Commit consistency", color: { base: "#8B5CF6", lift: "#E2D9FD", edge: "#6D40D8" } },
  { key: "interview", label: "Interview", color: { base: "#B4457A", lift: "#F6D6E5", edge: "#8F3561" } },
  { key: "experience", label: "Experience", color: { base: "#4F7A21", lift: "#DCEDC2", edge: "#3D5F19" } },
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

  const rows = SCORE_PARAMS.map((p) => ({ ...p, value: scores[p.key] }));
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
