import type { ReactNode } from "react";

/* Global Community — the one config that drives the whole section.
   The eight locations (name, flag, builder count, real latitude/longitude,
   where the card sits) and the ROUTE that links them. Change GC_LOCATIONS or
   GC_ROUTE and the map, the pins, the cards and the animation all follow.

   Geometry here is pure maths — no DOM. The section component owns every
   measurement and every write to the page. */

export type GcFlagKey = "in" | "us" | "gb" | "de" | "sct" | "ae" | "ch" | "sg";

/* 'above' | 'below' hang the card on the pin's own centre line; the corner
   values fan it out diagonally. The four European pins are only ~60px apart,
   so they take the corners instead of stacking. */
export type GcCardPlace =
  | "above"
  | "above-left"
  | "above-right"
  | "below"
  | "below-left"
  | "below-right";

export type GcLocation = {
  id: string;
  name: string;
  short: string;
  flag: GcFlagKey;
  builders: string;
  lat: number;
  lng: number;
  /* gap: px from the pin's centre to the card's near edge, at the reference
     map width of 784px — it scales with the map. w: card width override, for
     long country names. */
  card: { place: GcCardPlace; gap: number; w?: number };
};

export type GcLeg = { from: string; to: string; lift?: number };

/* ---- Map projection ---------------------------------------------------
   An equirectangular world map with a gentle curve. Longitude still maps
   straight to x, so every marker keeps its true horizontal position; the
   latitude band is then bowed down and squeezed slightly toward the left and
   right edges, which reads as a softly curved surface rather than a flat
   rectangle — without the strong globe distortion.

   GC_BOW    how far the edges swing down relative to the centre
   GC_TAPER  vertical squeeze at the edges

   `z` runs 1 at the centre to 0.70 at the edges; it only feeds a slight
   falloff in dot size. */
const GC_BOW = 0.15;
const GC_TAPER = 0.16;

/* Projected bounds of the land mask — the map's bounding box. */
const GC_X0 = -0.99306;
const GC_X1 = 0.99306;
const GC_Y0 = -0.98087;
const GC_Y1 = 0.94445;

/* Land svg viewBox — same aspect as the projected map, so user units and the
   container stay in step and the pins line up with the land. */
export const GC_VB_W = 1000;
export const GC_VB_H = 377;

const GC_LON0 = -180;
const GC_LON_SPAN = 360;
const GC_LAT0 = 83;
const GC_LAT_SPAN = 140;
const GC_COLS = 144;
const GC_ROWS = 56;
const GC_STEP = 2.5;

export type GcPoint = { x: number; y: number; z: number };

function projRaw(lat: number, lng: number): GcPoint {
  const nx = ((lng - GC_LON0) / GC_LON_SPAN) * 2 - 1; /* -1 .. 1 */
  const vy = ((GC_LAT0 - lat) / GC_LAT_SPAN) * 2 - 1;
  const rim = nx * nx; /* 0 centre .. 1 edge */
  return {
    x: nx,
    y: vy * (1 - GC_TAPER * rim) + GC_BOW * rim,
    z: 1 - 0.34 * rim,
  };
}

function toN(p: GcPoint): GcPoint {
  return {
    x: (p.x - GC_X0) / (GC_X1 - GC_X0),
    y: (p.y - GC_Y0) / (GC_Y1 - GC_Y0),
    z: p.z,
  };
}

/* Real coordinates -> 0..1 of the map box. `lift` raises the point off the
   surface as a fraction of the box height — routes use it to arc. */
export function project(lat: number, lng: number, lift = 0): GcPoint {
  const p = toN(projRaw(lat, lng));
  return { x: p.x, y: p.y - lift, z: p.z };
}

/* 144x56 land/sea bitmap (packed bits, base64) sampled from a real land
   mask — this is what draws the continents as dots. */
const GC_LAND =
  "AAAAAB/9X/9gAAABAAAAAAAAAAAAAh/D//8ADkAAAAMAAAAAAAAA6G+P//8AAgAAMADoAA" +
  "AAAAADAAAAP/8AAAACAB/wAAAAAAAD/K/gH/4AAAAEH///8PAAAf+/PlK4D/wAAfwQ2///" +
  "///v4f////4eH8AAB/s/////////AP////4cDgHADz3////////+A////+BgDgAAPn////" +
  "////68AdD//8ByAAAAPn///////7SAAIA///h+AAACFv///////gOAAAAP//7/gAANA///" +
  "/////wMAAAAH////gAALP////////wAAAAAB///4YAAB/////////wAAAAAD///8AAAB//" +
  "///////gAAAAAD///wAAAB6+D//////AAAAAAD///wAAAPlOR/////8AAAAAAD//+AAAAP" +
  "Er//////IIAAAAAB///AAAAGcBf/////sQAAAAAA//+AAAAH8AP/////DgAAAAAAf/8AAA" +
  "AP/MP/////iAAAAAAAP9EAAAAP///v////gAAAAAAAD4EAAAAf///1////AAAAAAAAF4AA" +
  "AAA///36H//+gAAAAAAAA4CAAAB///7/D/f4AAAAAAAAA8gQAAB///7+B8PQAAAAAAAAAP" +
  "gAAAB///94B4PggAAAAAAAAB4AAAB////wAwHwgAAAAAAAAAYAAAA///+IAwBwAAAAAAAA" +
  "AAKvAAAf///wAQEAAAAAAAAAAAB/gAAf///wAICAIAAAAAAAAAB/4AAAD//gAAKCAAAAAA" +
  "AAAAD/8AAAD//AAADOAAAAAAAAABD/+AAAH/+AAACOBAAAAAAAAAD//wAAD/8AAABGt4AA" +
  "AAAAAAD//8AAB/8AAAAAAfgAAAAAAAD//8AAB/8AAAAMQaAAAAAAAAB//4AAB/8AAAAAAA" +
  "AAAAAAAAB//wAAB/8AAAAADAAAAAAAAAA//wAAB/8QAAAAPkAAAAAAAAAP/wAAB/4wAAAA" +
  "f+AAAAAAAAAP/wAAB/wgAAAB//AAAAAAAAAP/AAAA/xgAAAD//AAAAAAAAAP+AAAA/gAAA" +
  "AD//gAAAAAAAAP+AAAA/gAAAAD//gAAAAAAAAf4AAAAfAAAAAD//gAAAAAAAAf4AAAAeAA" +
  "AAADw/gAAAAAAAAfgAAAAAAAAAAAAPAEAAAAAAAfgAAAAAAAAAAAAGACAAAAAAA+AAAAAA" +
  "AAAAAAAAACAAAAAAA8AAAAAAAAAAAAACAIAAAAAAA4AAAAAAAAAAAAAAAQAAAAAAA4AAAA" +
  "AAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAA";

/* One <path> per depth band instead of ~2,500 <circle> elements: three nodes
   total, and the bands give the flat projection a soft spherical falloff
   toward the edges. Pure and deterministic, so it is built once at module
   load and shared by every render. */
function buildLandBands(): readonly [string, string, string] {
  const bin = atob(GC_LAND);
  const bands: [string, string, string] = ["", "", ""];
  let i = 0;

  for (let r = 0; r < GC_ROWS; r++) {
    const lat = GC_LAT0 - (r + 0.5) * GC_STEP;

    for (let c = 0; c < GC_COLS; c++, i++) {
      if (!((bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1)) continue;

      const p = toN(projRaw(lat, GC_LON0 + (c + 0.5) * GC_STEP));
      const cx = p.x * GC_VB_W;
      const cy = p.y * GC_VB_H;
      const rr = 1.3 + 0.36 * Math.max(0, p.z); /* softens toward the edges */
      const band = p.z > 0.78 ? 0 : p.z > 0.55 ? 1 : 2;

      bands[band] +=
        "M" +
        (cx - rr).toFixed(2) +
        " " +
        cy.toFixed(2) +
        "a" +
        rr.toFixed(2) +
        "," +
        rr.toFixed(2) +
        " 0 1,0 " +
        (rr * 2).toFixed(2) +
        ",0" +
        "a" +
        rr.toFixed(2) +
        "," +
        rr.toFixed(2) +
        " 0 1,0 " +
        (-rr * 2).toFixed(2) +
        ",0";
    }
  }
  return bands;
}

/* [near, mid, far] — the far band is rendered first so it sits underneath. */
export const GC_LAND_BANDS = buildLandBands();

/* Inline SVG flags — emoji flags do not render at all on Windows Chrome and
   vary in size between platforms, so each one is drawn instead. All share a
   24x16 viewBox, which keeps every flag exactly the same size. */
export const GC_FLAGS: Record<GcFlagKey, ReactNode> = {
  "in": (
    <>
      <rect width="24" height="16" fill="#fff"/>
      <rect width="24" height="5.33" fill="#FF9933"/>
      <rect y="10.67" width="24" height="5.33" fill="#138808"/>
      <circle cx="12" cy="8" r="2.1" fill="none" stroke="#0A3D91" strokeWidth=".9"/>
    </>
  ),
  "us": (
    <>
      <rect width="24" height="16" fill="#fff"/>
      <g fill="#B22234">
        <rect width="24" height="1.23"/>
        <rect y="2.46" width="24" height="1.23"/>
        <rect y="4.92" width="24" height="1.23"/>
        <rect y="7.38" width="24" height="1.23"/>
        <rect y="9.85" width="24" height="1.23"/>
        <rect y="12.31" width="24" height="1.23"/>
        <rect y="14.77" width="24" height="1.23"/>
      </g>
      <rect width="10" height="8.6" fill="#3C3B6E"/>
      <g fill="#fff">
        <circle cx="2" cy="2" r=".62"/>
        <circle cx="5" cy="2" r=".62"/>
        <circle cx="8" cy="2" r=".62"/>
        <circle cx="3.5" cy="4.3" r=".62"/>
        <circle cx="6.5" cy="4.3" r=".62"/>
        <circle cx="2" cy="6.6" r=".62"/>
        <circle cx="5" cy="6.6" r=".62"/>
        <circle cx="8" cy="6.6" r=".62"/>
      </g>
    </>
  ),
  "gb": (
    <>
      <rect width="24" height="16" fill="#012169"/>
      <path d="M0 0 24 16M24 0 0 16" stroke="#fff" strokeWidth="3.2"/>
      <path d="M0 0 24 16M24 0 0 16" stroke="#C8102E" strokeWidth="1.9"/>
      <path d="M12 0v16M0 8h24" stroke="#fff" strokeWidth="5.3"/>
      <path d="M12 0v16M0 8h24" stroke="#C8102E" strokeWidth="3.2"/>
    </>
  ),
  "de": (
    <>
      <rect width="24" height="5.33" fill="#000"/>
      <rect y="5.33" width="24" height="5.33" fill="#DD0000"/>
      <rect y="10.67" width="24" height="5.33" fill="#FFCE00"/>
    </>
  ),
  "sct": (
    <>
      <rect width="24" height="16" fill="#0065BD"/>
      <path d="M0 0 24 16M24 0 0 16" stroke="#fff" strokeWidth="3.4"/>
    </>
  ),
  "ae": (
    <>
      <rect width="24" height="16" fill="#fff"/>
      <rect width="24" height="5.33" fill="#00732F"/>
      <rect y="10.67" width="24" height="5.33" fill="#000"/>
      <rect width="6.2" height="16" fill="#FF0000"/>
    </>
  ),
  "ch": (
    <>
      <rect width="24" height="16" fill="#DA291C"/>
      <path d="M11 4h2v3.2h3.2v2H13V12h-2V9.2H7.8v-2H11z" fill="#fff"/>
    </>
  ),
  "sg": (
    <>
      <rect width="24" height="16" fill="#fff"/>
      <rect width="24" height="8" fill="#ED2939"/>
      <path d="M7.9 4a2.9 2.9 0 100 5.4 3.3 3.3 0 110-5.4z" fill="#fff"/>
      <g fill="#fff">
        <circle cx="10.4" cy="3.3" r=".62"/>
        <circle cx="12.7" cy="4.9" r=".62"/>
        <circle cx="11.8" cy="7.5" r=".62"/>
        <circle cx="9" cy="7.5" r=".62"/>
        <circle cx="8.1" cy="4.9" r=".62"/>
      </g>
    </>
  ),
};

/* --- The eight places ABTalks operates in --- */
export const GC_LOCATIONS: readonly GcLocation[] = [
  { id: "india",       name: "India",           short: "India",       flag: "in",   builders: "9,200+", lat:  22.00, lng:   78.90, card: { place: "above",         gap: 30 } },
  { id: "singapore",   name: "Singapore",       short: "Singapore",   flag: "sg",   builders: "2,300+", lat:   1.35, lng:  103.82, card: { place: "below",         gap: 12, w: 122 } },
  { id: "dubai",       name: "Dubai",           short: "Dubai",       flag: "ae",   builders: "1,900+", lat:  25.20, lng:   55.27, card: { place: "below",         gap: 26 } },
  { id: "switzerland", name: "Switzerland",     short: "Switzerland", flag: "ch",   builders: "950+",   lat:  46.95, lng:    7.45, card: { place: "below-right",   gap: 12, w: 136 } },
  { id: "germany",     name: "Germany",         short: "Germany",     flag: "de",   builders: "2,100+", lat:  52.52, lng:   13.40, card: { place: "above-right",   gap: 14 } },
  { id: "uk",          name: "United Kingdom",  short: "UK",          flag: "gb",   builders: "2,600+", lat:  51.51, lng:   -0.13, card: { place: "below-left",    gap: 14 } },
  { id: "scotland",    name: "Scotland",        short: "Scotland",    flag: "sct",  builders: "1,150+", lat:  55.95, lng:   -3.19, card: { place: "above-left",    gap: 14, w: 118 } },
  { id: "us",          name: "United States",   short: "USA",         flag: "us",   builders: "4,800+", lat:  39.00, lng:  -98.00, card: { place: "above",         gap: 12 } },
];

/* Order the network is built in. `lift` is how far the arc rises off the
   surface, as a percentage of the map's height (omit it and one is derived
   from the leg's width). India is always the origin: it is simply first. */
export const GC_ROUTE: readonly GcLeg[] = [
  { from: "india",       to: "singapore",   lift: 5 },
  { from: "singapore",   to: "dubai",       lift: 11 },
  { from: "dubai",       to: "switzerland", lift: 10 },
  { from: "switzerland", to: "germany",     lift: 3 },
  { from: "germany",     to: "uk",          lift: 3.5 },
  { from: "uk",          to: "scotland",    lift: 2.5 },
  { from: "scotland",    to: "us",          lift: 20 },
];

/* Timeline, in ms. Every value is a beat you can retune. */
export const GC_T = {
  originPin: 0, // India pin appears
  originCard: 400, // India card peeks up
  firstRoute: 900, // first connection sets off
  curve: 420, // a connection travelling source -> destination
  cardDelay: 180, // gap between destination pin lighting and its card
  cardHold: 560, // card peek + dwell before the next connection leaves
} as const;

export const GC_STEP_MS = GC_T.curve + GC_T.cardDelay + GC_T.cardHold;
export const GC_TOTAL_MS =
  GC_T.firstRoute + GC_ROUTE.length * GC_STEP_MS + 600;
