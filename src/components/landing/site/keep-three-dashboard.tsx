"use client";

import type { DashCard, DashStage } from "./landing-content";
import { DASHBOARD_STAGES } from "./landing-content";

function Card({ card }: { card: DashCard }) {
  return (
    <article className={card.fade ? "dash__card dash__card--fade" : "dash__card"}>
      <header>
        <h4>
          {card.title}
          {card.titleEm ? <em> {card.titleEm}</em> : null}
        </h4>
        {card.star ? (
          <span className="dash__star" aria-hidden="true">
            ★
          </span>
        ) : null}
        {card.when ? <span className="dash__when">{card.when}</span> : null}
        {card.score && !card.scoreNote ? (
          <div className="dash__score">
            <strong>{card.score}</strong>
          </div>
        ) : null}
      </header>
      {card.role ? <p className="dash__role">{card.role}</p> : null}
      {card.chips ? (
        <div className="dash__chips">
          {card.chips.map((chip) => (
            <span key={chip}>{chip}</span>
          ))}
        </div>
      ) : null}
      {card.meters || card.scoreNote ? (
        <div className={card.scoreNote ? "dash__row" : undefined}>
          {card.meters ? (
            <div className="dash__bars">
              {card.meters.map((width, i) => (
                <div className="dash__meter" key={i}>
                  <i style={{ width: `${width}%` }}></i>
                </div>
              ))}
            </div>
          ) : null}
          {card.score && card.scoreNote ? (
            <div className="dash__score">
              <strong>{card.score}</strong>
              <span>{card.scoreNote}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function StageBody({
  stage,
  current,
}: {
  stage: DashStage;
  current: boolean;
}) {
  return (
    <div
      className={current ? "dash__stage is-current" : "dash__stage"}
      data-stage={stage.id}
    >
      {stage.filters && stage.id === 1 ? (
        <>
          <div className="dash__filters">
            {stage.filters.map((filter) => (
              <label key={filter.label}>
                {filter.label}
                <input type="text" value={filter.value} readOnly />
              </label>
            ))}
          </div>
          <div className="dash__meta">
            <span>{stage.meta}</span>
            <span className="dash__pill">{stage.pill}</span>
          </div>
          {stage.scan ? (
            <div className="dash__scan">
              {Array.from({ length: stage.scan }, (_, i) => (
                <i key={i}></i>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="dash__meta">
            <span>{stage.meta}</span>
            <span
              className={
                stage.pillOk ? "dash__pill dash__pill--ok" : "dash__pill"
              }
            >
              {stage.pill}
            </span>
          </div>
          {stage.filters ? (
            <div className="dash__filters">
              {stage.filters.map((filter) => (
                <label key={filter.label}>
                  {filter.label}
                  <input type="text" value={filter.value} readOnly />
                </label>
              ))}
            </div>
          ) : null}
          {stage.cards?.map((card, i) => (
            <Card key={card.title + i} card={card} />
          ))}
        </>
      )}
    </div>
  );
}

export function KeepThreeDashboard({ activeStage }: { activeStage: number }) {
  return (
    <div className="dash" aria-label="Candidate shortlist preview">
      <div className="dash__bar">
        <span className="dash__logo">AB TALKS</span>
        <span className="dash__tag">Talent</span>
        <span className="dash__spacer"></span>
        <span className="dash__mini">Talent pool</span>
        <span className="dash__mini">Shortlist</span>
      </div>
      <div className="dash__body" id="dashBody">
        {DASHBOARD_STAGES.map((stage) => (
          <StageBody
            key={stage.id}
            stage={stage}
            current={stage.id === activeStage}
          />
        ))}
      </div>
    </div>
  );
}
