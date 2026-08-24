"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { type Resolver, Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { completeRegistrationAction } from "@/app/actions/registration-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CollegeCombobox } from "@/components/shared/college-combobox";
import { PhoneVerifyField } from "@/components/shared/phone-verify-field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  LegalConsentFields,
  legalConsentAccepted,
  type LegalConsentValues,
} from "@/components/legal/legal-consent-fields";
import {
  registerPayloadSchema,
} from "@/lib/validations/register";

/** RHF model includes fields from both branches; Zod still validates via `registerPayloadSchema`. */
type RegistrationFormValues = {
  userType: "STUDENT" | "PROFESSIONAL";
  fullName: string;
  college: string;
  collegeId: string;
  graduationYear: number;
  organization: string;
  role: string;
  yearsExperience: number | undefined;
  skills: string[];
  linkedinUrl: string;
  countryCode: string;
  phoneNumber: string;
  githubUsername: string;
  referralCode: string;
  acceptLegal: boolean;
  newsletterOptIn: boolean;
};

const GRADUATION_YEARS = [2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035] as const;

type Props = {
  initialName: string;
  initialRef: string;
  /** When false (local `next dev`), OTP is not required to submit. */
  otpVerificationRequired: boolean;
};

export function RegistrationForm({
  initialName,
  initialRef,
  otpVerificationRequired,
}: Props) {
  const router = useRouter();
  const [skillDraft, setSkillDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      graduationYear: 2026,
      organization: "",
      role: "",
      yearsExperience: undefined,
      skills: [],
      linkedinUrl: "",
      countryCode: "+91",
      phoneNumber: "",
      githubUsername: "",
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

  const skills = watch("skills") ?? [];
  const userType = watch("userType");

  const handlePhoneChange = useCallback(
    (v: { countryCode: string; phoneNumber: string; e164: string }) => {
      setValue("countryCode", v.countryCode);
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
      clearErrors(["college", "graduationYear"]);
    } else {
      setValue("college", "");
      setValue("collegeId", "");
      setValue("graduationYear", 2026);
      clearErrors(["organization", "role", "yearsExperience"]);
    }
  }

  function addSkillsFromDraft() {
    const parts = skillDraft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...skills];
    for (const p of parts) {
      if (next.length >= 10) break;
      const trimmed = p.slice(0, 50);
      if (trimmed && !next.includes(trimmed)) next.push(trimmed);
    }
    setValue("skills", next, { shouldValidate: true });
    setSkillDraft("");
  }

  function removeSkill(index: number) {
    setValue(
      "skills",
      skills.filter((_, i) => i !== index),
      { shouldValidate: true },
    );
  }

  async function onSubmit(values: RegistrationFormValues) {
    if (!legalConsentAccepted(legalConsent)) {
      toast.error("Please accept the Terms of Service and Privacy Policy.");
      return;
    }
    if (
      otpVerificationRequired &&
      values.countryCode === "+91" &&
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
      fd.append("skills", values.skills.join(","));
      fd.append("linkedinUrl", values.linkedinUrl ?? "");
      fd.append("countryCode", values.countryCode);
      fd.append("phoneNumber", values.phoneNumber ?? "");
      fd.append("githubUsername", values.githubUsername ?? "");
      fd.append("referralCode", values.referralCode ?? "");
      fd.append("acceptLegal", String(legalConsent.acceptLegal));
      fd.append("newsletterOptIn", String(legalConsent.newsletterOptIn));

      if (values.userType === "STUDENT") {
        fd.append("college", values.college);
        fd.append("collegeId", values.collegeId);
        fd.append("graduationYear", String(values.graduationYear));
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
      router.push("/dashboard");
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

            <div className="space-y-2">
              <Label htmlFor="graduationYear">Graduation year</Label>
              <Controller
                name="graduationYear"
                control={control}
                render={({ field }) => (
                  <Select
                    value={String(field.value)}
                    onValueChange={(v) => {
                      if (v != null) field.onChange(Number(v));
                    }}
                  >
                    <SelectTrigger
                      id="graduationYear"
                      className="w-full min-w-0"
                      aria-invalid={!!errors.graduationYear}
                    >
                      <SelectValue placeholder="Select year" />
                    </SelectTrigger>
                    <SelectContent>
                      {GRADUATION_YEARS.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.graduationYear ? (
                <p className="text-sm text-destructive">
                  {errors.graduationYear.message}
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
              <Label htmlFor="organization">Organization</Label>
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
                placeholder="5"
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

      <div className="space-y-2">
        <Label htmlFor="skills">Skills</Label>
        <p className="text-xs text-muted-foreground">
          Comma-separated. Examples: Python, React, SQL (up to 10)
        </p>
        <Input
          id="skills"
          value={skillDraft}
          onChange={(e) => setSkillDraft(e.target.value)}
          onBlur={() => addSkillsFromDraft()}
          onKeyDown={(e) => {
            if (e.key === ",") {
              e.preventDefault();
              addSkillsFromDraft();
            }
            if (e.key === "Enter") {
              e.preventDefault();
              addSkillsFromDraft();
            }
          }}
          placeholder="Type a skill, then comma or Enter"
          disabled={skills.length >= 10}
        />
        {skills.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {skills.map((s, i) => (
              <Badge
                key={`${s}-${i}`}
                variant="secondary"
                className="gap-1 pr-1 font-normal"
              >
                {s}
                <button
                  type="button"
                  className="rounded-sm p-0.5 hover:bg-muted"
                  onClick={() => removeSkill(i)}
                  aria-label={`Remove ${s}`}
                >
                  <X className="size-3.5" />
                </button>
              </Badge>
            ))}
          </div>
        ) : null}
        {errors.skills ? (
          <p className="text-sm text-destructive">{errors.skills.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="linkedinUrl">LinkedIn URL (optional)</Label>
        <Input
          id="linkedinUrl"
          type="url"
          placeholder="https://www.linkedin.com/in/yourname"
          {...register("linkedinUrl")}
          aria-invalid={!!errors.linkedinUrl}
        />
        {errors.linkedinUrl ? (
          <p className="text-sm text-destructive">
            {errors.linkedinUrl.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <input type="hidden" {...register("countryCode")} />
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
        <Label htmlFor="githubUsername">GitHub username (optional)</Label>
        <Input
          id="githubUsername"
          placeholder="yourname"
          {...register("githubUsername")}
          aria-invalid={!!errors.githubUsername}
        />
        {errors.githubUsername ? (
          <p className="text-sm text-destructive">
            {errors.githubUsername.message}
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
              placeholder="ABC123"
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
        className="inline-flex w-full items-center justify-center gap-2 sm:w-auto"
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
