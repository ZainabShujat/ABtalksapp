"use client";

import { Controller, useFieldArray, useForm } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { saveCertificationsAction } from "@/app/actions/candidate-profile-actions";
import { yearRange } from "@/lib/candidate-vocab";
import {
  EmptyState,
  Field,
  MonthYearField,
  RowCard,
  SectionActions,
} from "./fields";
import { useSectionSave } from "./use-section-save";

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

// Certifications expire, so the range runs forward as well as back.
const YEARS = yearRange(30, 15);

export function CertificationsSection({
  initial,
}: {
  initial: CertificationFormRow[];
}) {
  const { saving, save } = useSectionSave(
    saveCertificationsAction,
    "Certifications",
  );
  const { control, register, handleSubmit } = useForm<FormValues>({
    defaultValues: { rows: initial },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "rows" });

  return (
    <form onSubmit={handleSubmit((v) => save(v))} className="space-y-4">
      <p className="text-xs text-muted-foreground">
        External certifications only — AWS, Databricks, and the like. Anything
        ABTalks issued you already appears under Evidence &amp; achievements.
      </p>

      {fields.length === 0 ? (
        <EmptyState>No external certifications added.</EmptyState>
      ) : null}

      {fields.map((field, index) => (
        <RowCard
          key={field.id}
          index={index}
          title="Certification"
          onRemove={() => remove(index)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required htmlFor={`crt-name-${index}`}>
              <Input
                id={`crt-name-${index}`}
                placeholder="ex: AWS Certified Solutions Architect"
                {...register(`rows.${index}.name`, { required: true })}
              />
            </Field>
            <Field label="Issuer" required htmlFor={`crt-issuer-${index}`}>
              <Input
                id={`crt-issuer-${index}`}
                placeholder="ex: Amazon Web Services"
                {...register(`rows.${index}.issuer`, { required: true })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name={`rows.${index}.issuedMonth`}
              render={({ field: month }) => (
                <Controller
                  control={control}
                  name={`rows.${index}.issuedYear`}
                  render={({ field: year }) => (
                    <MonthYearField
                      label="Issued"
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
              name={`rows.${index}.expiresMonth`}
              render={({ field: month }) => (
                <Controller
                  control={control}
                  name={`rows.${index}.expiresYear`}
                  render={({ field: year }) => (
                    <MonthYearField
                      label="Expires"
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
          </div>

          <Field label="Credential URL" htmlFor={`crt-url-${index}`}>
            <Input
              id={`crt-url-${index}`}
              type="url"
              inputMode="url"
              placeholder="https://…"
              {...register(`rows.${index}.credentialUrl`)}
            />
          </Field>
        </RowCard>
      ))}

      <SectionActions
        saving={saving}
        onAdd={() => append({ ...emptyCertificationRow })}
        addLabel={fields.length === 0 ? "Add certification" : "Add another"}
      />
    </form>
  );
}
