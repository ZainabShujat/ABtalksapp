"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { OpportunityType } from "@prisma/client";
import { savePreferencesAction } from "@/app/actions/candidate-profile-actions";
import { OPPORTUNITY_TYPE_LABELS, WORK_MODES } from "@/lib/candidate-vocab";
import { useSectionSave } from "./use-section-save";
import { useProfileWizard } from "./wizard-context";
import {
  PwCheckGroup,
  PwCheckbox,
  PwField,
  PwInput,
  PwMonthYear,
  PwRow,
  PwSelect,
  PwTags,
  PwTogglePanel,
} from "./wizard-fields";

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

const OPPORTUNITY_OPTIONS = Object.values(OpportunityType).map((t) => ({
  value: t,
  label: OPPORTUNITY_TYPE_LABELS[t] ?? t,
}));

export function PreferencesSection({
  initial,
}: {
  initial: PreferencesFormValues;
}) {
  const { formId, onSaved, setDirty } = useProfileWizard();
  const { save } = useSectionSave(savePreferencesAction, "Career preferences");
  const { control, register, handleSubmit, formState } =
    useForm<PreferencesFormValues>({ defaultValues: initial });

  useEffect(() => {
    setDirty(formState.isDirty);
  }, [formState.isDirty, setDirty]);

  return (
    <form
      id={formId}
      onSubmit={handleSubmit(async (v) => {
        if (await save(v)) onSaved();
      })}
    >
      <PwRow cols={1}>
        <Controller
          control={control}
          name="openToWork"
          render={({ field }) => (
            <PwTogglePanel
              title="Open to work"
              text="Says whether you are looking for a job right now."
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </PwRow>

      <PwRow cols={1}>
        <PwField label="Preferred roles">
          <Controller
            control={control}
            name="preferredRoles"
            render={({ field }) => (
              <PwTags
                values={field.value}
                onChange={field.onChange}
                placeholder="ex: Backend Engineer"
              />
            )}
          />
        </PwField>
      </PwRow>

      <PwRow cols={1}>
        <PwField label="Preferred locations">
          <Controller
            control={control}
            name="preferredLocations"
            render={({ field }) => (
              <PwTags
                values={field.value}
                onChange={field.onChange}
                placeholder="ex: Bangalore"
              />
            )}
          />
        </PwField>
      </PwRow>

      <PwRow cols={1}>
        <PwField label="Opportunity type">
          <Controller
            control={control}
            name="opportunityTypes"
            render={({ field }) => (
              <PwCheckGroup
                options={OPPORTUNITY_OPTIONS}
                value={field.value}
                onChange={(next) => field.onChange(next as OpportunityType[])}
              />
            )}
          />
        </PwField>
      </PwRow>

      <PwRow cols={2}>
        <PwField label="Work mode" htmlFor="pref-mode">
          <Controller
            control={control}
            name="remotePreference"
            render={({ field }) => (
              <PwSelect
                id="pref-mode"
                value={field.value}
                onChange={field.onChange}
              >
                <option value="">Select</option>
                {WORK_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </PwSelect>
            )}
          />
        </PwField>
        <PwField
          label="Notice period"
          htmlFor="pref-notice"
          helper="In days. Leave blank if you are immediately available."
        >
          <PwInput
            id="pref-notice"
            type="number"
            min={0}
            max={365}
            placeholder="e.g. 10"
            {...register("noticePeriodDays")}
          />
        </PwField>
      </PwRow>

      <PwRow cols={2}>
        <PwField label="Available from">
          <Controller
            control={control}
            name="availableFromMonth"
            render={({ field: month }) => (
              <Controller
                control={control}
                name="availableFromYear"
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
        <PwField inlineCheck>
          <Controller
            control={control}
            name="willingToRelocate"
            render={({ field }) => (
              <PwCheckbox
                id="pref-relocate"
                checked={field.value}
                onChange={field.onChange}
              >
                Willing to relocate
              </PwCheckbox>
            )}
          />
        </PwField>
      </PwRow>
    </form>
  );
}
