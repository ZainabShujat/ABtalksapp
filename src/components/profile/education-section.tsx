"use client";

import { Controller, useFieldArray, useForm } from "react-hook-form";
import { GradeType } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CollegeCombobox } from "@/components/shared/college-combobox";
import { saveEducationAction } from "@/app/actions/candidate-profile-actions";
import {
  DEGREES,
  FIELDS_OF_STUDY,
  GRADE_TYPE_LABELS,
  yearRange,
} from "@/lib/candidate-vocab";
import {
  EmptyState,
  Field,
  MonthYearField,
  RowCard,
  SectionActions,
  SuggestInput,
} from "./fields";
import { useSectionSave } from "./use-section-save";

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

// Forward five years so a first-year student can enter their expected graduation.
const YEARS = yearRange(45, 8);

const GRADE_PLACEHOLDER: Record<string, string> = {
  PERCENTAGE: "ex: 82.5",
  CGPA_10: "ex: 8.6",
  GPA_4: "ex: 3.7",
  GRADE: "ex: A+",
  OTHER: "ex: Distinction",
};

export function EducationSection({ initial }: { initial: EducationFormRow[] }) {
  const { saving, save } = useSectionSave(saveEducationAction, "Education");
  const { control, register, handleSubmit, watch, setValue } =
    useForm<FormValues>({ defaultValues: { rows: initial } });
  const { fields, append, remove } = useFieldArray({ control, name: "rows" });

  return (
    <form onSubmit={handleSubmit((v) => save(v))} className="space-y-4">
      {fields.length === 0 ? (
        <EmptyState>
          No education yet. Add your college, and school if it is relevant.
        </EmptyState>
      ) : null}

      {fields.map((field, index) => {
        const isCurrent = watch(`rows.${index}.isCurrent`);
        const gradeType = watch(`rows.${index}.gradeType`);
        return (
          <RowCard
            key={field.id}
            index={index}
            title="Education"
            onRemove={() => remove(index)}
          >
            <Field label="School / College" required>
              <Controller
                control={control}
                name={`rows.${index}.institutionName`}
                render={({ field: f }) => (
                  <CollegeCombobox
                    id={`edu-college-${index}`}
                    value={f.value}
                    onChange={(name, collegeId) => {
                      f.onChange(name);
                      // Null keeps the row free-text; a real id links the catalog
                      // entry so recruiter filters can match on it.
                      setValue(`rows.${index}.collegeId`, collegeId ?? "");
                    }}
                  />
                )}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Degree" htmlFor={`edu-degree-${index}`}>
                <Controller
                  control={control}
                  name={`rows.${index}.degree`}
                  render={({ field: f }) => (
                    <SuggestInput
                      id={`edu-degree-${index}`}
                      value={f.value}
                      onChange={f.onChange}
                      options={DEGREES}
                      placeholder="ex: B.E"
                    />
                  )}
                />
              </Field>

              <Field label="Department / field" htmlFor={`edu-field-${index}`}>
                <Controller
                  control={control}
                  name={`rows.${index}.fieldOfStudy`}
                  render={({ field: f }) => (
                    <SuggestInput
                      id={`edu-field-${index}`}
                      value={f.value}
                      onChange={f.onChange}
                      options={FIELDS_OF_STUDY}
                      placeholder="ex: Computer Science and Engineering"
                    />
                  )}
                />
              </Field>
            </div>

            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name={`rows.${index}.isCurrent`}
                render={({ field: f }) => (
                  <Checkbox
                    id={`edu-current-${index}`}
                    checked={f.value}
                    onCheckedChange={(checked) => {
                      f.onChange(checked === true);
                      if (checked === true) {
                        setValue(`rows.${index}.endMonth`, null);
                        setValue(`rows.${index}.graduationYear`, null);
                      }
                    }}
                  />
                )}
              />
              <Label htmlFor={`edu-current-${index}`} className="font-normal">
                Currently studying here
              </Label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={control}
                name={`rows.${index}.startMonth`}
                render={({ field: month }) => (
                  <Controller
                    control={control}
                    name={`rows.${index}.startYear`}
                    render={({ field: year }) => (
                      <MonthYearField
                        label="Starting from"
                        years={YEARS}
                        month={month.value}
                        year={year.value}
                        onMonthChange={month.onChange}
                        onYearChange={year.onChange}
                      />
                    )}
                  />
                )}
              />

              <Controller
                control={control}
                name={`rows.${index}.endMonth`}
                render={({ field: month }) => (
                  <Controller
                    control={control}
                    name={`rows.${index}.graduationYear`}
                    render={({ field: year }) => (
                      <MonthYearField
                        label={isCurrent ? "Ending in (present)" : "Ending in"}
                        required={!isCurrent}
                        years={YEARS}
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
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Score type">
                <Controller
                  control={control}
                  name={`rows.${index}.gradeType`}
                  render={({ field: f }) => (
                    <Select
                      value={f.value}
                      onValueChange={(v) => f.onChange(v as GradeType | "")}
                    >
                      <SelectTrigger aria-label="Score type">
                        <SelectValue placeholder="Score type" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.values(GradeType).map((g) => (
                          <SelectItem key={g} value={g}>
                            {GRADE_TYPE_LABELS[g] ?? g}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field label="Score" htmlFor={`edu-grade-${index}`}>
                <Input
                  id={`edu-grade-${index}`}
                  placeholder={
                    gradeType ? GRADE_PLACEHOLDER[gradeType] : "ex: 8.6"
                  }
                  {...register(`rows.${index}.grade`)}
                />
              </Field>
            </div>

            <Field label="Description" htmlFor={`edu-desc-${index}`}>
              <Textarea
                id={`edu-desc-${index}`}
                rows={3}
                maxLength={4000}
                placeholder="Coursework, thesis, societies, or anything else worth knowing."
                {...register(`rows.${index}.description`)}
              />
            </Field>
          </RowCard>
        );
      })}

      <SectionActions
        saving={saving}
        onAdd={() => append({ ...emptyEducationRow })}
        addLabel={fields.length === 0 ? "Add education" : "Add another"}
      />
    </form>
  );
}
