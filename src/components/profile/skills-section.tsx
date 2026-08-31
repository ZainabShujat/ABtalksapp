"use client";

import { useState } from "react";
import { SkillProficiency } from "@prisma/client";
import { BadgeCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSkillsAction } from "@/app/actions/candidate-profile-actions";
import { PROFICIENCY_LABELS } from "@/lib/candidate-vocab";
import { EmptyState, Field, SectionActions } from "./fields";
import { SkillCombobox, type SkillOption } from "./skill-combobox";
import { useSectionSave } from "./use-section-save";

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
  const { saving, save } = useSectionSave(saveSkillsAction, "Skills");
  const [rows, setRows] = useState<SkillRow[]>(initial);

  const selectedIds = rows.map((r) => r.skillId);
  const quickAdds = popular.filter((p) => !selectedIds.includes(p.id));

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
      onSubmit={(e) => {
        e.preventDefault();
        void save({
          claims: rows.map((r) => ({
            skillId: r.skillId,
            selfRated: r.selfRated ?? "",
          })),
        });
      }}
      className="space-y-5"
    >
      <Field
        label="Add a skill"
        htmlFor="skill-search"
        hint="Pick from the catalog so recruiters searching that skill can find you."
      >
        <SkillCombobox
          id="skill-search"
          excludeIds={selectedIds}
          onSelect={add}
        />
      </Field>

      {quickAdds.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Quick adds</p>
          <div className="flex flex-wrap gap-2">
            {quickAdds.map((s) => (
              <Button
                key={s.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => add(s)}
              >
                {s.name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState>No skills yet. Add at least three.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.skillId}
              className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/20 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.name}</span>
                  {row.verified ? (
                    <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600/90">
                      <BadgeCheck className="size-3" aria-hidden />
                      Verified
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Self-declared
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {row.verified
                    ? `${row.evidenceCount} piece${row.evidenceCount === 1 ? "" : "s"} of evidence on the platform`
                    : row.categoryName ?? "No evidence recorded yet"}
                </p>
              </div>

              <Select
                value={row.selfRated ?? ""}
                onValueChange={(v) =>
                  rate(row.skillId, v ? (v as SkillProficiency) : null)
                }
              >
                <SelectTrigger
                  size="sm"
                  className="w-40"
                  aria-label={`Self-rated proficiency for ${row.name}`}
                >
                  <SelectValue placeholder="Self-rate" />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(SkillProficiency).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROFICIENCY_LABELS[p] ?? p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(row.skillId)}
                aria-label={`Remove ${row.name}`}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Self-rating is your own assessment. <strong>Verified</strong> means the
        platform has recorded evidence — a passed activity, an assessment, a
        credential — and it is never inferred from what you rate yourself.
        Removing a skill withdraws the claim; any evidence behind it is kept.
      </p>

      <SectionActions saving={saving} saveLabel="Save skills" />
    </form>
  );
}
