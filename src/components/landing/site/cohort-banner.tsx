"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSafeReducedMotion } from "@/lib/motion";
import "./cohort-banner.css";

/* ─── Slide data ─────────────────────────────────────────── */

type Slide = {
  id: "databricks" | "snowflake";
  bgImage: string;
  brand: string;
  subtitle: string;
  modules: string;
  registerHref: string;
  /** Clockwise from top-left: TL, TR, BL, BR. */
  topics: [string, string, string, string];
};

const SLIDES: Slide[] = [
  {
    id: "databricks",
    bgImage: "/landing/site/cohort-banner-bg.png",
    brand: "Databricks",
    subtitle: "Build a healthcare-claims Lakehouse on Databricks in",
    modules: "9",
    registerHref: "/program/databricks-ai",
    topics: [
      "Workspace, Unity Catalog, and PySpark",
      "Medallion layers: Bronze ingestion, Silver quality, Gold star schema",
      "Lakeflow Declarative Pipelines, Jobs, and Asset Bundles",
      "Governance (grants, lineage, row filters) plus SQL, AI/BI Dashboards, and Genie",
    ],
  },
  {
    id: "snowflake",
    bgImage: "/landing/site/cohort-banner-bg-snowflake.png",
    brand: "Snowflake",
    subtitle: "Build a governed Data + AI lakehouse on Snowflake in",
    modules: "6",
    registerHref: "/program/snowflake",
    topics: [
      "Snowflake architecture, RBAC, Horizon governance, Time Travel and cloning",
      "COPY INTO, Snowpipe, Streams & Tasks, Dynamic Tables and Snowpark",
      "dbt Projects, CI/CD with the SnowflakeCLI, performance and cost control",
      "Snowpark ML, Feature Store, Model Registry, Cortex Search and Cortex Agents",
    ],
  },
];

const INTERVAL_MS = 5000;

/* Arrow paths in the 490×215 diagram space (node centred at 235,125). */
const ARROW_PATHS = [
  "M 196 84 Q 186 64 168 58",
  "M 272 80 Q 282 62 300 56",
  "M 196 166 Q 186 184 168 188",
  "M 280 160 Q 292 174 308 174",
] as const;

const TOPIC_POS = ["tl", "tr", "bl", "br"] as const;

/* ─── Icons ──────────────────────────────────────────────── */

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 6.5V12l3.5 2" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 7.5 12 3 3 7.5v9L12 21l9-4.5z" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </svg>
  );
}

function CapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3.5 1 9l11 5.5 9-4.5v5.5h1.6V9z" />
      <path d="M5.5 12.8v3.7c0 1.9 2.9 3.5 6.5 3.5s6.5-1.6 6.5-3.5v-3.7L12 16.1z" />
      <circle cx="21.8" cy="16.6" r="1.3" />
    </svg>
  );
}

/* ─── Single slide ───────────────────────────────────────── */

function CohortSlide({ slide, active }: { slide: Slide; active: boolean }) {
  const markerId = `cb-arrow-${slide.id}`;

  return (
    <article
      className="cb-slide"
      data-theme={slide.id}
      style={{ backgroundImage: `url('${slide.bgImage}')` }}
      aria-hidden={!active}
      aria-roledescription="slide"
      aria-label={`${slide.brand} Cohort`}
    >
      <div className="cb-slide__inner">
        {/* ── LEFT ── */}
        <div className="cb-left">
          <span className="cb-pill">Registrations are live</span>

          <h3 className="cb-heading">
            <span className="cb-accent">{slide.brand}</span> Cohort
          </h3>

          <p className="cb-subtitle">
            {slide.subtitle} <span className="cb-accent">15 days</span>
          </p>

          <div className="cb-bottom">
            <div className="cb-meta">
              <div className="cb-meta__item">
                <ClockIcon />
                <span>
                  <span className="cb-meta__value">15 Days</span>
                  <span className="cb-meta__label">Cohort</span>
                </span>
              </div>
              <div className="cb-meta__item">
                <BoxIcon />
                <span>
                  <span className="cb-meta__value">{slide.modules}</span>
                  <span className="cb-meta__label">Modules</span>
                </span>
              </div>
            </div>

            <Link
              href={slide.registerHref}
              className="cb-cta"
              tabIndex={active ? undefined : -1}
            >
              Register Now
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Link>
          </div>
        </div>

        {/* ── CENTER: what you'll learn ── */}
        <div className="cb-learn">
          <svg className="cb-learn__arrows" viewBox="0 0 490 215" fill="none" aria-hidden="true">
            <defs>
              <marker id={markerId} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {ARROW_PATHS.map((d) => (
              <path
                key={d}
                d={d}
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                markerEnd={`url(#${markerId})`}
              />
            ))}
          </svg>

          <p className="cb-learn__node">
            What you&lsquo;ll learn
          </p>

          <ul className="cb-learn__topics">
            {slide.topics.map((topic, i) => (
              <li key={topic} className={`cb-topic cb-topic--${TOPIC_POS[i]}`}>
                {topic}
              </li>
            ))}
          </ul>
        </div>

        {/* ── RIGHT ── */}
        <div className="cb-ribbon" aria-hidden="true">
          <span>Data</span>
          <span>&amp; AI</span>
          <span>Engineering</span>
        </div>

        <div className="cb-badge">
          <span className="cb-badge__icon">
            <CapIcon />
          </span>
          <span className="cb-badge__text">
            <span className="cb-badge__label">Get Job Ready</span>
            <span className="cb-badge__value">In 15 Days</span>
          </span>
        </div>
      </div>
    </article>
  );
}

/* ─── Slideshow ──────────────────────────────────────────── */

export function CohortBanner() {
  const reduce = useSafeReducedMotion();
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const start = useCallback(() => {
    stop();
    timerRef.current = setInterval(() => {
      setCurrent((prev) => (prev + 1) % SLIDES.length);
    }, INTERVAL_MS);
  }, [stop]);

  useEffect(() => {
    if (reduce || paused) {
      stop();
      return;
    }
    start();
    return stop;
  }, [reduce, paused, start, stop]);

  return (
    <div
      className="cb-wrap"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        className="cb-show"
        role="region"
        aria-roledescription="carousel"
        aria-label="Upcoming cohorts"
      >
        <div
          className="cb-track"
          style={{ transform: `translateX(-${current * 100}%)` }}
        >
          {SLIDES.map((slide, i) => (
            <CohortSlide key={slide.id} slide={slide} active={i === current} />
          ))}
        </div>
      </div>

      <div className="cb-dots" role="tablist" aria-label="Choose cohort">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            role="tab"
            aria-selected={i === current}
            aria-label={`Show ${slide.brand} cohort`}
            className={i === current ? "cb-dot is-active" : "cb-dot"}
            onClick={() => {
              setCurrent(i);
              if (!reduce && !paused) start();
            }}
          />
        ))}
      </div>
    </div>
  );
}
