"use client";

import { Controller, useFieldArray, useForm } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveProjectsAction } from "@/app/actions/candidate-profile-actions";
import {
  ChipInput,
  EmptyState,
  Field,
  RowCard,
  SectionActions,
} from "./fields";
import { useSectionSave } from "./use-section-save";

export type ProjectFormRow = {
  title: string;
  description: string;
  techStack: string[];
  repoUrl: string;
  liveUrl: string;
};

type FormValues = { rows: ProjectFormRow[] };

export const emptyProjectRow: ProjectFormRow = {
  title: "",
  description: "",
  techStack: [],
  repoUrl: "",
  liveUrl: "",
};

export function ProjectsSection({ initial }: { initial: ProjectFormRow[] }) {
  const { saving, save } = useSectionSave(saveProjectsAction, "Projects");
  const { control, register, handleSubmit } = useForm<FormValues>({
    defaultValues: { rows: initial },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "rows" });

  return (
    <form onSubmit={handleSubmit((v) => save(v))} className="space-y-4">
      {fields.length === 0 ? (
        <EmptyState>
          Nothing here yet. A project with a repo a recruiter can open is worth
          more than a line on a résumé.
        </EmptyState>
      ) : null}

      {fields.map((field, index) => (
        <RowCard
          key={field.id}
          index={index}
          title="Project"
          onRemove={() => remove(index)}
        >
          <Field label="Project name" required htmlFor={`prj-title-${index}`}>
            <Input
              id={`prj-title-${index}`}
              placeholder="ex: Realtime transit tracker"
              {...register(`rows.${index}.title`, { required: true })}
            />
          </Field>

          <Field label="Description" htmlFor={`prj-desc-${index}`}>
            <Textarea
              id={`prj-desc-${index}`}
              rows={3}
              maxLength={4000}
              placeholder="What it does, what was hard about it, and what you built yourself."
              {...register(`rows.${index}.description`)}
            />
          </Field>

          <Field
            label="Tech stack"
            hint="Descriptive only — this does not add to your skills."
          >
            <Controller
              control={control}
              name={`rows.${index}.techStack`}
              render={({ field: f }) => (
                <ChipInput
                  values={f.value}
                  onChange={f.onChange}
                  placeholder="ex: Next.js, Postgres"
                  max={20}
                />
              )}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="GitHub" htmlFor={`prj-repo-${index}`}>
              <Input
                id={`prj-repo-${index}`}
                type="url"
                inputMode="url"
                placeholder="https://github.com/…"
                {...register(`rows.${index}.repoUrl`)}
              />
            </Field>
            <Field label="Live URL" htmlFor={`prj-live-${index}`}>
              <Input
                id={`prj-live-${index}`}
                type="url"
                inputMode="url"
                placeholder="https://…"
                {...register(`rows.${index}.liveUrl`)}
              />
            </Field>
          </div>
        </RowCard>
      ))}

      <SectionActions
        saving={saving}
        onAdd={() => append({ ...emptyProjectRow })}
        addLabel={fields.length === 0 ? "Add project" : "Add another"}
      />
    </form>
  );
}
