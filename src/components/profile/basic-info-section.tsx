"use client";

import { useForm } from "react-hook-form";
import { CandidatePersona } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveBasicInfoAction } from "@/app/actions/candidate-profile-actions";
import { PERSONA_LABELS } from "@/lib/candidate-vocab";
import { Field, SectionActions } from "./fields";
import { useSectionSave } from "./use-section-save";

export type BasicInfoValues = {
  fullName: string;
  phone: string;
  headline: string;
  summary: string;
  locationCity: string;
  locationRegion: string;
  countryCode: string;
  primaryPersona: CandidatePersona;
};

export function BasicInfoSection({
  initial,
  phoneVerified,
}: {
  initial: BasicInfoValues;
  phoneVerified: boolean;
}) {
  const { saving, save } = useSectionSave(saveBasicInfoAction, "Basic information");
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<BasicInfoValues>({ defaultValues: initial });

  const summary = watch("summary") ?? "";
  const persona = watch("primaryPersona");

  return (
    <form onSubmit={handleSubmit((values) => save(values))} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Full name"
          required
          htmlFor="bi-fullName"
          error={errors.fullName?.message}
        >
          <Input
            id="bi-fullName"
            autoComplete="name"
            {...register("fullName", { required: "Full name is required" })}
          />
        </Field>

        <Field
          label="Phone"
          htmlFor="bi-phone"
          hint={
            phoneVerified
              ? "Verified"
              : "Add your number so recruiters can reach you"
          }
        >
          <Input
            id="bi-phone"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+91…"
            {...register("phone")}
          />
        </Field>
      </div>

      <Field
        label="Headline"
        htmlFor="bi-headline"
        hint="One line. What you do, or what you are working toward."
      >
        <Input
          id="bi-headline"
          maxLength={160}
          placeholder="ex: Final-year CSE student building ML systems"
          {...register("headline")}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="City" htmlFor="bi-city">
          <Input
            id="bi-city"
            placeholder="ex: Bangalore"
            autoComplete="address-level2"
            {...register("locationCity")}
          />
        </Field>
        <Field label="State / region" htmlFor="bi-region">
          <Input
            id="bi-region"
            placeholder="ex: Karnataka"
            autoComplete="address-level1"
            {...register("locationRegion")}
          />
        </Field>
        <Field label="Country code" htmlFor="bi-country" hint="2 letters, e.g. IN">
          <Input
            id="bi-country"
            maxLength={2}
            placeholder="IN"
            className="uppercase"
            {...register("countryCode")}
          />
        </Field>
      </div>

      <Field
        label="I am currently"
        hint="Used for display. It does not change which challenge track you are on."
      >
        <Select
          value={persona}
          onValueChange={(v) =>
            setValue("primaryPersona", v as CandidatePersona, {
              shouldDirty: true,
            })
          }
        >
          <SelectTrigger aria-label="Current persona">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {Object.values(CandidatePersona).map((p) => (
              <SelectItem key={p} value={p}>
                {PERSONA_LABELS[p] ?? p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label="About"
        htmlFor="bi-summary"
        hint={`${summary.length}/2000`}
      >
        <Textarea
          id="bi-summary"
          rows={5}
          maxLength={2000}
          placeholder="What you have built, what you are good at, and what you want to do next."
          {...register("summary")}
        />
      </Field>

      <SectionActions saving={saving} />
    </form>
  );
}
