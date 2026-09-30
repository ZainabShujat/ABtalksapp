"use client";

import { useState } from "react";
import type { CandidateRecruiterView } from "@/features/profile/recruiter-view";
import { TickIcon } from "./rv-icons";

/**
 * The detail panel a recruiter opens, rebuilt for the candidate's own page.
 *
 * Four tabs in the order the real inspector uses (`candidate-inspector.tsx:84`),
 * defaulting to evidence for the same reason it does: evidence is the only thing
 * on a profile a CV cannot claim.
 *
 * The recruiter's fifth tab — Contact — is ABSENT, along with everything behind
 * the paid unlock: no email, no phone, no résumé, no LinkedIn or GitHub URL.
 */

const TABS = [
  { id: "evidence", label: "ABTalks Evidence" },
  { id: "experience", label: "Experience" },
  { id: "education", label: "Education" },
  { id: "skills", label: "Skills" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function PanelPreview({ tabs }: { tabs: CandidateRecruiterView["tabs"] }) {
  const [tab, setTab] = useState<TabId>("evidence");

  return (
    <div className="rv-frame">
      <div className="rv-frame__bar">
        <span className="rv-frame__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="rv-frame__label">ABTalks Hire · candidate detail</span>
      </div>

      <div className="rv-frame__body">
        <div className="rv-panel">
          <div className="rv-tabs" role="tablist" aria-label="Recruiter detail panel">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`rv-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`rv-tabpanel-${t.id}`}
                className="rv-tab"
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div
            className="rv-tabpanel"
            role="tabpanel"
            id={`rv-tabpanel-${tab}`}
            aria-labelledby={`rv-tab-${tab}`}
            tabIndex={0}
          >
            {tab === "evidence" && <EvidenceTab tabs={tabs} />}
            {tab === "experience" && <ExperienceTab tabs={tabs} />}
            {tab === "education" && <EducationTab tabs={tabs} />}
            {tab === "skills" && <SkillsTab tabs={tabs} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function EvidenceTab({ tabs }: { tabs: CandidateRecruiterView["tabs"] }) {
  if (tabs.awards.length === 0 && tabs.workingLanguages.length === 0) {
    return (
      <p className="rv-empty">
        Recruiters see nothing here yet. Finishing a challenge or a cohort puts a
        verified record on this tab — it is the one part of your profile a CV
        cannot claim.
      </p>
    );
  }

  return (
    <>
      {tabs.awards.map((award) => (
        <div className="rv-award" key={award.key}>
          <div className="rv-award__meta">
            <span className="rv-item__title">{award.title}</span>
            {award.detail && <span className="rv-item__body">{award.detail}</span>}
            {award.occurredOn && (
              <span className="rv-item__span">{award.occurredOn}</span>
            )}
          </div>
          <span className="rv-award__pill">{award.outcomeLabel}</span>
        </div>
      ))}

      {tabs.workingLanguages.length > 0 && (
        <div className="rv-kv__pair">
          <span className="rv-kv__k">Languages you have shipped in</span>
          <div className="rv-chips">
            {tabs.workingLanguages.map((lang) => (
              <span className="rv-chip rv-chip--verified" key={lang}>
                <TickIcon className="rv-chip__tick" />
                {lang}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function ExperienceTab({ tabs }: { tabs: CandidateRecruiterView["tabs"] }) {
  if (tabs.jobs.length === 0) {
    return (
      <p className="rv-empty">
        {tabs.hasNoWorkExperience
          ? "Recruiters see that you are yet to start work. That is an answer, not a gap — a minimum-experience filter can still read it."
          : "Recruiters see nothing on this tab, and you have not said you are yet to start work either. Any search filtered on experience leaves you out."}
      </p>
    );
  }

  return (
    <>
      {tabs.jobs.map((job) => (
        <div className="rv-item" key={job.id}>
          <div className="rv-item__head">
            <span className="rv-item__title">{job.title}</span>
            <span className="rv-item__where">
              {job.companyName}
              {job.employmentType ? ` · ${job.employmentType}` : ""}
              {job.locationCity ? ` · ${job.locationCity}` : ""}
            </span>
          </div>
          {job.span && <span className="rv-item__span">{job.span}</span>}
          {job.description && <p className="rv-item__body">{job.description}</p>}
        </div>
      ))}
    </>
  );
}

function EducationTab({ tabs }: { tabs: CandidateRecruiterView["tabs"] }) {
  return (
    <>
      {tabs.education.level ? (
        <div className="rv-kv">
          <div className="rv-kv__pair">
            <span className="rv-kv__k">What recruiters see</span>
            <span className="rv-kv__v">{tabs.education.level}</span>
          </div>
        </div>
      ) : (
        <p className="rv-empty">
          Recruiters see no education, so a search filtered by graduation year
          leaves you out.
        </p>
      )}
      <p className="rv-item__body">{tabs.education.note}</p>
    </>
  );
}

function SkillsTab({ tabs }: { tabs: CandidateRecruiterView["tabs"] }) {
  if (tabs.skills.length === 0) {
    return (
      <p className="rv-empty">
        You have no skills on your profile. Skills are the first thing a recruiter
        searches on, so without any there is nothing for a search to match.
      </p>
    );
  }

  const verified = tabs.skills.filter((s) => s.evidenceBacked);
  const declared = tabs.skills.filter((s) => !s.evidenceBacked);

  return (
    <>
      {verified.length > 0 && (
        <div className="rv-kv__pair">
          <span className="rv-kv__k">Verified by ABTalks</span>
          <div className="rv-chips">
            {verified.map((s) => (
              <span className="rv-chip rv-chip--verified" key={s.name}>
                <TickIcon className="rv-chip__tick" />
                {s.name}
              </span>
            ))}
          </div>
          <p className="rv-item__body">
            Earned by finishing a track that teaches them. Recruiters can tell
            these apart from the ones you typed in.
          </p>
        </div>
      )}

      {declared.length > 0 && (
        <div className="rv-kv__pair">
          <span className="rv-kv__k">Your own claim</span>
          <div className="rv-chips">
            {declared.map((s) => (
              <span className="rv-chip" key={s.name}>
                {s.name}
              </span>
            ))}
          </div>
          <p className="rv-item__body">
            These match a recruiter&rsquo;s search exactly as the verified ones do.
            They are simply labelled as yours rather than as ours.
          </p>
        </div>
      )}
    </>
  );
}
