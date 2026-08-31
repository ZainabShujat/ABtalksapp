"use client";

import { Controller, useForm } from "react-hook-form";
import { OpportunityType } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { savePreferencesAction } from "@/app/actions/candidate-profile-actions";
import {
  COMMON_ROLES,
  OPPORTUNITY_TYPE_LABELS,
  WORK_MODES,
  yearRange,
} from "@/lib/candidate-vocab";
import { ChipInput, Field, MonthYearField, SectionActions } from "./fields";
import { useSectionSave } from "./use-section-save";

export type PreferencesFormValues = {
  openToWork: boolean;
  preferredRoles: string[];
  preferredLocations: string[];
  opportunityTypes: OpportunityType[];
  remotePreference: string;
  willingToRelocate: boolean;
  noticePeriodDays: string;
  availableFromMonth: number | null;
  availableFromYear: number | null;
};

const YEARS = yearRange(1, 5);

export function PreferencesSection({
  initial,
}: {
  initial: PreferencesFormValues;
}) {
  const { saving, save } = useSectionSave(
    savePreferencesAction,
    "Career preferences",
  );
  const { control, register, handleSubmit } = useForm<PreferencesFormValues>({
    defaultValues: initial,
  });

  return (
    <form onSubmit={handleSubmit((v) => save(v))} className="space-y-5">
      <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/20 p-4">
        <div className="min-w-0">
          <p className="font-medium">Open to work</p>
          <p className="text-xs text-muted-foreground">
            Says whether you are looking right now. Separate from whether
            recruiters can find you at all — this switch does not change that.
          </p>
        </div>
        <Controller
          control={control}
          name="openToWork"
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={(c) => field.onChange(c === true)}
              aria-label="Open to work"
            />
          )}
        />
      </div>

      <Field label="Preferred roles">
        <Controller
          control={control}
          name="preferredRoles"
          render={({ field }) => (
            <ChipInput
              values={field.value}
              onChange={field.onChange}
              placeholder="ex: Backend Engineer"
              max={10}
              suggestions={COMMON_ROLES}
            />
          )}
        />
      </Field>

      <Field label="Preferred locations">
        <Controller
          control={control}
          name="preferredLocations"
          render={({ field }) => (
            <ChipInput
              values={field.value}
              onChange={field.onChange}
              placeholder="ex: Bangalore"
              max={10}
            />
          )}
        />
      </Field>

      <Field label="Opportunity type">
        <Controller
          control={control}
          name="opportunityTypes"
          render={({ field }) => (
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {Object.values(OpportunityType).map((t) => {
                const checked = field.value.includes(t);
                return (
                  <div key={t} className="flex items-center gap-2">
                    <Checkbox
                      id={`opp-${t}`}
                      checked={checked}
                      onCheckedChange={(c) =>
                        field.onChange(
                          c === true
                            ? [...field.value, t]
                            : field.value.filter((v) => v !== t),
                        )
                      }
                    />
                    <Label htmlFor={`opp-${t}`} className="font-normal">
                      {OPPORTUNITY_TYPE_LABELS[t] ?? t}
                    </Label>
                  </div>
                );
              })}
            </div>
          )}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Work mode">
          <Controller
            control={control}
            name="remotePreference"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger aria-label="Work mode">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {WORK_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <Field
          label="Notice period"
          htmlFor="pref-notice"
          hint="In days. Leave blank if you are immediately available."
        >
          <Input
            id="pref-notice"
            type="number"
            min={0}
            max={365}
            placeholder="ex: 30"
            {...register("noticePeriodDays")}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="availableFromMonth"
          render={({ field: month }) => (
            <Controller
              control={control}
              name="availableFromYear"
              render={({ field: year }) => (
                <MonthYearField
                  label="Available from"
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

        <div className="flex items-end pb-1">
          <div className="flex items-center gap-2">
            <Controller
              control={control}
              name="willingToRelocate"
              render={({ field }) => (
                <Checkbox
                  id="pref-relocate"
                  checked={field.value}
                  onCheckedChange={(c) => field.onChange(c === true)}
                />
              )}
            />
            <Label htmlFor="pref-relocate" className="font-normal">
              Willing to relocate
            </Label>
          </div>
        </div>
      </div>

      <SectionActions saving={saving} saveLabel="Save preferences" />
    </form>
  );
}
