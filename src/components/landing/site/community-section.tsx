"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useSafeReducedMotion } from "@/lib/motion";
import { useInView } from "./motion/use-in-view";
import { Reveal } from "./motion/reveal";
import {
  COMMUNITY_BULLETS,
  COMMUNITY_PHOTOS,
  WHATSAPP_INVITE,
} from "./landing-content";

export function CommunitySection() {
  const reduce = useSafeReducedMotion();
  const galleryRef = useRef<HTMLDivElement>(null);
  const [rolling, setRolling] = useState(false);
  const [reelReady, setReelReady] = useState(false);

  useInView(
    galleryRef,
    () => {
      setRolling(true);
      if (reduce) {
        setReelReady(true);
        return;
      }
      window.setTimeout(() => setReelReady(true), 1700);
    },
    { threshold: 0.2 },
  );

  const galleryClass = [
    "community__gallery",
    rolling || reduce ? "is-rolling" : "",
    reelReady || reduce ? "reel-ready" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="section community" id="community">
      <div className="container community__grid">
        <Reveal className="community__text">
          <h2 className="h2">
            Join a community
            <br />
            that builds
          </h2>
          <ul className="ticks">
            {COMMUNITY_BULLETS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="community__actions">
            <a
              href={WHATSAPP_INVITE}
              className="btn btn--whatsapp"
              target="_blank"
              rel="noopener noreferrer"
            >
              Join WhatsApp Community
            </a>
            <a href="#cohorts" className="btn btn--ghost">
              Explore Community
            </a>
          </div>
        </Reveal>

        <div
          className={galleryClass}
          id="communityGallery"
          ref={galleryRef}
        >
          <div className="community__reel" aria-hidden="true">
            {COMMUNITY_PHOTOS.map((photo, i) => (
              <span
                className={`tile tile--${photo.tile}`}
                data-frame={i}
                key={photo.src}
                style={{ ["--lp-frame" as string]: String(i) }}
              >
                <Image
                  src={photo.src}
                  alt={photo.alt}
                  width={photo.width}
                  height={photo.height}
                  loading="lazy"
                />
              </span>
            ))}
          </div>
          <div className="community__badge" id="communityBadge">
            <strong>10,000+</strong>
            <small>Active Builders</small>
          </div>
        </div>
      </div>
    </section>
  );
}
