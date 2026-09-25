"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { type Resolver, Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { completeRegistrationAction } from "@/app/actions/registration-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CollegeCombobox } from "@/components/shared/college-combobox";
import { PhoneVerifyField } from "@/components/shared/phone-verify-field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { HUB_BUTTON_CLASS } from "@/components/dashboard-hub/nav-items";
import {
  LegalConsentFields,
  legalConsentAccepted,
  type LegalConsentValues,
} from "@/components/legal/legal-consent-fields";
import { registerPayloadSchema } from "@/lib/validations/register";
import { ResumeUploadField } from "./resume-upload-field";

/**
 * Registration, slimmed to what only the candidate can tell us.
 *
 * Graduation year, LinkedIn, GitHub and the skills chips are gone. Every one of
 * them is something the résumé parser extracts and merges into the profile
 * additively (`features/resume/merge/plan.ts`), so asking for them here made the
 * form longer and the answer worse. What is left is identity, where they study
 * or work, where they are, one line about themselves, and the résumé itself.
 */

/** RHF model includes fields from both branches; Zod still validates via `registerPayloadSchema`. */
type RegistrationFormValues = {
  userType: "STUDENT" | "PROFESSIONAL";
  fullName: string;
  college: string;
  collegeId: string;
  organization: string;
  role: string;
  yearsExperience: number | undefined;
  headline: string;
  locationCity: string;
  locationRegion: string;
  countryCode: string;
  phoneCountryCode: string;
  phoneNumber: string;
  referralCode: string;
  acceptLegal: boolean;
  newsletterOptIn: boolean;
};

type Props = {
  initialName: string;
  initialRef: string;
  /** Where a successful registration lands. Already validated same-origin. */
  nextPath: string;
  /** True when a READY `CandidateResume` already exists for this user. */
  resumeReady: boolean;
  resumeFileName: string | null;
  /** When false (local `next dev`), OTP is not required to submit. */
  otpVerificationRequired: boolean;
};

export function RegistrationForm({
  initialName,
  initialRef,
  nextPath,
  resumeReady,
  resumeFileName,
  otpVerificationRequired,
}: Props) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resumeUploaded, setResumeUploaded] = useState(resumeReady);
  const [legalConsent, setLegalConsent] = useState<LegalConsentValues>({
    acceptLegal: false,
    newsletterOptIn: true,
  });
  const [phoneVerified, setPhoneVerified] = useState(!otpVerificationRequired);

  const form = useForm<RegistrationFormValues>({
    resolver: zodResolver(registerPayloadSchema) as unknown as Resolver<RegistrationFormValues>,
    shouldUnregister: true,
    defaultValues: {
      userType: "STUDENT",
      fullName: initialName,
      college: "",
      collegeId: "",
      organization: "",
      role: "",
      yearsExperience: undefined,
      headline: "",
      locationCity: "",
      locationRegion: "",
      countryCode: "IN",
      phoneCountryCode: "+91",
      phoneNumber: "",
      referralCode: initialRef,
      acceptLegal: false,
      newsletterOptIn: true,
    },
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    clearErrors,
    formState: { errors },
  } = form;

  const userType = watch("userType");

  const handlePhoneChange = useCallback(
    (v: { countryCode: string; phoneNumber: string; e164: string }) => {
      setValue("phoneCountryCode", v.countryCode);
      setValue("phoneNumber", v.phoneNumber);
    },
    [setValue],
  );

  function handleUserTypeChange(next: "STUDENT" | "PROFESSIONAL") {
    setValue("userType", next, { shouldValidate: false });
    if (next === "PROFESSIONAL") {
      setValue("organization", "");
      setValue("role", "");
      setValue("yearsExperience", undefined);
      setValue("collegeId", "");
      clearErrors(["college"]);
    } else {
      setValue("college", "");
      setValue("collegeId", "");
      clearErrors(["organization", "role", "yearsExperience"]);
    }
  }

  async function onSubmit(values: RegistrationFormValues) {
    if (!legalConsentAccepted(legalConsent)) {
      toast.error("Please accept the Terms of Service and Privacy Policy.");
      return;
    }
    if (
      otpVerificationRequired &&
      values.phoneCountryCode === "+91" &&
      !phoneVerified
    ) {
      toast.error("Please verify your phone number first.");
      return;
    }
    setIsSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("fullName", values.fullName);
      fd.append("userType", values.userType);
      fd.append("headline", values.headline);
      fd.append("locationCity", values.locationCity);
      fd.append("locationRegion", values.locationRegion);
      fd.append("countryCode", values.countryCode);
      fd.append("phoneCountryCode", values.phoneCountryCode);
      fd.append("phoneNumber", values.phoneNumber ?? "");
      fd.append("referralCode", values.referralCode ?? "");
      fd.append("acceptLegal", String(legalConsent.acceptLegal));
      fd.append("newsletterOptIn", String(legalConsent.newsletterOptIn));

      if (values.userType === "STUDENT") {
        fd.append("college", values.college);
        fd.append("collegeId", values.collegeId);
      } else {
        fd.append("organization", values.organization);
        fd.append("role", values.role);
        fd.append(
          "yearsExperience",
          values.yearsExperience != null ? String(values.yearsExperience) : "",
        );
      }

      const res = await completeRegistrationAction(fd);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Welcome to ABTalks!");
      // Wherever they were headed before Google sent them here — the hackathon
      // dashboard, the hub, a track — carried through as `next`.
      router.push(nextPath);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      <div className="space-y-3">
        <Label className="text-base font-semibold">I am a…</Label>
        <Controller
          name="userType"
          control={control}
          render={({ field }) => (
            <RadioGroup
              value={field.value}
              onValueChange={(v) => {
                const next = v === "PROFESSIONAL" ? "PROFESSIONAL" : "STUDENT";
                field.onChange(next);
                handleUserTypeChange(next);
              }}
              className="grid max-w-full grid-cols-1 gap-3 sm:grid-cols-2"
              required
            >
              <Label
                htmlFor="user-type-student"
                className="min-w-0 cursor-pointer"
              >
                <Card
                  className={cn(
                    "h-full p-4 transition-colors",
                    field.value === "STUDENT" &&
                      "border-primary bg-primary/5 ring-2 ring-primary/20",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <RadioGroupItem
                      value="STUDENT"
                      id="user-type-student"
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <div className="font-display font-semibold">College Student</div>
                    </div>
                  </div>
                </Card>
              </Label>
              <Label
                htmlFor="user-type-professional"
                className="min-w-0 cursor-pointer"
              >
                <Card
                  className={cn(
                    "h-full p-4 transition-colors",
                    field.value === "PROFESSIONAL" &&
                      "border-primary bg-primary/5 ring-2 ring-primary/20",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <RadioGroupItem
                      value="PROFESSIONAL"
                      id="user-type-professional"
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <div className="font-display font-semibold">
                        Working Professional
                      </div>
                    </div>
                  </div>
                </Card>
              </Label>
            </RadioGroup>
          )}
        />
        {errors.userType ? (
          <p className="text-sm text-destructive">{errors.userType.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          autoComplete="name"
          {...register("fullName")}
          aria-invalid={!!errors.fullName}
        />
        {errors.fullName ? (
          <p className="text-sm text-destructive">{errors.fullName.message}</p>
        ) : null}
      </div>

      <AnimatePresence mode="wait">
        {userType === "STUDENT" ? (
          <motion.div
            key="student-fields"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            <div className="space-y-2">
              <Label htmlFor="college">College</Label>
              <Controller
                name="college"
                control={control}
                render={({ field }) => (
                  <CollegeCombobox
                    id="college"
                    value={field.value}
                    onChange={(name, collegeId) => {
                      field.onChange(name);
                      setValue("collegeId", collegeId ?? "");
                    }}
                    placeholder="e.g. IIT Delhi"
                    aria-invalid={!!errors.college}
                  />
                )}
              />
              {errors.college ? (
                <p className="text-sm text-destructive">
                  {errors.college.message}
                </p>
              ) : null}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="professional-fields"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            <div className="space-y-2">
              <Label htmlFor="organization">Company</Label>
              <Input
                id="organization"
                placeholder="Company or institution name"
                maxLength={200}
                {...register("organization")}
                aria-invalid={!!errors.organization}
              />
              {errors.organization ? (
                <p className="text-sm text-destructive">
                  {errors.organization.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Input
                id="role"
                placeholder="Your current role"
                maxLength={200}
                {...register("role")}
                aria-invalid={!!errors.role}
              />
              {errors.role ? (
                <p className="text-sm text-destructive">{errors.role.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="yearsExperience">Years of experience</Label>
              <Input
                id="yearsExperience"
                type="number"
                inputMode="numeric"
                min={0}
                max={60}
                placeholder="Enter your years of experience"
                className="max-w-[12rem]"
                aria-invalid={!!errors.yearsExperience}
                {...register("yearsExperience", {
                  setValueAs: (v) => {
                    if (v === "" || v === null || v === undefined) {
                      return undefined;
                    }
                    const n =
                      typeof v === "number"
                        ? v
                        : Number.parseInt(String(v), 10);
                    return Number.isFinite(n)
                      ? Math.min(60, Math.max(0, n))
                      : undefined;
                  },
                })}
              />
              {errors.yearsExperience ? (
                <p className="text-sm text-destructive">
                  {errors.yearsExperience.message}
                </p>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ResumeUploadField
        initialFileName={resumeFileName}
        uploaded={resumeUploaded}
        onUploadedChange={setResumeUploaded}
        disabled={isSubmitting}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="locationCity">City</Label>
          <Input
            id="locationCity"
            placeholder="Enter your city"
            autoComplete="address-level2"
            maxLength={120}
            {...register("locationCity")}
            aria-invalid={!!errors.locationCity}
          />
          {errors.locationCity ? (
            <p className="text-sm text-destructive">
              {errors.locationCity.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="locationRegion">State / Region</Label>
          <Input
            id="locationRegion"
            placeholder="Enter your state or region"
            autoComplete="address-level1"
            maxLength={120}
            {...register("locationRegion")}
            aria-invalid={!!errors.locationRegion}
          />
          {errors.locationRegion ? (
            <p className="text-sm text-destructive">
              {errors.locationRegion.message}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="countryCode">Country Code</Label>
        <Input
          id="countryCode"
          maxLength={2}
          placeholder="Enter your country code(e.g. IN)"
          autoComplete="country"
          className="max-w-[8rem] uppercase"
          {...register("countryCode")}
          aria-invalid={!!errors.countryCode}
        />
        <p className="text-xs text-muted-foreground">
          Two-letter country code: IN India, US United States.
        </p>
        {errors.countryCode ? (
          <p className="text-sm text-destructive">
            {errors.countryCode.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="headline">Profile headline</Label>
        <Input
          id="headline"
          maxLength={160}
          placeholder="Describe yourself in one line"
          {...register("headline")}
          aria-invalid={!!errors.headline}
        />
        <p className="text-xs text-muted-foreground">
          Define yourself in one line. What you do, or what you are working toward.
        </p>
        {errors.headline ? (
          <p className="text-sm text-destructive">{errors.headline.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <input type="hidden" {...register("phoneCountryCode")} />
        <input type="hidden" {...register("phoneNumber")} />
        <PhoneVerifyField
          defaultCountryCode="+91"
          onChange={handlePhoneChange}
          onVerifiedChange={setPhoneVerified}
          disabled={isSubmitting}
          verificationRequired={otpVerificationRequired}
        />
        {errors.phoneNumber ? (
          <p className="text-sm text-destructive">
            {errors.phoneNumber.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="referralCode">Referral code (optional)</Label>
        <Controller
          name="referralCode"
          control={control}
          render={({ field }) => (
            <Input
              id="referralCode"
              maxLength={6}
              placeholder="Enter your referral code"
              className="font-mono uppercase"
              value={field.value}
              onChange={(e) => {
                const v = e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 6);
                field.onChange(v);
              }}
              onBlur={field.onBlur}
              ref={field.ref}
              aria-invalid={!!errors.referralCode}
            />
          )}
        />
        {errors.referralCode ? (
          <p className="text-sm text-destructive">
            {errors.referralCode.message}
          </p>
        ) : null}
      </div>

      <LegalConsentFields
        values={legalConsent}
        onChange={(next) => {
          setLegalConsent(next);
          setValue("acceptLegal", next.acceptLegal, { shouldValidate: true });
          setValue("newsletterOptIn", next.newsletterOptIn, {
            shouldValidate: true,
          });
        }}
      />

      <Button
        type="submit"
        variant="outline"
        className={cn(
          HUB_BUTTON_CLASS,
          "inline-flex h-11 w-full items-center justify-center gap-2 sm:w-auto",
        )}
        disabled={isSubmitting || !legalConsentAccepted(legalConsent)}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Submitting…
          </>
        ) : (
          "Complete Registration"
        )}
      </Button>
    </form>
  );
}
