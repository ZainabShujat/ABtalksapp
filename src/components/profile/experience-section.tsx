"use client";

import { Controller, useFieldArray, useForm } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { saveExperienceAction } from "@/app/actions/candidate-profile-actions";
import {
  COMMON_ROLES,
  EMPLOYMENT_TYPES,
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

// Employment reaches back further than most students expect to need, and never
// forward — you cannot have started a job next year.
const YEARS = yearRange(45, 0);

export function ExperienceSection({
  initial,
}: {
  initial: ExperienceFormRow[];
}) {
  const { saving, save } = useSectionSave(saveExperienceAction, "Experience");
  const { control, register, handleSubmit, watch, setValue } =
    useForm<FormValues>({ defaultValues: { rows: initial } });
  const { fields, append, remove } = useFieldArray({ control, name: "rows" });

  return (
    <form onSubmit={handleSubmit((v) => save(v))} className="space-y-4">
      {fields.length === 0 ? (
        <EmptyState>
          No roles yet. Internships, freelance work, and open-source maintenance
          all count.
        </EmptyState>
      ) : null}

      {fields.map((field, index) => {
        const isCurrent = watch(`rows.${index}.isCurrent`);
        return (
          <RowCard
            key={field.id}
            index={index}
            title="Role"
            onRemove={() => remove(index)}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company" required htmlFor={`exp-company-${index}`}>
                <Input
                  id={`exp-company-${index}`}
                  placeholder="ex: Zomato"
                  autoComplete="off"
                  {...register(`rows.${index}.companyName`, { required: true })}
                />
              </Field>

              <Field label="Role" required htmlFor={`exp-title-${index}`}>
                <Controller
                  control={control}
                  name={`rows.${index}.title`}
                  render={({ field: f }) => (
                    <SuggestInput
                      id={`exp-title-${index}`}
                      value={f.value}
                      onChange={f.onChange}
                      options={COMMON_ROLES}
                      placeholder="ex: Software Engineer"
                    />
                  )}
                />
              </Field>

              <Field label="Employment type" htmlFor={`exp-type-${index}`}>
                <Controller
                  control={control}
                  name={`rows.${index}.employmentType`}
                  render={({ field: f }) => (
                    <SuggestInput
                      id={`exp-type-${index}`}
                      value={f.value}
                      onChange={f.onChange}
                      options={EMPLOYMENT_TYPES}
                      placeholder="ex: Internship"
                    />
                  )}
                />
              </Field>

              <Field label="Location" htmlFor={`exp-loc-${index}`}>
                <Input
                  id={`exp-loc-${index}`}
                  placeholder="ex: Bangalore, Remote"
                  {...register(`rows.${index}.locationCity`)}
                />
              </Field>
            </div>

            <div className="flex items-center gap-2">
              <Controller
                control={control}
                name={`rows.${index}.isCurrent`}
                render={({ field: f }) => (
                  <Checkbox
                    id={`exp-current-${index}`}
                    checked={f.value}
                    onCheckedChange={(checked) => {
                      f.onChange(checked === true);
                      if (checked === true) {
                        // An open-ended role has no end date to keep.
                        setValue(`rows.${index}.endMonth`, null);
                        setValue(`rows.${index}.endYear`, null);
                      }
                    }}
                  />
                )}
              />
              <Label htmlFor={`exp-current-${index}`} className="font-normal">
                Currently working here
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
                        required
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
                    name={`rows.${index}.endYear`}
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

            <Field label="Description" htmlFor={`exp-desc-${index}`}>
              <Textarea
                id={`exp-desc-${index}`}
                rows={3}
                maxLength={4000}
                placeholder="What you owned, what you shipped, and the impact it had."
                {...register(`rows.${index}.description`)}
              />
            </Field>
          </RowCard>
        );
      })}

      <SectionActions
        saving={saving}
        onAdd={() => append({ ...emptyExperienceRow })}
        addLabel={fields.length === 0 ? "Add experience" : "Add another"}
      />
    </form>
  );
}
