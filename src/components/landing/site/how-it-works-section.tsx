"use client";

import { useRef } from "react";
import Image from "next/image";
import { useSafeReducedMotion } from "@/lib/motion";
import { clamp, norm, smoothstep } from "./motion/scroll-engine";
import { useDamped } from "./motion/use-damped";
import { useScrollScene } from "./motion/use-scroll-scene";
import { ROLLER_STEPS } from "./landing-content";

const STEPS = [
  { rollStart: 0.14, rollEnd: 0.44 },
  { rollStart: 0.56, rollEnd: 0.86 },
] as const;

const SMOOTH = 0.14;
const EPSILON = 0.0002;

function turnsAt(p: number) {
  let turns = 0;
  for (const step of STEPS) {
    turns += smoothstep(norm(p, step.rollStart, step.rollEnd));
  }
  return turns;
}

export function HowItWorksSection() {
  const reduce = useSafeReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const cubeRef = useRef<HTMLDivElement>(null);
  const faceRefs = useRef<Array<HTMLElement | null>>([]);
  const dotRefs = useRef<Array<HTMLLIElement | null>>([]);

  function paint(turns: number) {
    const cube = cubeRef.current;
    if (!cube) return;
    const rot = -turns * 120;
    cube.style.setProperty("--lp-rot", rot.toFixed(3) + "deg");

    faceRefs.current.forEach((face, i) => {
      if (!face) return;
      const angle = ((i * 120 + rot) * Math.PI) / 180;
      const facing = Math.max(0, Math.cos(angle));
      face.style.opacity = (0.08 + 0.92 * Math.pow(facing, 0.7)).toFixed(3);
    });

    const active = Math.round(clamp(turns, 0, 2));
    dotRefs.current.forEach((dot, d) => {
      if (!dot) return;
      dot.classList.toggle("is-active", d === active);
    });
  }

  const setTarget = useDamped(SMOOTH, EPSILON, paint);

  useScrollScene(trackRef, (p) => {
    if (reduce) return;
    setTarget(turnsAt(p));
  });

  return (
    <section className="how" id="how" data-scene="roller">
      <div className="how__track" id="howTrack" ref={trackRef}>
        <div className="how__pin">
          <div className="container">
            <p className="section-label how__label">How it works</p>

            <div className="roller__stage">
              <div className="roller__cube" id="rollerCube" ref={cubeRef}>
                {ROLLER_STEPS.map((step, i) => (
                  <article
                    className="roller__face"
                    data-face={i}
                    key={step.num}
                    ref={(node) => {
                      faceRefs.current[i] = node;
                    }}
                  >
                    <div
                      className={
                        step.mediaClass
                          ? `how__media ${step.mediaClass}`
                          : "how__media"
                      }
                    >
                      <Image
                        src={step.image}
                        alt={step.alt}
                        width={step.width}
                        height={step.height}
                        loading="lazy"
                      />
                    </div>
                    <div className="how__body">
                      <span className="how__num">{step.num}</span>
                      <h3 className="h3">{step.title}</h3>
                      <p className="p-sm">{step.body}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <ol className="roller__dots" id="rollerDots" aria-hidden="true">
              {ROLLER_STEPS.map((step, i) => (
                <li
                  key={step.num}
                  className={i === 0 ? "is-active" : undefined}
                  ref={(node) => {
                    dotRefs.current[i] = node;
                  }}
                ></li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
