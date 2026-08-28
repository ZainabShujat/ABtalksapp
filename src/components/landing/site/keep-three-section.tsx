"use client";

import { useRef, useState } from "react";
import { clamp, norm } from "./motion/scroll-engine";
import { useScrollScene } from "./motion/use-scroll-scene";
import { PIPELINE } from "./landing-content";
import { KeepThreeDashboard } from "./keep-three-dashboard";

export function KeepThreeSection() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeStage, setActiveStage] = useState(0);

  useScrollScene(trackRef, (p) => {
    const eased = norm(p, 0.06, 0.94);
    const index = clamp(Math.floor(eased * PIPELINE.length), 0, PIPELINE.length - 1);
    setActiveStage(index);
  });

  return (
    <section className="keep" data-scene="keep">
      <div className="keep__track" id="keepTrack" ref={trackRef}>
        <div className="keep__pin">
          <div className="container keep__grid">
            <div className="keep__text">
              <p className="section-label">Keep the three Worth your time</p>
              <h2 className="h2">Get to know the elements!</h2>

              <ol className="pipeline" id="pipeline">
                {PIPELINE.map((item, i) => (
                  <li
                    key={item.title}
                    className={[
                      "pipeline__item",
                      i === activeStage ? "is-active" : "",
                      i < activeStage ? "is-done" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-stage={i}
                  >
                    <span>{item.title}</span>
                    <div className="pipeline__note">
                      <p>{item.note}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <KeepThreeDashboard activeStage={activeStage} />
          </div>
        </div>
      </div>
    </section>
  );
}
