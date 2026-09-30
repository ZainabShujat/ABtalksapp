"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { type Resolver, Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { completeRegistrationAction } from "@/app/actions/registration-actions";
import { setPasswordAction } from "@/app/actions/email-auth-actions";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PhoneVerifyField } from "@/components/shared/phone-verify-field";
import { cn } from "@/lib/utils";
import { HUB_BUTTON_CLASS } from "@/components/dashboard-hub/nav-items";
import {
  LegalConsentFields,
  legalConsentAccepted,
  type LegalConsentValues,
} from "@/components/legal/legal-consent-fields";
import { registerPayloadSchema } from "@/lib/validations/register";
import { PASSWORD_MIN_LENGTH } from "@/lib/validations/email-auth";
import { ResumeUploadField } from "./resume-upload-field";

/**
 * Registration, slimmed to what only the candidate can tell us: their name,
 * whether they are a student or a working professional, and a phone number.
 *
 * College, company, role, years of experience, headline, city, state and
 * country are gone. The résumé parser extracts all of them and merges them into
 * the profile additively (`features/resume/merge/plan.ts`). Asking for college
 * or company here as well created a second education / experience row next to
 * the one the résumé produced, so the profile showed duplicates.
 */

type RegistrationFormValues = {
  /** "" until the candidate picks one: there is deliberately no default. */
  userType: "" | "STUDENT" | "PROFESSIONAL";
  fullName: string;
  phoneCountryCode: string;
  phoneNumber: string;
  acceptLegal: boolean;
  newsletterOptIn: boolean;
};

const USER_TYPE_OPTIONS = [
  { value: "STUDENT", label: "Student" },
  { value: "PROFESSIONAL", label: "Working Professional" },
] as const;

/** One height and radius for every control, so the fields line up. */
const CONTROL_CLASS = "h-10 data-[size=default]:h-10 rounded-xl";

function RequiredMark() {
  return (
    <span className="-ml-1.5 text-destructive" aria-hidden>
      *
    </span>
  );
}

type Props = {
  initialName: string;
  /** Referral code from `?ref=` or the ref cookie. Sent silently; no visible field. */
  initialRef: string;
  /** Where a successful registration lands. Already validated same-origin. */
  nextPath: string;
  /** True when a READY `CandidateResume` already exists for this user. */
  resumeReady: boolean;
  resumeFileName: string | null;
  /** When false (local `next dev`), OTP is not required to submit. */
  otpVerificationRequired: boolean;
  /** Plan 154: show the optional password field (see register/page.tsx). */
  offerPassword: boolean;
};

export function RegistrationForm({
  initialName,
  initialRef,
  nextPath,
  resumeReady,
  resumeFileName,
  otpVerificationRequired,
  offerPassword,
}: Props) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Plan 154. Outside the RHF model on purpose: it is not part of the
  // registration payload and is saved by its own action afterwards.
  const [password, setPassword] = useState("");
  const [resumeUploaded, setResumeUploaded] = useState(resumeReady);
  const [legalConsent, setLegalConsent] = useState<LegalConsentValues>({
    acceptLegal: false,
    newsletterOptIn: true,
  });
  const [phoneVerified, setPhoneVerified] = useState(!otpVerificationRequired);

  const form = useForm<RegistrationFormValues>({
    resolver: zodResolver(registerPayloadSchema) as unknown as Resolver<RegistrationFormValues>,
    defaultValues: {
      userType: "",
      fullName: initialName,
      phoneCountryCode: "+91",
      phoneNumber: "",
      acceptLegal: false,
      newsletterOptIn: true,
    },
  });

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = form;

  const handlePhoneChange = useCallback(
    (v: { countryCode: string; phoneNumber: string; e164: string }) => {
      setValue("phoneCountryCode", v.countryCode);
      setValue("phoneNumber", v.phoneNumber);
    },
    [setValue],
  );

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
    if (offerPassword && password && password.length < PASSWORD_MIN_LENGTH) {
      toast.error(
        `Use at least ${PASSWORD_MIN_LENGTH} characters for your password, or leave it blank.`,
      );
      return;
    }
    setIsSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("fullName", values.fullName);
      fd.append("userType", values.userType);
      fd.append("phoneCountryCode", values.phoneCountryCode);
      fd.append("phoneNumber", values.phoneNumber ?? "");
      fd.append("referralCode", initialRef);
      fd.append("acceptLegal", String(legalConsent.acceptLegal));
      fd.append("newsletterOptIn", String(legalConsent.newsletterOptIn));

      const res = await completeRegistrationAction(fd);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      // The profile exists at this point, so a password that fails to save
      // must not undo or block it — say so and carry on.
      if (offerPassword && password) {
        const saved = await setPasswordAction({ newPassword: password });
        if (!saved.ok) {
          toast.warning(
            `You're registered, but your password wasn't saved: ${saved.message} You can set one later in Settings.`,
          );
        }
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {/* <p className="text-xs text-muted-foreground">
        Fields marked <span className="text-destructive">*</span> are required.
      </p> */}

      <div className="grid gap-6 sm:grid-cols-2 sm:gap-4">
        <div className="space-y-2">
          <Label htmlFor="fullName">
            Full Name
            <RequiredMark />
          </Label>
          <Input
            id="fullName"
            autoComplete="name"
            placeholder="Enter Full Name"
            maxLength={200}
            className={CONTROL_CLASS}
            aria-required
            aria-invalid={!!errors.fullName}
            {...register("fullName")}
          />
          {errors.fullName ? (
            <p className="text-sm text-destructive">{errors.fullName.message}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="userType">
            I am a
            <RequiredMark />
          </Label>
          <Controller
            name="userType"
            control={control}
            render={({ field }) => (
              <Select
                items={USER_TYPE_OPTIONS}
                value={field.value === "" ? null : field.value}
                onValueChange={(v) => {
                  field.onChange(v ?? "");
                  field.onBlur();
                }}
                disabled={isSubmitting}
              >
                <SelectTrigger
                  id="userType"
                  ref={field.ref}
                  className={cn("w-full", CONTROL_CLASS)}
                  aria-required
                  aria-invalid={!!errors.userType}
                >
                  <SelectValue placeholder="Select Student or Professional" />
                </SelectTrigger>
                <SelectContent>
                  {USER_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.userType ? (
            <p className="text-sm text-destructive">{errors.userType.message}</p>
          ) : null}
        </div>
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
          required
          placeholder="Enter Phone Number"
          controlClassName={CONTROL_CLASS}
        />
        {errors.phoneNumber ? (
          <p className="text-sm text-destructive">
            {errors.phoneNumber.message}
          </p>
        ) : null}
      </div>

      <ResumeUploadField
        initialFileName={resumeFileName}
        uploaded={resumeUploaded}
        onUploadedChange={setResumeUploaded}
        disabled={isSubmitting}
      />

      {offerPassword ? (
        <div className="space-y-2">
          <Label htmlFor="registration-password">Password (optional)</Label>
          <PasswordInput
            id="registration-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isSubmitting}
            aria-describedby="registration-password-hint"
          />
          <p id="registration-password-hint" className="text-xs text-muted-foreground">
            Sign in with your email and this password next time. At least{" "}
            {PASSWORD_MIN_LENGTH} characters. Leave blank to keep using Google or
            an emailed code.
          </p>
        </div>
      ) : null}

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
