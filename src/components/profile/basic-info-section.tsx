"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { CandidatePersona } from "@prisma/client";
import { saveBasicInfoAction } from "@/app/actions/candidate-profile-actions";
import { PhoneVerifyField } from "@/components/shared/phone-verify-field";
import { PERSONA_LABELS } from "@/lib/candidate-vocab";
import {
  INDIA_DIALING_CODE,
  isIndianPhone,
} from "@/lib/validations/phone";
import { useSectionSave } from "./use-section-save";
import { useProfileWizard } from "./wizard-context";
import {
  PwField,
  PwInput,
  PwRow,
  PwSelect,
  PwTextarea,
} from "./wizard-fields";

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

function splitPhone(e164: string): {
  countryCode: string;
  national: string;
} {
  const trimmed = e164.trim();
  if (trimmed.startsWith(INDIA_DIALING_CODE) && trimmed.length >= 13) {
    return {
      countryCode: INDIA_DIALING_CODE,
      national: trimmed.slice(INDIA_DIALING_CODE.length),
    };
  }
  const match = trimmed.match(/^(\+\d{1,3})(\d+)$/);
  if (match) {
    return { countryCode: match[1]!, national: match[2]! };
  }
  return { countryCode: INDIA_DIALING_CODE, national: trimmed.replace(/^\+/, "") };
}

export function BasicInfoSection({
  initial,
  phoneVerified,
  otpRequired,
}: {
  initial: BasicInfoValues;
  phoneVerified: boolean;
  otpRequired: boolean;
}) {
  const router = useRouter();
  const { formId, onSaved, setDirty } = useProfileWizard();
  const { save } = useSectionSave(saveBasicInfoAction, "Basic information");
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<BasicInfoValues>({ defaultValues: initial });

  const summary = watch("summary") ?? "";
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const defaults = splitPhone(initial.phone);

  useEffect(() => {
    setDirty(isDirty);
  }, [isDirty, setDirty]);

  return (
    <form
      id={formId}
      onSubmit={handleSubmit(async (v) => {
        setPhoneError(null);
        if (
          otpRequired &&
          !phoneVerified &&
          (v.phone.trim() === "" || isIndianPhone(v.phone))
        ) {
          setPhoneError("Please verify your phone number to continue.");
          return;
        }
        if (await save(v)) onSaved();
      })}
    >
      <PwRow cols={2}>
        <PwField
          label="Full name"
          required
          htmlFor="bi-fullName"
          error={errors.fullName?.message}
        >
          <PwInput
            id="bi-fullName"
            autoComplete="name"
            placeholder="Your full name"
            aria-invalid={Boolean(errors.fullName)}
            className={errors.fullName ? "pw-invalid" : undefined}
            {...register("fullName", { required: "Full name is required" })}
          />
        </PwField>
        <PwField
          label="Phone"
          required={otpRequired}
          htmlFor="bi-phone"
          verified={phoneVerified}
          error={phoneError}
        >
          {phoneVerified ? (
            <PwInput
              id="bi-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              readOnly
              {...register("phone")}
            />
          ) : (
            <div className="pw-phone-verify">
              <PhoneVerifyField
                defaultCountryCode={defaults.countryCode}
                defaultPhoneNumber={defaults.national}
                verificationRequired={otpRequired}
                onChange={(v) => {
                  setValue("phone", v.e164, { shouldDirty: true });
                  setPhoneError(null);
                }}
                onVerified={(e164) => {
                  setValue("phone", e164, { shouldDirty: true });
                  setPhoneError(null);
                  router.refresh();
                }}
              />
            </div>
          )}
        </PwField>
      </PwRow>

      <PwRow cols={3}>
        <PwField label="I am a" htmlFor="bi-persona">
          <PwSelect id="bi-persona" {...register("primaryPersona")}>
            {Object.values(CandidatePersona).map((p) => (
              <option key={p} value={p}>
                {PERSONA_LABELS[p] ?? p}
              </option>
            ))}
          </PwSelect>
        </PwField>
        <PwField label="City" htmlFor="bi-city">
          <PwInput
            id="bi-city"
            placeholder="e.g. Mumbai"
            autoComplete="address-level2"
            {...register("locationCity")}
          />
        </PwField>
        <PwField label="State / region" htmlFor="bi-region">
          <PwInput
            id="bi-region"
            placeholder="e.g. Maharashtra"
            autoComplete="address-level1"
            {...register("locationRegion")}
          />
        </PwField>
      </PwRow>

      <PwRow cols={2}>
        <PwField
          label="Country code"
          htmlFor="bi-country"
          
        >
          <PwInput
            id="bi-country"
            maxLength={2}
            placeholder="IN"
            className="uppercase"
            {...register("countryCode")}
          />
        </PwField>
        <PwField
          label="Headline"
          htmlFor="bi-headline"
          helper="One line. What you do, or what you are working toward."
        >
          <PwInput
            id="bi-headline"
            maxLength={160}
            placeholder="ex: Final-year CSE student building ML systems"
            {...register("headline")}
          />
        </PwField>
      </PwRow>

      <PwRow cols={1} grow>
        <PwField
          label="About"
          htmlFor="bi-summary"
          counter={`${summary.length}/2000`}
          area
        >
          <PwTextarea
            id="bi-summary"
            maxLength={2000}
            placeholder="Tell recruiters who you are."
            {...register("summary")}
          />
        </PwField>
      </PwRow>
    </form>
  );
}
