"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSafeReducedMotion } from "@/lib/motion";

const HERO_SRC_DESKTOP = "/landing/site/hero.mp4";
const HERO_SRC_MOBILE = "/landing/site/hero-mobile.mp4";
const HEADLINE_AT = 4;
const PHONE_MQ = "(max-width: 720px)";

function subscribePhone(onStoreChange: () => void) {
  const mq = window.matchMedia(PHONE_MQ);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getPhoneSnapshot() {
  return window.matchMedia(PHONE_MQ).matches;
}

function getPhoneServerSnapshot() {
  return false;
}

export function HeroSection() {
  const reduce = useSafeReducedMotion();
  const isMobile = useSyncExternalStore(
    subscribePhone,
    getPhoneSnapshot,
    getPhoneServerSnapshot,
  );
  const heroRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [headlineReady, setHeadlineReady] = useState(false);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isMobile) {
      video.setAttribute("src", HERO_SRC_MOBILE);
    } else {
      video.removeAttribute("src");
    }
    video.load();
    if (reduce) return;
    const playAttempt = video.play();
    if (playAttempt && typeof playAttempt.catch === "function") {
      playAttempt.catch(() => {
        /* autoplay blocked — gradient fallback stays */
      });
    }
  }, [isMobile, reduce]);

  useEffect(() => {
    const hero = heroRef.current;
    const video = videoRef.current;
    if (!hero) return;

    if (reduce) {
      video?.pause();
      video?.removeAttribute("autoplay");
      setHeadlineReady(true);
      return;
    }

    let fired = false;
    let bail = 0;
    let raf = 0;

    function showVideo() {
      setHasVideo(true);
    }

    function revealHeadline() {
      if (fired) return;
      fired = true;
      setHeadlineReady(true);
      video?.removeEventListener("timeupdate", onTimeUpdate);
    }

    function onTimeUpdate() {
      if (video && video.currentTime >= HEADLINE_AT) revealHeadline();
    }

    const playRaf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setIsPlaying(true));
    });

    if (!video) {
      window.setTimeout(revealHeadline, HEADLINE_AT * 1000);
      return () => {
        window.cancelAnimationFrame(playRaf);
      };
    }

    if (video.readyState >= 2) showVideo();
    video.addEventListener("loadeddata", showVideo, { once: true });
    video.addEventListener("error", () => setHasVideo(false));

    const playAttempt = video.play();
    if (playAttempt && typeof playAttempt.catch === "function") {
      playAttempt.catch(() => {
        /* autoplay blocked — gradient stays */
      });
    }

    video.addEventListener("timeupdate", onTimeUpdate);

    function probe() {
      if (fired) return;
      if (video && video.currentTime >= HEADLINE_AT) {
        revealHeadline();
        return;
      }
      raf = window.requestAnimationFrame(probe);
    }
    raf = window.requestAnimationFrame(probe);

    bail = window.setTimeout(revealHeadline, HEADLINE_AT * 1000 + 5000);
    const onError = () => {
      window.clearTimeout(bail);
      window.setTimeout(revealHeadline, 600);
    };
    video.addEventListener("error", onError);

    return () => {
      window.cancelAnimationFrame(playRaf);
      window.cancelAnimationFrame(raf);
      window.clearTimeout(bail);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("error", onError);
    };
  }, [reduce]);

  const heroClass = [
    "hero",
    hasVideo ? "has-video" : "",
    isPlaying ? "is-playing" : "",
    headlineReady ? "is-headline-ready" : "",
    reduce ? "no-js-hero" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={heroClass} id="hero" ref={heroRef}>
      <div className="hero__bg" aria-hidden="true"></div>
      <video
        className="hero__video"
        id="heroVideo"
        ref={videoRef}
        autoPlay={!reduce}
        muted
        loop
        playsInline
        preload="auto"
        tabIndex={-1}
        aria-hidden="true"
      >
        <source src="/landing/site/hero.webm" type="video/webm" />
        <source src={HERO_SRC_DESKTOP} type="video/mp4" />
      </video>
      <div className="hero__scrim" aria-hidden="true"></div>

      <div className="container hero__inner">
        <div className="hero__content">
          <p className="hero__eyebrow">
            <span className="strike">
              <span className="strike__word">Interview</span>
              <svg
                className="strike__line"
                viewBox="0 0 300 24"
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M3 17.5 C 52 11.8, 96 15.4, 148 10.6 S 246 8.4, 297 4.2" />
              </svg>
            </span>
          </p>

          <h1 className="hero__title">
            <span className="hl" data-hl="1">
              <span className="hl__ink" aria-hidden="true"></span>
              <span className="hl__text">Evidence-based</span>
            </span>{" "}
            <span className="hl" data-hl="2">
              <span className="hl__ink" aria-hidden="true"></span>
              <span className="hl__text">hiring.</span>
            </span>
          </h1>

          <p className="hero__desc">
            ABTalks runs hackathons, cohorts and challenges where people build
            in public. Companies see the work, not a rehearsed answer. We sit
            in the middle: matching real output to real requirements, and never
            sharing a profile without the candidate saying yes first.
          </p>

          <div className="hero__actions">
            <Link href="/program" className="btn btn--primary btn--lg">
              Get Started
            </Link>
            <Link href="/talent" className="btn btn--ghost-light btn--lg">
              Post a requirement
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
