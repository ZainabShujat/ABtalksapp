"use client";

import { useEffect, useRef } from "react";
import { useSafeReducedMotion } from "@/lib/motion";
import {
  clamp,
  envelope,
  norm,
  smoothstep,
} from "./motion/scroll-engine";
import { useDamped } from "./motion/use-damped";
import { useScrollScene } from "./motion/use-scroll-scene";
import { BRIDGE_PANELS, BRIDGE_SLABS } from "./landing-content";

const SMOOTH = 0.16;
const EPSILON = 0.0002;

type Anchor = {
  nx: number;
  ny: number;
  rx: number;
  ry: number;
  ex: number;
  ey: number;
};

const DEFAULT_TRAVEL = { x: 122, y: 72 };

function travel() {
  const w = window.innerWidth;
  if (w <= 720) return { x: 54, y: 34 };
  if (w <= 1080) return { x: 86, y: 52 };
  return DEFAULT_TRAVEL;
}

export function BridgeSection() {
  const reduce = useSafeReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const panelWrapRef = useRef<HTMLDivElement>(null);
  const linksSvgRef = useRef<SVGSVGElement>(null);
  const slabRefs = useRef<Record<number, HTMLSpanElement | null>>({
    1: null,
    2: null,
    3: null,
  });
  const panelRefs = useRef<Array<HTMLElement | null>>([]);
  const linkRefs = useRef<Record<number, SVGGElement | null>>({
    1: null,
    2: null,
    3: null,
  });
  const anchorsRef = useRef<Record<number, Anchor> | null>(null);
  const moveRef = useRef(DEFAULT_TRAVEL);
  const valueRef = useRef(0);

  function applySlab(el: HTMLElement | null, out: number) {
    if (!el) return;
    const move = moveRef.current;
    el.style.setProperty("--lp-tx", (out * move.x).toFixed(2) + "px");
    el.style.setProperty("--lp-ty", (out * move.y).toFixed(2) + "px");
    el.style.setProperty("--lp-sc", (1 + out * 0.07).toFixed(3));
    el.style.setProperty("--lp-lift", out.toFixed(3));
    el.style.setProperty(
      "--lp-label",
      smoothstep(norm(out, 0.12, 0.7)).toFixed(3),
    );
  }

  function drawLink(key: number, out: number) {
    const g = linkRefs.current[key];
    if (!g) return;
    const alpha = smoothstep(norm(out, 0.18, 0.42));
    const anchors = anchorsRef.current;
    if (!anchors || alpha <= 0) {
      g.style.opacity = "0";
      return;
    }
    const a = anchors[key];
    if (!a) {
      g.style.opacity = "0";
      return;
    }
    const move = moveRef.current;
    const fromTop = a.ey < a.ny - 16;
    const sx = (fromTop ? a.nx : a.rx) + out * move.x;
    const sy = (fromTop ? a.ny - 4 : a.ry) + out * move.y;
    const span = a.ex - sx;
    const rise = clamp(Math.abs(a.ey - sy) * 1.15, 20, span * 0.62);
    const kx = sx + rise;
    const line = g.querySelector(".blink__line") as SVGPathElement | null;
    if (!line) return;
    line.setAttribute(
      "d",
      "M" +
        sx.toFixed(1) +
        " " +
        sy.toFixed(1) +
        " L" +
        kx.toFixed(1) +
        " " +
        a.ey.toFixed(1) +
        " L" +
        a.ex.toFixed(1) +
        " " +
        a.ey.toFixed(1),
    );
    const drawn = smoothstep(norm(out, 0.18, 0.7));
    line.style.strokeDashoffset = (1 - drawn).toFixed(4);
    g.style.opacity = alpha.toFixed(3);
  }

  function paint(p: number) {
    valueRef.current = p;
    const outBottom = envelope(p, 0.12, 0.27, 0.38, 0.48);
    const outMiddle = envelope(p, 0.45, 0.59, 0.68, 0.77);
    const outTop = envelope(p, 0.74, 0.88, 1.1, 1.2);

    applySlab(slabRefs.current[1], outBottom);
    applySlab(slabRefs.current[2], outMiddle);
    applySlab(slabRefs.current[3], outTop);

    drawLink(1, outBottom);
    drawLink(2, outMiddle);
    drawLink(3, outTop);

    const weights = [
      clamp(1 - (outBottom + outMiddle + outTop), 0, 1),
      outBottom,
      outMiddle,
      outTop,
    ];

    let leader = 0;
    for (let i = 1; i < weights.length; i++) {
      if (weights[i]! > weights[leader]!) leader = i;
    }

    panelRefs.current.forEach((panel, i) => {
      if (!panel) return;
      const w = weights[i] ?? 0;
      const op = smoothstep(norm(w, 0.55, 1));
      panel.style.opacity = op.toFixed(3);
      panel.style.transform =
        "translateY(" + ((1 - op) * 22).toFixed(1) + "px)";
      panel.classList.toggle("is-current", i === leader);
    });
  }

  function measureLinks() {
    anchorsRef.current = null;
    const linksSvg = linksSvgRef.current;
    if (!linksSvg) return;
    const box = linksSvg.getBoundingClientRect();
    if (!box.width || !box.height) return;

    for (let i = 1; i <= 3; i++) {
      const slab = slabRefs.current[i];
      if (!slab) continue;
      slab.style.setProperty("--lp-tx", "0px");
      slab.style.setProperty("--lp-ty", "0px");
      slab.style.setProperty("--lp-sc", "1");
    }
    for (const panel of panelRefs.current) {
      if (panel) panel.style.transform = "none";
    }

    const found: Record<number, Anchor> = {};
    for (let i = 1; i <= 3; i++) {
      const slab = slabRefs.current[i];
      const face = slab?.querySelector(".slab__face--top");
      const title = panelRefs.current[i]?.querySelector(".h2");
      if (!face || !title) return;
      const f = face.getBoundingClientRect();
      const t = title.getBoundingClientRect();
      found[i] = {
        nx: f.left + f.width / 2 - box.left,
        ny: f.top - box.top,
        rx: f.right - box.left,
        ry: f.top + f.height / 2 - box.top,
        ex: t.left - box.left - 10,
        ey: t.top + t.height / 2 - box.top,
      };
    }
    anchorsRef.current = found;
  }

  const setTarget = useDamped(SMOOTH, EPSILON, paint);

  useScrollScene(trackRef, (p) => setTarget(p));

  useEffect(() => {
    if (reduce) return;

    function relayout() {
      moveRef.current = travel();
      measureLinks();
      paint(valueRef.current);
    }

    window.addEventListener("resize", relayout);
    if (document.fonts?.ready) void document.fonts.ready.then(relayout);
    relayout();
    return () => window.removeEventListener("resize", relayout);
    // paint/measure close over refs; run once after mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  return (
    <section className="bridge" id="bridge" data-scene="bridge">
      <div className="bridge__track" id="bridgeTrack" ref={trackRef}>
        <div className="bridge__pin">
          <div className="container bridge__grid">
            <svg
              className="bridge__links"
              id="bridgeLinks"
              ref={linksSvgRef}
              aria-hidden="true"
              focusable="false"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient
                  id="bridgeLinkGrad"
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="0"
                >
                  <stop offset="0%" stopColor="#8AA6C6" />
                  <stop offset="50%" stopColor="#8480BD" />
                  <stop offset="100%" stopColor="#E58256" />
                </linearGradient>
              </defs>
              {([1, 2, 3] as const).map((n) => (
                <g
                  className="blink"
                  data-link={n}
                  key={n}
                  ref={(node) => {
                    linkRefs.current[n] = node;
                  }}
                >
                  <path className="blink__line" pathLength="1" d="" />
                </g>
              ))}
            </svg>

            <div
              className="bridge__visual"
              id="bridgeVisual"
              ref={visualRef}
              aria-hidden="true"
            >
              <div className="stack">
                {BRIDGE_SLABS.map((slab) => (
                  <span
                    key={slab.key}
                    className={`slab slab--${slab.key}`}
                    data-slab={slab.slab}
                    ref={(node) => {
                      slabRefs.current[slab.slab] = node;
                    }}
                  >
                    <span className="slab__shadow"></span>
                    <span className="slab__face slab__face--s"></span>
                    <span className="slab__face slab__face--w"></span>
                    <span className="slab__face slab__face--top">
                      <span className="slab__label">{slab.label}</span>
                    </span>
                  </span>
                ))}
              </div>
            </div>

            <div
              className="bridge__panels"
              id="bridgePanels"
              ref={panelWrapRef}
            >
              {BRIDGE_PANELS.map((panel, i) => (
                <article
                  key={panel.label + i}
                  className={i === 0 ? "bpanel is-current" : "bpanel"}
                  data-panel={i}
                  ref={(node) => {
                    panelRefs.current[i] = node;
                  }}
                >
                  <p className="section-label">{panel.label}</p>
                  <h2 className="h2">
                    {panel.title.split("\n").map((line, li) => (
                      <span key={line}>
                        {li > 0 ? <br /> : null}
                        {line}
                      </span>
                    ))}
                  </h2>
                  {panel.body ? <p className="p">{panel.body}</p> : null}
                  {panel.items ? (
                    <ul className="bpanel__list">
                      {panel.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
