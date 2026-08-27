/**
 * Collision-free placement for the "What You'll Learn" capsule scatter.
 *
 * The Figma slots (node 1:167) were hand-spaced around the LinkedIn workshop's
 * own labels. Different labels are different widths, so reusing those exact
 * positions no longer guarantees clear space between capsules. This keeps each
 * slot's rotation, colour and drop delay — the composition's character — but
 * recomputes the positions so nothing overlaps.
 *
 * Everything here is a pure function of constant input, so the result is
 * identical on the server and the client: no hydration mismatch, no layout
 * pass, no measuring in the browser.
 */

export const CANVAS_W = 1920;
export const CANVAS_H = 700;

/** Capsule height, from the design. */
export const CAP_H = 62;
const CAP_R = CAP_H / 2;
/** Horizontal padding inside a capsule (Tailwind `px-8`, both sides). */
const PAD_X = 64;
/** Minimum clear space required between any two capsules. */
const GAP = 14;
/** Clear space kept between a capsule and the canvas edge. */
const MARGIN = 12;
/**
 * Capsules stay below this line. The heading (top 47) and subtitle (top 117)
 * share the canvas, and the design's own capsules start at y=217.
 */
const TOP_BOUND = 200;

/**
 * The eleven slots from Figma node 1:167 — rotation, skew, colours, and the
 * drop delay lifted from the motion timeline (nodes 1:169…1:189), where each
 * capsule lands 60ms after the previous one in an order authored to fill the
 * field from the middle outward.
 *
 * `x`/`y` are the design's own positions, used only as the solver's starting
 * point, and `w` only as a ranking hint for how much room a slot has.
 */
export const SLOTS = [
  { x: 355.79, y: 338.69, rot: 12.55, skew: -1.56, bg: "#c9411c", fg: "#ffffff", w: 678.737, delay: 0.08 },
  { x: 948.63, y: 334.55, rot: -28.6, skew: 3.01, bg: "#ffece3", fg: "#111111", w: 520.963, delay: 0.62 },
  { x: 1430.64, y: 217, rot: 42.17, skew: -3.47, bg: "#fff1e9", fg: "#111111", w: 431.259, delay: 0 },
  { x: 486.85, y: 553.93, rot: -3.13, skew: 0.4, bg: "#e05226", fg: "#ffffff", w: 443.532, delay: 0.56 },
  { x: 789.42, y: 337.86, rot: -3.02, skew: 0.39, bg: "#a93617", fg: "#ffffff", w: 483.472, delay: 0.14 },
  { x: 1237.14, y: 487.7, rot: 7.47, skew: -0.95, bg: "#fff5f0", fg: "#111111", w: 537.795, delay: 0.38 },
  { x: 1122.79, y: 564.69, rot: -0.47, skew: 0.06, bg: "#c9411c", fg: "#ffffff", w: 222.148, delay: 0.5 },
  { x: 259.91, y: 463.69, rot: 2.86, skew: -0.37, bg: "#fff1e9", fg: "#111111", w: 486.564, delay: 0.32 },
  { x: 157, y: 365.18, rot: -17.27, skew: 2.07, bg: "#a93617", fg: "#ffffff", w: 186.667, delay: 0.26 },
  { x: 248.48, y: 541.51, rot: 6.4, skew: -0.82, bg: "#ffece3", fg: "#111111", w: 208.652, delay: 0.44 },
  { x: 1418.33, y: 391.67, rot: 24.41, skew: -2.72, bg: "#e05226", fg: "#ffffff", w: 229.131, delay: 0.2 },
] as const;

/**
 * Approximate advance width of `text` at 24px Instrument Sans Medium.
 *
 * Deliberately a shade generous: this estimate becomes the capsule's actual
 * rendered width, so overestimating costs a few pixels of padding while
 * underestimating would crop a `whitespace-nowrap` label.
 */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    if ("iljtI.,'!|:;".includes(ch)) w += 7;
    else if ("fr()[]- ".includes(ch)) w += 9;
    else if ("MWmw@".includes(ch)) w += 20;
    else if (ch >= "A" && ch <= "Z") w += 15.5;
    else if (ch >= "0" && ch <= "9") w += 13.5;
    else w += 13;
  }
  return w;
}

export const capsuleWidth = (text: string) => Math.round(textWidth(text)) + PAD_X;

export interface Placed {
  text: string;
  /** Left/top of the capsule box, in canvas units. */
  x: number;
  y: number;
  w: number;
  rot: number;
  skew: number;
  bg: string;
  fg: string;
  delay: number;
}

interface Pill {
  cx: number;
  cy: number;
  w: number;
  rot: number;
}

/** Half-length of the pill's core segment (the part that is not the end caps). */
const halfSeg = (p: Pill) => Math.max(0, p.w / 2 - CAP_R);

const endpoints = (p: Pill) => {
  const t = (p.rot * Math.PI) / 180;
  const a = halfSeg(p);
  const dx = Math.cos(t) * a;
  const dy = Math.sin(t) * a;
  return { x0: p.cx - dx, y0: p.cy - dy, x1: p.cx + dx, y1: p.cy + dy };
};

/**
 * Closest points between two line segments. A rotated rounded capsule is
 * exactly "all points within CAP_R of its core segment", so segment distance
 * gives true capsule-to-capsule clearance — no bounding-box slop.
 */
function segmentClosest(
  ax0: number, ay0: number, ax1: number, ay1: number,
  bx0: number, by0: number, bx1: number, by1: number,
) {
  const ux = ax1 - ax0, uy = ay1 - ay0;
  const vx = bx1 - bx0, vy = by1 - by0;
  const wx = ax0 - bx0, wy = ay0 - by0;

  const a = ux * ux + uy * uy;
  const b = ux * vx + uy * vy;
  const c = vx * vx + vy * vy;
  const d = ux * wx + uy * wy;
  const e = vx * wx + vy * wy;
  const den = a * c - b * b;

  let s = 0;
  let t = 0;
  if (den > 1e-9) {
    s = Math.min(1, Math.max(0, (b * e - c * d) / den));
  }
  t = c > 1e-9 ? (b * s + e) / c : 0;
  t = Math.min(1, Math.max(0, t));
  s = a > 1e-9 ? Math.min(1, Math.max(0, (b * t - d) / a)) : 0;

  const px = ax0 + ux * s, py = ay0 + uy * s;
  const qx = bx0 + vx * t, qy = by0 + vy * t;
  return { px, py, qx, qy, dist: Math.hypot(qx - px, qy - py) };
}

/** Axis-aligned half-extents of a rotated capsule, for edge clamping. */
const extents = (p: Pill) => {
  const t = (p.rot * Math.PI) / 180;
  const a = halfSeg(p);
  return {
    hx: Math.abs(Math.cos(t)) * a + CAP_R,
    hy: Math.abs(Math.sin(t)) * a + CAP_R,
  };
};

function clampToCanvas(p: Pill) {
  const { hx, hy } = extents(p);
  p.cx = Math.min(CANVAS_W - hx - MARGIN, Math.max(hx + MARGIN, p.cx));
  p.cy = Math.min(CANVAS_H - hy - MARGIN, Math.max(hy + TOP_BOUND, p.cy));
}

/**
 * Pair topics with slots by size rank — longest label into the widest slot.
 * A slot's design width is a decent proxy for how much clear space surrounds
 * it, so this keeps long labels away from the crowded edges.
 */
function assign(topics: string[]) {
  const byLength = topics
    .map((text, i) => ({ text, i }))
    .sort((a, b) => b.text.length - a.text.length || a.i - b.i);
  const byWidth = SLOTS.map((s, i) => ({ s, i })).sort(
    (a, b) => b.s.w - a.s.w || a.i - b.i,
  );
  return byLength.map((entry, rank) => ({
    text: entry.text,
    slot: byWidth[rank % byWidth.length]!.s,
  }));
}

/**
 * Places `topics` so that no two capsules come within GAP of each other.
 *
 * Relaxation rather than a packing algorithm: start from the design's own
 * positions and push overlapping pairs apart along their shortest separating
 * direction until everything is clear. Starting from the design means the
 * result still reads as the designed scatter rather than a generated grid.
 */
export function layoutTopics(topics: string[]): Placed[] {
  const assigned = assign(topics);

  const pills: Pill[] = assigned.map(({ text, slot }) => {
    const w = capsuleWidth(text);
    return { cx: slot.x + w / 2, cy: slot.y + CAP_H / 2, w, rot: slot.rot };
  });

  pills.forEach(clampToCanvas);

  const need = CAP_R * 2 + GAP;
  for (let iter = 0; iter < 600; iter += 1) {
    let worst = 0;

    for (let i = 0; i < pills.length; i += 1) {
      for (let j = i + 1; j < pills.length; j += 1) {
        const A = pills[i]!;
        const B = pills[j]!;
        const ea = endpoints(A);
        const eb = endpoints(B);
        const cp = segmentClosest(ea.x0, ea.y0, ea.x1, ea.y1, eb.x0, eb.y0, eb.x1, eb.y1);

        const overlap = need - cp.dist;
        if (overlap <= 0) continue;
        worst = Math.max(worst, overlap);

        // Separating direction: closest point on A to closest point on B.
        // Degenerate (exactly coincident) falls back to the centre difference,
        // and finally to a fixed axis so the pair can never stay stuck.
        let nx = cp.qx - cp.px;
        let ny = cp.qy - cp.py;
        let len = Math.hypot(nx, ny);
        if (len < 1e-6) {
          nx = B.cx - A.cx;
          ny = B.cy - A.cy;
          len = Math.hypot(nx, ny);
        }
        if (len < 1e-6) {
          nx = 0;
          ny = 1;
          len = 1;
        }
        nx /= len;
        ny /= len;

        const push = (overlap / 2) * 0.6; // damped, for stable convergence
        A.cx -= nx * push;
        A.cy -= ny * push;
        B.cx += nx * push;
        B.cy += ny * push;
      }
    }

    pills.forEach(clampToCanvas);
    if (worst < 0.5) break;
  }

  return assigned.map(({ text, slot }, i) => {
    const p = pills[i]!;
    return {
      text,
      x: Math.round((p.cx - p.w / 2) * 100) / 100,
      y: Math.round((p.cy - CAP_H / 2) * 100) / 100,
      w: p.w,
      rot: slot.rot,
      skew: slot.skew,
      bg: slot.bg,
      fg: slot.fg,
      delay: slot.delay,
    };
  });
}

/** Smallest clearance between any two placed capsules; negative means overlap. */
export function minClearance(placed: Placed[]): number {
  let min = Infinity;
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const A = placed[i]!;
      const B = placed[j]!;
      const pa: Pill = { cx: A.x + A.w / 2, cy: A.y + CAP_H / 2, w: A.w, rot: A.rot };
      const pb: Pill = { cx: B.x + B.w / 2, cy: B.y + CAP_H / 2, w: B.w, rot: B.rot };
      const ea = endpoints(pa);
      const eb = endpoints(pb);
      const cp = segmentClosest(ea.x0, ea.y0, ea.x1, ea.y1, eb.x0, eb.y0, eb.x1, eb.y1);
      min = Math.min(min, cp.dist - CAP_R * 2);
    }
  }
  return min;
}
