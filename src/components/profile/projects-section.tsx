"use client";

import { useEffect } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { saveProjectsAction } from "@/app/actions/candidate-profile-actions";
import { useSectionSave } from "./use-section-save";
import { useProfileWizard } from "./wizard-context";
import {
  PwAddMore,
  PwEntryCard,
  PwField,
  PwInput,
  PwRow,
  PwTags,
  PwTextarea,
} from "./wizard-fields";

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
  const { formId, onSaved, setDirty } = useProfileWizard();
  const { save } = useSectionSave(saveProjectsAction, "Projects");
  const { control, register, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: {
      rows: initial.length > 0 ? initial : [{ ...emptyProjectRow }],
    },
  });
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: "rows",
  });

  useEffect(() => {
    setDirty(formState.isDirty);
  }, [formState.isDirty, setDirty]);

  function removeOrClear(index: number) {
    if (fields.length === 1) {
      replace([{ ...emptyProjectRow }]);
      return;
    }
    remove(index);
  }

  return (
    <form
      id={formId}
      onSubmit={handleSubmit(async (v) => {
        if (await save(v)) onSaved();
      })}
    >
      <div className="pw-entries">
        {fields.map((field, index) => (
          <PwEntryCard
            key={field.id}
            index={index}
            title="Project"
            onRemove={() => removeOrClear(index)}
          >
            <PwRow cols={1}>
              <PwField
                label="Project name"
                required
                htmlFor={`prj-title-${index}`}
              >
                <PwInput
                  id={`prj-title-${index}`}
                  placeholder="e.g. Campus Ride Sharing App"
                  {...register(`rows.${index}.title`, { required: true })}
                />
              </PwField>
            </PwRow>

            <PwRow cols={1}>
              <PwField
                label="Description"
                htmlFor={`prj-desc-${index}`}
                area
              >
                <PwTextarea
                  id={`prj-desc-${index}`}
                  maxLength={4000}
                  placeholder="What it does, what was hard about it, and what you built yourself."
                  {...register(`rows.${index}.description`)}
                />
              </PwField>
            </PwRow>

            <PwRow cols={1}>
              <PwField label="Tech stack">
                <Controller
                  control={control}
                  name={`rows.${index}.techStack`}
                  render={({ field: f }) => (
                    <PwTags
                      id={`prj-tech-${index}`}
                      values={f.value}
                      onChange={f.onChange}
                      placeholder="ex: Next.js, Postgres"
                      helper="Descriptive only — this does not add to your skills."
                    />
                  )}
                />
              </PwField>
            </PwRow>

            <PwRow cols={2}>
              <PwField label="GitHub" htmlFor={`prj-repo-${index}`}>
                <PwInput
                  id={`prj-repo-${index}`}
                  type="url"
                  inputMode="url"
                  placeholder="https://github.com/..."
                  {...register(`rows.${index}.repoUrl`)}
                />
              </PwField>
              <PwField label="Live URL" htmlFor={`prj-live-${index}`}>
                <PwInput
                  id={`prj-live-${index}`}
                  type="url"
                  inputMode="url"
                  placeholder="https://www.example.com/"
                  {...register(`rows.${index}.liveUrl`)}
                />
              </PwField>
            </PwRow>
          </PwEntryCard>
        ))}
      </div>
      <PwAddMore onClick={() => append({ ...emptyProjectRow })} />
    </form>
  );
}
