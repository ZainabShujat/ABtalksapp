"use client";

import { useEffect, useState } from "react";
import { SkillProficiency } from "@prisma/client";
import { saveSkillsAction } from "@/app/actions/candidate-profile-actions";
import { PROFICIENCY_LABELS } from "@/lib/candidate-vocab";
import { SkillCombobox, type SkillOption } from "./skill-combobox";
import { useSectionSave } from "./use-section-save";
import { useProfileWizard } from "./wizard-context";
import { PwField, PwNote, PwRow } from "./wizard-fields";

export type SkillRow = {
  skillId: string;
  name: string;
  categoryName: string | null;
  selfRated: SkillProficiency | null;
  /** From `SkillEvidence` alone. Never derived from `selfRated`. */
  verified: boolean;
  evidenceCount: number;
};

export function SkillsSection({
  initial,
  popular,
}: {
  initial: SkillRow[];
  popular: SkillOption[];
}) {
  const { formId, onSaved, setDirty } = useProfileWizard();
  const { save } = useSectionSave(saveSkillsAction, "Skills");
  const [rows, setRows] = useState<SkillRow[]>(initial);

  const selectedIds = rows.map((r) => r.skillId);
  const quickAdds = popular.filter((p) => !selectedIds.includes(p.id));

  useEffect(() => {
    setDirty(JSON.stringify(rows) !== JSON.stringify(initial));
  }, [rows, initial, setDirty]);

  function add(skill: SkillOption) {
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
        if (ok) onSaved();
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
              excludeIds={selectedIds}
              onSelect={add}
            />
          </div>
          {quickAdds.length > 0 ? (
            <div className="pw-quick-adds">
              <div className="pw-quick-label">Quick adds</div>
              <div className="pw-quick-row">
                {quickAdds.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="pw-quick-chip"
                    onClick={() => add(s)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="pw-tag-list pw-tag-list-boxed">
            {rows.length === 0 ? (
              <div className="pw-tag-empty">
                No skills yet. Add at least three.
              </div>
            ) : (
              rows.map((row) => (
                <span key={row.skillId} className="pw-tag-chip">
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
        platform has recorded evidence — a passed activity, an assessment, a
        credential — and it is never inferred from what you rate yourself.
        Removing a skill withdraws the claim; any evidence behind it is kept.
      </PwNote>
    </form>
  );
}
