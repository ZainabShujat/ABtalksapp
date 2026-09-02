"use client";

import { useEffect } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { saveCertificationsAction } from "@/app/actions/candidate-profile-actions";
import { useSectionSave } from "./use-section-save";
import { useProfileWizard } from "./wizard-context";
import {
  PwAddMore,
  PwEntryCard,
  PwField,
  PwInput,
  PwMonthYear,
  PwRow,
} from "./wizard-fields";

export type CertificationFormRow = {
  name: string;
  issuer: string;
  issuedMonth: number | null;
  issuedYear: number | null;
  expiresMonth: number | null;
  expiresYear: number | null;
  credentialUrl: string;
};

type FormValues = { rows: CertificationFormRow[] };

export const emptyCertificationRow: CertificationFormRow = {
  name: "",
  issuer: "",
  issuedMonth: null,
  issuedYear: null,
  expiresMonth: null,
  expiresYear: null,
  credentialUrl: "",
};

export function CertificationsSection({
  initial,
}: {
  initial: CertificationFormRow[];
}) {
  const { formId, onSaved, setDirty } = useProfileWizard();
  const { save } = useSectionSave(saveCertificationsAction, "Certifications");
  const { control, register, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: {
      rows:
        initial.length > 0 ? initial : [{ ...emptyCertificationRow }],
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
      replace([{ ...emptyCertificationRow }]);
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
      <div className="pw-section-intro">
        External certifications only — AWS, Databricks, and the like. Anything
        ABTalks issued you already appears under Evidence &amp; achievements.
      </div>

      <div className="pw-entries">
        {fields.map((field, index) => (
          <PwEntryCard
            key={field.id}
            index={index}
            title="Certification"
            onRemove={() => removeOrClear(index)}
          >
            <PwRow cols={2}>
              <PwField label="Name" required htmlFor={`crt-name-${index}`}>
                <PwInput
                  id={`crt-name-${index}`}
                  placeholder="e.g. UX Design"
                  {...register(`rows.${index}.name`, { required: true })}
                />
              </PwField>
              <PwField label="Issuer" required htmlFor={`crt-issuer-${index}`}>
                <PwInput
                  id={`crt-issuer-${index}`}
                  placeholder="e.g. Google"
                  {...register(`rows.${index}.issuer`, { required: true })}
                />
              </PwField>
            </PwRow>

            <PwRow cols={2}>
              <PwField label="Issued">
                <Controller
                  control={control}
                  name={`rows.${index}.issuedMonth`}
                  render={({ field: month }) => (
                    <Controller
                      control={control}
                      name={`rows.${index}.issuedYear`}
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
              <PwField label="Expires">
                <Controller
                  control={control}
                  name={`rows.${index}.expiresMonth`}
                  render={({ field: month }) => (
                    <Controller
                      control={control}
                      name={`rows.${index}.expiresYear`}
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
            </PwRow>

            <PwRow cols={1}>
              <PwField label="Credential URL" htmlFor={`crt-url-${index}`}>
                <PwInput
                  id={`crt-url-${index}`}
                  type="url"
                  inputMode="url"
                  placeholder="https://www.credly.com/badges/..."
                  {...register(`rows.${index}.credentialUrl`)}
                />
              </PwField>
            </PwRow>
          </PwEntryCard>
        ))}
      </div>
      <PwAddMore onClick={() => append({ ...emptyCertificationRow })} />
    </form>
  );
}
