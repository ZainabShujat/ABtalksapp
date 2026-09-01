"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSafeReducedMotion } from "@/lib/motion";
import { clamp, norm, smoothstep } from "./motion/scroll-engine";
import { useInView } from "./motion/use-in-view";
import { Reveal } from "./motion/reveal";
import {
  GC_FLAGS,
  GC_LAND_BANDS,
  GC_LOCATIONS,
  GC_ROUTE,
  GC_STEP_MS,
  GC_T,
  GC_TOTAL_MS,
  GC_VB_H,
  GC_VB_W,
  project,
} from "./global-community-data";

/* Above this width the cards float on the map. Below it they drop into a
   two-column grid underneath — eight cards cannot fit a ~350px-wide map
   without burying it — and only the pins stay on the geography. */
const FLOAT_MIN_WIDTH = 720;

/* Route arcs are walked in geographic space and projected sample by sample,
   so they follow the map's curve instead of cutting across it. */
const ROUTE_SAMPLES = 96;

/* Depth bands, near to far. The far band renders first so it sits underneath. */
const LAND_CLASSES = [
  "gcom__dots",
  "gcom__dots gcom__dots--mid",
  "gcom__dots gcom__dots--far",
] as const;
const LAND_ORDER = [2, 1, 0] as const;

/* Node i's pin lands as its incoming connection arrives; its card follows a
   beat later. India (i = 0) is the origin, so it opens the sequence. */
function pinAt(i: number) {
  return i === 0
    ? GC_T.originPin
    : GC_T.firstRoute + (i - 1) * GC_STEP_MS + GC_T.curve;
}

function cardAt(i: number) {
  return i === 0 ? GC_T.originCard : pinAt(i) + GC_T.cardDelay;
}

type Conn = { len: number; shown: number };

/* Pins and cards light up strictly in route order, so the whole timeline
   reduces to two counts — how many are on, how many are lit. */
type Phase = { on: number; lit: number };

export function GlobalCommunitySection() {
  const reduce = useSafeReducedMotion();

  const stageRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const pinRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const cardRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const leaderRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const lineRefs = useRef<Array<SVGPathElement | null>>([]);

  const connsRef = useRef<Conn[]>([]);
  const elapsedRef = useRef(-1);
  const rafRef = useRef(0);

  const [phase, setPhase] = useState<Phase>({ on: 0, lit: 0 });
  const phaseRef = useRef(phase);

  /* Geometry: pins, cards, leaders and every route path. Recomputed on mount
     and on resize only — never per frame. */
  function layout() {
    const map = mapRef.current;
    const stage = stageRef.current;
    if (!map || !stage) return;

    const W = map.clientWidth;
    const H = map.clientHeight;
    if (!W || !H) return;

    const floating = window.innerWidth > FLOAT_MIN_WIDTH;

    /* Cards and pins are sized in px, so they are scaled against the map's own
       width — the composition holds together at every map size instead of the
       cards swelling as the map shrinks. */
    const k = clamp(W / 1300, 0.8, 1.1);
    stage.style.setProperty("--lp-gcom-k", k.toFixed(3));

    const points = GC_LOCATIONS.map((loc) => project(loc.lat, loc.lng));

    GC_LOCATIONS.forEach((loc, i) => {
      const pin = pinRefs.current[i];
      const card = cardRefs.current[i];
      const leader = leaderRefs.current[i];
      if (!pin || !card || !leader) return;

      const px = points[i].x * W;
      const py = points[i].y * H;
      pin.style.left = px + "px";
      pin.style.top = py + "px";

      if (!floating) {
        card.style.left = "";
        card.style.top = "";
        return;
      }

      /* `place` is a direction off the pin and `gap` the distance to the
         card's near edge — straight up/down on the pin's own centre line, or
         diagonally to one of the four corners. */
      const cw = card.offsetWidth || 108;
      const ch = card.offsetHeight || 82;
      const gapPx = loc.card.gap * k;
      const down = loc.card.place.startsWith("below");
      const side = loc.card.place.endsWith("-left")
        ? -1
        : loc.card.place.endsWith("-right")
          ? 1
          : 0;

      const cx = clamp(
        side === 0 ? px - cw / 2 : side < 0 ? px - gapPx - cw : px + gapPx,
        0,
        Math.max(0, W - cw),
      );
      const cy = down ? py + gapPx : py - gapPx - ch;
      card.style.left = cx + "px";
      card.style.top = cy + "px";

      /* Hairline from the pin to the nearest point on the card, so a card is
         never ambiguous in the tight European cluster. */
      const ax = clamp(px, cx, cx + cw);
      const ay = clamp(py, cy, cy + ch);
      const len = Math.hypot(ax - px, ay - py);
      leader.style.left = px + "px";
      leader.style.top = py + "px";
      leader.style.width = Math.max(0, len - 8) + "px";
      leader.style.transform = "rotate(" + Math.atan2(ay - py, ax - px) + "rad)";
      leader.style.display = len < 16 ? "none" : "";
    });

    /* One arc per connection, drawn as a single thin stroke of even weight end
       to end. The draw-on is a dash offset walking back to zero, so the line
       grows from the source pin to the destination. */
    const strokeWidth = (1.5 * clamp(W / 1300, 0.8, 1.15)).toFixed(2);
    const byId = new Map(
      GC_LOCATIONS.map((loc, i) => [loc.id, { loc, n: points[i] }]),
    );
    connsRef.current = GC_ROUTE.map(() => ({ len: 0, shown: -1 }));

    GC_ROUTE.forEach((leg, j) => {
      const line = lineRefs.current[j];
      const a = byId.get(leg.from);
      const b = byId.get(leg.to);
      if (!line || !a || !b) return;

      const dLat = b.loc.lat - a.loc.lat;
      const dLng = b.loc.lng - a.loc.lng;
      /* `lift` bows the arc up off the surface at its midpoint, giving the
         flight-path rise. */
      const rise =
        leg.lift !== undefined
          ? leg.lift / 100
          : clamp(Math.abs(b.n.x - a.n.x) * 0.55, 0.03, 0.26);

      let d = "";
      for (let s = 0; s <= ROUTE_SAMPLES; s++) {
        const f = s / ROUTE_SAMPLES;
        const q = project(
          a.loc.lat + dLat * f,
          a.loc.lng + dLng * f,
          rise * Math.sin(Math.PI * f),
        );
        d += (s ? "L" : "M") + (q.x * W).toFixed(2) + " " + (q.y * H).toFixed(2);
      }

      line.setAttribute("d", d);
      line.setAttribute("stroke-width", strokeWidth);

      const len = line.getTotalLength();
      line.style.strokeDasharray = len + " " + len;
      line.style.strokeDashoffset = String(len);
      connsRef.current[j] = { len, shown: -1 };
    });
  }

  /* A pure function of elapsed time, so a resize can simply re-run it against
     the rebuilt geometry and land in the same state. */
  function paint(ms: number) {
    elapsedRef.current = ms;

    let on = 0;
    let lit = 0;
    for (let i = 0; i < GC_LOCATIONS.length; i++) {
      if (ms >= pinAt(i)) on++;
      if (ms >= cardAt(i)) lit++;
    }
    if (on !== phaseRef.current.on || lit !== phaseRef.current.lit) {
      phaseRef.current = { on, lit };
      setPhase({ on, lit });
    }

    connsRef.current.forEach((conn, j) => {
      const line = lineRefs.current[j];
      if (!line) return;
      const start = GC_T.firstRoute + j * GC_STEP_MS;
      const want = smoothstep(norm(ms, start, start + GC_T.curve));
      if (want === conn.shown) return;
      conn.shown = want;
      line.style.strokeDashoffset = (conn.len * (1 - want)).toFixed(1);
      line.style.opacity = want > 0 ? "1" : "0";
    });
  }

  useLayoutEffect(() => {
    layout();
    /* Reduced motion: no build-up. The finished network is painted at once and
       simply stays there. Otherwise -1, not 0: at t=0 India's pin is already
       its first beat, so the section sits at "nothing yet" until the viewer
       actually reaches it. */
    paint(reduce ? GC_TOTAL_MS : -1);
    // layout/paint close over refs; re-run only when the motion mode flips
  }, [reduce]);

  useEffect(() => {
    /* Geometry only — the timeline is untouched, so a resize mid-sequence keeps
       its place. Card height depends on the loaded display face, so measure
       again once the fonts are in. */
    function remeasure() {
      layout();
      paint(elapsedRef.current);
    }

    let timer = 0;
    function onResize() {
      window.clearTimeout(timer);
      timer = window.setTimeout(remeasure, 160);
    }

    window.addEventListener("resize", onResize);
    window.addEventListener("load", remeasure);
    if (document.fonts?.ready) void document.fonts.ready.then(remeasure);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("load", remeasure);
    };
    // layout/paint close over refs; re-run only when the motion mode flips
  }, [reduce]);

  useInView(
    mapRef,
    () => {
      if (reduce) return;
      let t0: number | null = null;
      const frame = (ts: number) => {
        if (t0 === null) t0 = ts;
        const ms = ts - t0;
        paint(ms);
        if (ms < GC_TOTAL_MS) rafRef.current = window.requestAnimationFrame(frame);
      };
      rafRef.current = window.requestAnimationFrame(frame);
    },
    { threshold: 0.25, rootMargin: "0px" },
  );

  useEffect(() => () => window.cancelAnimationFrame(rafRef.current), []);

  return (
    <section className="section gcom" id="global-community">
      <div className="container gcom__grid">
        <div className="gcom__content">
          <Reveal as="p" className="section-label">
            Global community
          </Reveal>
          <Reveal as="h2" className="h2 gcom__title">
            Build anywhere.
            <br />
            Get discovered <span className="accent">everywhere.</span>
          </Reveal>
        </div>

        <div className="gcom__stage" ref={stageRef}>
          <div
            className="gcom__map"
            id="gcomMap"
            ref={mapRef}
            role="img"
            aria-label="Dotted world map showing the eight places ABTalks operates in, connected as a network. The same list follows as text."
          >
            <svg
              className="gcom__land"
              id="gcomLand"
              viewBox={`0 0 ${GC_VB_W} ${GC_VB_H}`}
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
              focusable="false"
            >
              {LAND_ORDER.map((band) => (
                <path
                  key={band}
                  className={LAND_CLASSES[band]}
                  d={GC_LAND_BANDS[band]}
                />
              ))}
            </svg>
            <svg
              className="gcom__routes"
              id="gcomRoutes"
              aria-hidden="true"
              focusable="false"
            >
              {GC_ROUTE.map((leg, j) => (
                <path
                  key={`${leg.from}-${leg.to}`}
                  className="gcom__routeline"
                  ref={(node) => {
                    lineRefs.current[j] = node;
                  }}
                />
              ))}
            </svg>
          </div>

          <ul className="gcom__nodes" id="gcomNodes">
            {GC_LOCATIONS.map((loc, i) => (
              <li
                key={loc.id}
                className={[
                  "gcom__node",
                  i < phase.on ? "is-on" : "",
                  i < phase.lit ? "is-lit" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-loc={loc.id}
              >
                <span
                  className="gcom__leader"
                  aria-hidden="true"
                  ref={(node) => {
                    leaderRefs.current[i] = node;
                  }}
                />
                <span
                  className="gcom__pin"
                  aria-hidden="true"
                  ref={(node) => {
                    pinRefs.current[i] = node;
                  }}
                >
                  <i />
                </span>
                <span
                  className="gcom__card"
                  ref={(node) => {
                    cardRefs.current[i] = node;
                  }}
                  /* long country names get a wider card (Switzerland) */
                  style={
                    loc.card.w
                      ? { ["--lp-gcom-cw" as string]: String(loc.card.w) }
                      : undefined
                  }
                >
                  <span className="gcom__cardhead">
                    <span className="gcom__flag" aria-hidden="true">
                      <svg
                        viewBox="0 0 24 16"
                        preserveAspectRatio="xMidYMid slice"
                      >
                        {GC_FLAGS[loc.flag]}
                      </svg>
                    </span>
                    <span>{loc.short}</span>
                    {/* only when the card shows an abbreviation, so a screen
                        reader never hears the same country twice */}
                    {loc.short !== loc.name ? (
                      <span className="gcom__sr">{loc.name}</span>
                    ) : null}
                  </span>
                  <span className="gcom__num">{loc.builders}</span>
                  <span className="gcom__unit">Builders</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
