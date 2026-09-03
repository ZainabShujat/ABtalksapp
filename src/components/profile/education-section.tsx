"use client";

import { useEffect } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { GradeType } from "@prisma/client";
import { CollegeCombobox } from "@/components/shared/college-combobox";
import { saveEducationAction } from "@/app/actions/candidate-profile-actions";
import {
  DEGREES,
  FIELDS_OF_STUDY,
  GRADE_TYPE_LABELS,
} from "@/lib/candidate-vocab";
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
  PwSuggest,
  PwTextarea,
} from "./wizard-fields";

export type EducationFormRow = {
  institutionName: string;
  collegeId: string;
  degree: string;
  fieldOfStudy: string;
  startMonth: number | null;
  startYear: number | null;
  endMonth: number | null;
  graduationYear: number | null;
  isCurrent: boolean;
  gradeType: GradeType | "";
  grade: string;
  description: string;
};

type FormValues = { rows: EducationFormRow[] };

export const emptyEducationRow: EducationFormRow = {
  institutionName: "",
  collegeId: "",
  degree: "",
  fieldOfStudy: "",
  startMonth: null,
  startYear: null,
  endMonth: null,
  graduationYear: null,
  isCurrent: false,
  gradeType: "",
  grade: "",
  description: "",
};

const GRADE_PLACEHOLDER: Record<string, string> = {
  PERCENTAGE: "e.g. 82.5",
  CGPA_10: "e.g. 8.6",
  GPA_4: "e.g. 3.7",
  GRADE: "e.g. A+",
  OTHER: "e.g. Distinction",
};

export function EducationSection({ initial }: { initial: EducationFormRow[] }) {
  const { formId, onSaved, setDirty } = useProfileWizard();
  const { save } = useSectionSave(saveEducationAction, "Education");
  const { control, register, handleSubmit, watch, setValue, formState } =
    useForm<FormValues>({
      defaultValues: {
        rows: initial.length > 0 ? initial : [{ ...emptyEducationRow }],
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
      replace([{ ...emptyEducationRow }]);
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
          const gradeType = watch(`rows.${index}.gradeType`);
          return (
            <PwEntryCard
              key={field.id}
              index={index}
              title="Education"
              onRemove={() => removeOrClear(index)}
            >
              <PwRow cols={1}>
                <PwField label="School / College" required>
                  <Controller
                    control={control}
                    name={`rows.${index}.institutionName`}
                    rules={{ required: true }}
                    render={({ field: f }) => (
                      <CollegeCombobox
                        id={`edu-college-${index}`}
                        value={f.value}
                        onChange={(name, collegeId) => {
                          f.onChange(name);
                          setValue(`rows.${index}.collegeId`, collegeId ?? "");
                        }}
                        placeholder="e.g. Banasthali Vidyapith"
                      />
                    )}
                  />
                </PwField>
              </PwRow>

              <PwRow cols={2}>
                <PwField label="Degree" htmlFor={`edu-degree-${index}`}>
                  <PwSuggest
                    id={`edu-degree-${index}`}
                    placeholder="e.g. B.Tech"
                    suggestions={DEGREES}
                    {...register(`rows.${index}.degree`)}
                  />
                </PwField>
                <PwField
                  label="Department / field"
                  htmlFor={`edu-field-${index}`}
                >
                  <PwSuggest
                    id={`edu-field-${index}`}
                    placeholder="e.g. Computer Science and Engineering"
                    suggestions={FIELDS_OF_STUDY}
                    {...register(`rows.${index}.fieldOfStudy`)}
                  />
                </PwField>
              </PwRow>

              <PwRow cols={1}>
                <Controller
                  control={control}
                  name={`rows.${index}.isCurrent`}
                  render={({ field: f }) => (
                    <PwCheckbox
                      id={`edu-current-${index}`}
                      checked={f.value}
                      onChange={(checked) => {
                        f.onChange(checked);
                        if (checked) {
                          setValue(`rows.${index}.endMonth`, null);
                          setValue(`rows.${index}.graduationYear`, null);
                        }
                      }}
                    >
                      Currently studying here
                    </PwCheckbox>
                  )}
                />
              </PwRow>

              <PwRow cols={2}>
                <PwField label="Starting from">
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
                          name={`rows.${index}.graduationYear`}
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

              <PwRow cols={2}>
                <PwField label="Score type" htmlFor={`edu-grade-type-${index}`}>
                  <PwSelect
                    id={`edu-grade-type-${index}`}
                    {...register(`rows.${index}.gradeType`)}
                  >
                    <option value="">Select</option>
                    {Object.values(GradeType).map((g) => (
                      <option key={g} value={g}>
                        {GRADE_TYPE_LABELS[g] ?? g}
                      </option>
                    ))}
                  </PwSelect>
                </PwField>
                <PwField label="Score" htmlFor={`edu-grade-${index}`}>
                  <PwInput
                    id={`edu-grade-${index}`}
                    placeholder={
                      gradeType ? GRADE_PLACEHOLDER[gradeType] : "e.g. 7.9"
                    }
                    {...register(`rows.${index}.grade`)}
                  />
                </PwField>
              </PwRow>

              <PwRow cols={1}>
                <PwField
                  label="Description"
                  htmlFor={`edu-desc-${index}`}
                  area
                >
                  <PwTextarea
                    id={`edu-desc-${index}`}
                    maxLength={4000}
                    placeholder="Coursework, thesis, societies, or anything else worth knowing."
                    {...register(`rows.${index}.description`)}
                  />
                </PwField>
              </PwRow>
            </PwEntryCard>
          );
        })}
      </div>
      <PwAddMore onClick={() => append({ ...emptyEducationRow })} />
    </form>
  );
}
