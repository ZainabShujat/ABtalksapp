"use client";

import { useEffect } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { saveExperienceAction } from "@/app/actions/candidate-profile-actions";
import { COMMON_ROLES, EMPLOYMENT_TYPES } from "@/lib/candidate-vocab";
import { useSectionSave } from "./use-section-save";
import { useProfileWizard } from "./wizard-context";
import {
  PwAddMore,
  PwCheckbox,
  PwEntryCard,
  PwField,
  PwInput,
  PwMonthYear,
  PwRow,
  PwSelect,
  PwTextarea,
} from "./wizard-fields";

export type ExperienceFormRow = {
  companyName: string;
  title: string;
  employmentType: string;
  locationCity: string;
  startMonth: number | null;
  startYear: number | null;
  endMonth: number | null;
  endYear: number | null;
  isCurrent: boolean;
  description: string;
};

type FormValues = { rows: ExperienceFormRow[] };

export const emptyExperienceRow: ExperienceFormRow = {
  companyName: "",
  title: "",
  employmentType: "",
  locationCity: "",
  startMonth: null,
  startYear: null,
  endMonth: null,
  endYear: null,
  isCurrent: false,
  description: "",
};

export function ExperienceSection({
  initial,
}: {
  initial: ExperienceFormRow[];
}) {
  const { formId, onSaved, setDirty } = useProfileWizard();
  const { save } = useSectionSave(saveExperienceAction, "Experience");
  const { control, register, handleSubmit, watch, setValue, formState } =
    useForm<FormValues>({
      defaultValues: {
        rows: initial.length > 0 ? initial : [{ ...emptyExperienceRow }],
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
      replace([{ ...emptyExperienceRow }]);
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
        {fields.map((field, index) => {
          const isCurrent = watch(`rows.${index}.isCurrent`);
          const employment = watch(`rows.${index}.employmentType`);
          const extraType =
            employment &&
            !(EMPLOYMENT_TYPES as readonly string[]).includes(employment)
              ? employment
              : null;
          return (
            <PwEntryCard
              key={field.id}
              index={index}
              title="Role"
              onRemove={() => removeOrClear(index)}
            >
              <PwRow cols={2}>
                <PwField
                  label="Company"
                  required
                  htmlFor={`exp-company-${index}`}
                >
                  <PwInput
                    id={`exp-company-${index}`}
                    placeholder="e.g. Zunno AI"
                    autoComplete="off"
                    {...register(`rows.${index}.companyName`, {
                      required: true,
                    })}
                  />
                </PwField>
                <PwField label="Role" required htmlFor={`exp-title-${index}`}>
                  <PwInput
                    id={`exp-title-${index}`}
                    list={`exp-title-list-${index}`}
                    placeholder="e.g. UI/UX Designer"
                    {...register(`rows.${index}.title`, { required: true })}
                  />
                  <datalist id={`exp-title-list-${index}`}>
                    {COMMON_ROLES.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </PwField>
              </PwRow>

              <PwRow cols={2}>
                <PwField
                  label="Employment type"
                  htmlFor={`exp-type-${index}`}
                >
                  <PwSelect
                    id={`exp-type-${index}`}
                    {...register(`rows.${index}.employmentType`)}
                  >
                    <option value="">Select</option>
                    {extraType ? (
                      <option value={extraType}>{extraType}</option>
                    ) : null}
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </PwSelect>
                </PwField>
                <PwField label="Location" htmlFor={`exp-loc-${index}`}>
                  <PwInput
                    id={`exp-loc-${index}`}
                    placeholder="e.g. Gurugram"
                    {...register(`rows.${index}.locationCity`)}
                  />
                </PwField>
              </PwRow>

              <PwRow cols={1}>
                <Controller
                  control={control}
                  name={`rows.${index}.isCurrent`}
                  render={({ field: f }) => (
                    <PwCheckbox
                      id={`exp-current-${index}`}
                      checked={f.value}
                      onChange={(checked) => {
                        f.onChange(checked);
                        if (checked) {
                          setValue(`rows.${index}.endMonth`, null);
                          setValue(`rows.${index}.endYear`, null);
                        }
                      }}
                    >
                      Currently working here
                    </PwCheckbox>
                  )}
                />
              </PwRow>

              <PwRow cols={2}>
                <PwField label="Starting from" required>
                  <Controller
                    control={control}
                    name={`rows.${index}.startMonth`}
                    render={({ field: month }) => (
                      <Controller
                        control={control}
                        name={`rows.${index}.startYear`}
                        render={({ field: year }) => (
                          <PwMonthYear
                            month={month.value}
                            year={year.value}
                            onMonthChange={month.onChange}
                            onYearChange={year.onChange}
                          />
                        )}
                      />
                    )}
                  />
                </PwField>
                <div
                  style={{
                    visibility: isCurrent ? "hidden" : undefined,
                    pointerEvents: isCurrent ? "none" : undefined,
                  }}
                >
                  <PwField label="Ending in" required={!isCurrent}>
                    <Controller
                      control={control}
                      name={`rows.${index}.endMonth`}
                      render={({ field: month }) => (
                        <Controller
                          control={control}
                          name={`rows.${index}.endYear`}
                          render={({ field: year }) => (
                            <PwMonthYear
                              month={month.value}
                              year={year.value}
                              onMonthChange={month.onChange}
                              onYearChange={year.onChange}
                              disabled={isCurrent}
                            />
                          )}
                        />
                      )}
                    />
                  </PwField>
                </div>
              </PwRow>

              <PwRow cols={1}>
                <PwField
                  label="Description"
                  htmlFor={`exp-desc-${index}`}
                  area
                >
                  <PwTextarea
                    id={`exp-desc-${index}`}
                    maxLength={4000}
                    placeholder="What you owned, what you shipped, and the impact it had."
                    {...register(`rows.${index}.description`)}
                  />
                </PwField>
              </PwRow>
            </PwEntryCard>
          );
        })}
      </div>
      <PwAddMore onClick={() => append({ ...emptyExperienceRow })} />
    </form>
  );
}
