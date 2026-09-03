"use client";

import { useEffect, useMemo, useState } from "react";
import { SkillProficiency } from "@prisma/client";
import {
  resolveSkillAction,
  saveSkillsAction,
} from "@/app/actions/candidate-profile-actions";
import { PROFILE_QUICK_SKILLS, PROFICIENCY_LABELS } from "@/lib/candidate-vocab";
import { SkillCombobox, type SkillOption } from "./skill-combobox";
import { useSectionSave } from "./use-section-save";
import { useProfileWizard } from "./wizard-context";
import { PwField, PwInput, PwNote, PwRow } from "./wizard-fields";

export type SkillRow = {
  skillId: string;
  name: string;
  categoryName: string | null;
  selfRated: SkillProficiency | null;
  /** From `SkillEvidence` alone. Never derived from `selfRated`. */
  verified: boolean;
  evidenceCount: number;
};

function mergeCatalog(resolved: readonly SkillOption[]): SkillOption[] {
  const byName = new Map(
    resolved.map((s) => [s.name.toLowerCase(), s] as const),
  );
  const bySlug = new Map(resolved.map((s) => [s.slug, s] as const));
  return PROFILE_QUICK_SKILLS.map((name) => {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return (
      byName.get(name.toLowerCase()) ??
      bySlug.get(slug) ?? {
        id: "",
        name,
        slug: "",
        categoryName: null,
      }
    );
  });
}

export function SkillsSection({
  initial,
  catalog,
}: {
  initial: SkillRow[];
  catalog: SkillOption[];
}) {
  const { formId, onSaved, setDirty } = useProfileWizard();
  const { save } = useSectionSave(saveSkillsAction, "Skills");
  const [rows, setRows] = useState<SkillRow[]>(initial);
  const [persistedIds, setPersistedIds] = useState(
    () => new Set(initial.map((r) => r.skillId)),
  );
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherDraft, setOtherDraft] = useState("");
  const [otherError, setOtherError] = useState<string | null>(null);
  const [otherBusy, setOtherBusy] = useState(false);

  const options = useMemo(() => mergeCatalog(catalog), [catalog]);
  const selectedIds = rows.map((r) => r.skillId).filter((id) => id.length > 0);
  const selectedNames = rows.map((r) => r.name);
  const selectedNameSet = new Set(selectedNames.map((n) => n.toLowerCase()));
  const quickAdds = options.filter(
    (s) =>
      !(s.id && selectedIds.includes(s.id)) &&
      !selectedNameSet.has(s.name.toLowerCase()),
  );

  useEffect(() => {
    setPersistedIds(new Set(initial.map((r) => r.skillId)));
  }, [initial]);

  useEffect(() => {
    setDirty(JSON.stringify(rows) !== JSON.stringify(initial));
  }, [rows, initial, setDirty]);

  function add(skill: SkillOption) {
    if (!skill.id) return;
    setRows((prev) =>
      prev.some((r) => r.skillId === skill.id)
        ? prev
        : [
            ...prev,
            {
              skillId: skill.id,
              name: skill.name,
              categoryName: skill.categoryName,
              selfRated: null,
              verified: false,
              evidenceCount: 0,
            },
          ],
    );
  }

  async function addOrResolve(skill: SkillOption) {
    if (skill.id) {
      add(skill);
      return;
    }
    setOtherBusy(true);
    setOtherError(null);
    try {
      const result = await resolveSkillAction({ name: skill.name });
      if (!result.ok) {
        setOtherError(result.message);
        return;
      }
      add(result.data);
    } finally {
      setOtherBusy(false);
    }
  }

  async function submitOther() {
    const name = otherDraft.trim();
    if (!name) return;
    if (selectedNameSet.has(name.toLowerCase())) {
      setOtherDraft("");
      setOtherError(null);
      return;
    }
    const fromCatalog = options.find(
      (s) => s.name.toLowerCase() === name.toLowerCase() && s.id,
    );
    if (fromCatalog) {
      add(fromCatalog);
      setOtherDraft("");
      setOtherError(null);
      return;
    }
    setOtherBusy(true);
    setOtherError(null);
    try {
      const result = await resolveSkillAction({ name });
      if (!result.ok) {
        setOtherError(result.message);
        return;
      }
      add(result.data);
      setOtherDraft("");
    } finally {
      setOtherBusy(false);
    }
  }

  function remove(skillId: string) {
    setRows((prev) => prev.filter((r) => r.skillId !== skillId));
  }

  function rate(skillId: string, selfRated: SkillProficiency | null) {
    setRows((prev) =>
      prev.map((r) => (r.skillId === skillId ? { ...r, selfRated } : r)),
    );
  }

  return (
    <form
      id={formId}
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await save({
          claims: rows.map((r) => ({
            skillId: r.skillId,
            selfRated: r.selfRated ?? "",
          })),
        });
        if (ok) {
          setPersistedIds(new Set(rows.map((r) => r.skillId)));
          onSaved();
        }
      }}
    >
      <PwRow cols={1}>
        <PwField
          label="Add a skill"
          htmlFor="skill-search"
          helper="Pick from the catalog so recruiters searching that skill can find you."
        >
          <div className="pw-tag-input-row">
            <SkillCombobox
              id="skill-search"
              catalog={options}
              excludeIds={selectedIds}
              excludeNames={selectedNames}
              onSelect={(skill) => void addOrResolve(skill)}
              onOther={() => {
                setOtherOpen(true);
                setOtherError(null);
              }}
            />
          </div>
          <div className="pw-quick-adds">
            <div className="pw-quick-label">Quick adds</div>
            <div className="pw-quick-row">
              {quickAdds.map((s) => (
                <button
                  key={s.id || s.name}
                  type="button"
                  className="pw-quick-chip"
                  disabled={otherBusy}
                  onClick={() => void addOrResolve(s)}
                >
                  {s.name}
                </button>
              ))}
              <button
                type="button"
                className={`pw-quick-chip pw-quick-other${otherOpen ? " pw-open" : ""}`}
                onClick={() => {
                  setOtherOpen((open) => !open);
                  setOtherError(null);
                }}
              >
                Other
              </button>
            </div>
          </div>
          {otherOpen ? (
            <div className="pw-skill-other">
              <div className="pw-tag-input-row">
                <PwInput
                  id="skill-other"
                  placeholder="Type a skill name"
                  value={otherDraft}
                  disabled={otherBusy}
                  onChange={(e) => setOtherDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void submitOther();
                    }
                  }}
                />
                <button
                  type="button"
                  className="pw-tag-add"
                  aria-label="Add skill"
                  disabled={otherBusy || otherDraft.trim().length === 0}
                  onClick={() => void submitOther()}
                >
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
              {otherError ? (
                <div className="pw-skill-other-error" role="alert">
                  {otherError}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="pw-tag-list pw-tag-list-boxed">
            {rows.length === 0 ? (
              <div className="pw-tag-empty">
                No skills yet. Add at least one.
              </div>
            ) : (
              rows.map((row) => (
                <span key={row.skillId} className="pw-tag-chip">
                  {persistedIds.has(row.skillId) ? (
                    <svg
                      className="pw-skill-saved-tick"
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : null}
                  <span>{row.name}</span>
                  <select
                    aria-label={`Self-rated proficiency for ${row.name}`}
                    value={row.selfRated ?? ""}
                    onChange={(e) =>
                      rate(
                        row.skillId,
                        e.target.value
                          ? (e.target.value as SkillProficiency)
                          : null,
                      )
                    }
                  >
                    <option value="">Rate</option>
                    {Object.values(SkillProficiency).map((p) => (
                      <option key={p} value={p}>
                        {PROFICIENCY_LABELS[p] ?? p}
                      </option>
                    ))}
                  </select>
                  {row.verified ? (
                    <span className="pw-verified">Verified</span>
                  ) : null}
                  <button
                    type="button"
                    className="pw-tag-remove"
                    aria-label={`Remove ${row.name}`}
                    onClick={() => remove(row.skillId)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </span>
              ))
            )}
          </div>
        </PwField>
      </PwRow>

      <PwNote muted>
        Self-rating is your own assessment. <strong>Verified</strong> means the
        platform has recorded evidence eg. a passed activity, an assessment, a
        credential and it is never inferred from what you rate yourself.
        Removing a skill withdraws the claim; any evidence behind it is kept.
      </PwNote>
    </form>
  );
}
