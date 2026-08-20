"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { CircleCheck, Loader2 } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { submitCohortApplicationAction } from "@/app/actions/cohort-application-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AI_ML_EXPERIENCE,
  cohortApplicationSchema,
  EDUCATION_LEVELS,
  INDUSTRIES,
  START_WINDOWS,
  TARGET_ROLES,
  TOTAL_EXPERIENCE,
  VISA_CATEGORIES,
  type CohortApplicationInput,
} from "@/lib/validations/cohort-application";
import { cn } from "@/lib/utils";

const STEP_SHORT_LABELS = [
  "Personal",
  "Background",
  "Your Story",
  "Commitment",
  "Review",
] as const;

const SELECT_TRIGGER_CLASS =
  "h-10 w-full min-w-0 rounded-xl text-base md:text-sm data-[size=default]:h-10";

const STEP_TITLES: Record<number, string> = {
  1: "Personal Information",
  2: "Professional Background",
  3: "Your Story",
  4: "Commitment & Readiness",
  5: "Review & Submit",
};

const STEP_DESCRIPTIONS: Record<number, string> = {
  1: "Tell us about yourself. This helps us personalise your cohort experience and communicate program updates.",
  2: "Help us understand your experience level. Instructors use this to calibrate examples and mentorship to your context.",
  3: "This is the most important section. We want to understand your motivation, your goals, and what you plan to do with what you learn.",
  4: "This program demands real effort. We ask every applicant to confirm these commitments before we review their application.",
  5: "Review your answers carefully before submitting your application.",
};

const STEP_FIELDS: Record<number, (keyof CohortApplicationInput)[]> = {
  1: ["firstName", "lastName", "email", "linkedinUrl", "visaCategory"],
  2: [
    "educationLevel",
    "totalExperience",
    "aiMlExperience",
    "currentTitleCompany",
    "industry",
    "primaryLanguagesTools",
  ],
  3: ["whyInterested", "whatToAchieve", "targetRole"],
  4: [
    "commitHours",
    "attendSessions",
    "understandPreCall",
    "basedInUsa",
    "readyForChallenge",
    "preferredStartWindow",
    "acceptLegal",
  ],
  5: [],
};

const COMMITMENTS: {
  name: keyof Pick<
    CohortApplicationInput,
    | "commitHours"
    | "attendSessions"
    | "understandPreCall"
    | "basedInUsa"
    | "readyForChallenge"
  >;
  label: string;
}[] = [
  {
    name: "commitHours",
    label:
      "I can commit at least 2 hours per day for the full 30-day program.",
  },
  {
    name: "attendSessions",
    label:
      "I will attend all live sessions and complete the assigned live projects.",
  },
  {
    name: "understandPreCall",
    label:
      "I understand a 30-minute pre-cohort call is required before acceptance.",
  },
  {
    name: "basedInUsa",
    label: "I am currently based in the United States.",
  },
  {
    name: "readyForChallenge",
    label:
      "I am ready for an intensive, hands-on learning challenge with real accountability.",
  },
];

const EMPTY_DEFAULTS = {
  firstName: "",
  lastName: "",
  email: "",
  linkedinUrl: "",
  visaCategory: "",
  educationLevel: "",
  totalExperience: "",
  aiMlExperience: "",
  currentTitleCompany: "",
  industry: "",
  primaryLanguagesTools: "",
  whyInterested: "",
  whatToAchieve: "",
  targetRole: "",
  commitHours: false,
  attendSessions: false,
  understandPreCall: false,
  basedInUsa: false,
  readyForChallenge: false,
  preferredStartWindow: "",
  acceptLegal: false,
  newsletterOptIn: true,
} as unknown as CohortApplicationInput;

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value || "-"}</dd>
    </div>
  );
}

function ReviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-display text-sm font-semibold text-foreground">
        {title}
      </h3>
      <dl className="space-y-2 rounded-lg border bg-muted/30 p-4">{children}</dl>
    </div>
  );
}

function FormStepStepper({ step }: { step: number }) {
  const total = STEP_SHORT_LABELS.length;
  const progressPct = total > 1 ? ((step - 1) / (total - 1)) * 100 : 0;

  return (
    <nav aria-label="Application progress" className="w-full">
      <div className="relative px-1">
        <div
          className="absolute top-4 right-[10%] left-[10%] h-px bg-border"
          aria-hidden
        />
        <div
          className="absolute top-4 left-[10%] h-px bg-primary transition-all duration-300 ease-out"
          style={{ width: `${progressPct * 0.8}%` }}
          aria-hidden
        />
        <ol className="relative flex justify-between">
          {STEP_SHORT_LABELS.map((label, index) => {
            const stepNum = index + 1;
            const isActive = stepNum === step;
            const isComplete = stepNum < step;

            return (
              <li
                key={label}
                className="flex flex-col items-center gap-2"
                aria-current={isActive ? "step" : undefined}
              >
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-background text-xs font-bold transition-colors",
                    isActive && "border-primary text-primary shadow-sm shadow-primary/20",
                    isComplete &&
                      "border-primary bg-primary text-primary-foreground",
                    !isActive &&
                      !isComplete &&
                      "border-muted-foreground/25 text-muted-foreground",
                  )}
                >
                  {stepNum}
                </div>
                <span
                  className={cn(
                    "max-w-[3.25rem] text-center text-[9px] font-semibold uppercase leading-tight tracking-wide sm:max-w-none sm:text-[11px]",
                    isActive && "text-primary",
                    isComplete && !isActive && "text-primary/80",
                    !isActive && !isComplete && "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

function StepIntro({ step }: { step: number }) {
  return (
    <div className="space-y-2 border-b border-border/60 pb-6">
      <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {STEP_TITLES[step]}
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
        {STEP_DESCRIPTIONS[step]}
      </p>
    </div>
  );
}

export function ApplicationForm() {
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<CohortApplicationInput>({
    resolver: zodResolver(cohortApplicationSchema),
    mode: "onTouched",
    defaultValues: EMPTY_DEFAULTS,
  });

  const {
    register,
    control,
    handleSubmit,
    trigger,
    watch,
    formState: { errors },
  } = form;

  const values = watch();

  async function handleNext() {
    const fields = STEP_FIELDS[step];
    const ok = await trigger(fields);
    if (ok) {
      // Defer step change so the "Next" click doesn't land on the step-5 Submit button.
      setTimeout(() => setStep((s) => Math.min(5, s + 1)), 0);
    }
  }

  function handleBack() {
    setStep((s) => Math.max(1, s - 1));
  }

  async function onSubmit(formValues: CohortApplicationInput) {
    setIsSubmitting(true);
    try {
      const res = await submitCohortApplicationAction(formValues);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Card className="mx-auto max-w-2xl rounded-xl border-border/60 shadow-[var(--shadow-card)]">
        <CardContent className="flex flex-col items-center px-6 py-16 text-center">
          <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-primary/10">
            <CircleCheck className="size-10 text-primary" aria-hidden />
          </div>
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Application received!
          </h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            Thank you for applying to AI Cohort Training Program - Cohort 1.
            Our team will review your application and get back to you within 3-5 business days.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-2xl rounded-xl border-border/60 shadow-[var(--shadow-card)]">
      <CardHeader className="space-y-5">
        <div className="text-center sm:text-left">
          <CardTitle className="font-display text-lg font-bold uppercase tracking-wide sm:text-xl">
            AI Cohort Training Program
          </CardTitle>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Pre-assessment - Cohort 1 - USA
          </p>
        </div>

        <FormStepStepper step={step} />
      </CardHeader>

      <CardContent>
        <form
          onSubmit={(e) => e.preventDefault()}
          className="space-y-6"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <StepIntro step={step} />

              {step === 1 ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First name</Label>
                      <Input
                        id="firstName"
                        autoComplete="given-name"
                        {...register("firstName")}
                        aria-invalid={!!errors.firstName}
                      />
                      {errors.firstName ? (
                        <p className="text-sm text-destructive">
                          {errors.firstName.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last name</Label>
                      <Input
                        id="lastName"
                        autoComplete="family-name"
                        {...register("lastName")}
                        aria-invalid={!!errors.lastName}
                      />
                      {errors.lastName ? (
                        <p className="text-sm text-destructive">
                          {errors.lastName.message}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      {...register("email")}
                      aria-invalid={!!errors.email}
                    />
                    {errors.email ? (
                      <p className="text-sm text-destructive">
                        {errors.email.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="linkedinUrl">LinkedIn profile URL</Label>
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
                    <Label htmlFor="visaCategory">Visa / immigration status</Label>
                    <Controller
                      name="visaCategory"
                      control={control}
                      render={({ field }) => (
                        <Select
                          value={field.value || null}
                          onValueChange={(v) => {
                            if (v != null) field.onChange(v);
                          }}
                        >
                          <SelectTrigger
                            id="visaCategory"
                            className={SELECT_TRIGGER_CLASS}
                            aria-invalid={!!errors.visaCategory}
                          >
                            <SelectValue placeholder="Select an option" />
                          </SelectTrigger>
                          <SelectContent>
                            {VISA_CATEGORIES.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.visaCategory ? (
                      <p className="text-sm text-destructive">
                        {errors.visaCategory.message}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="educationLevel">Highest education level</Label>
                    <Controller
                      name="educationLevel"
                      control={control}
                      render={({ field }) => (
                        <Select
                          value={field.value || null}
                          onValueChange={(v) => {
                            if (v != null) field.onChange(v);
                          }}
                        >
                          <SelectTrigger
                            id="educationLevel"
                            className={SELECT_TRIGGER_CLASS}
                            aria-invalid={!!errors.educationLevel}
                          >
                            <SelectValue placeholder="Select an option" />
                          </SelectTrigger>
                          <SelectContent>
                            {EDUCATION_LEVELS.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.educationLevel ? (
                      <p className="text-sm text-destructive">
                        {errors.educationLevel.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="totalExperience">
                      Total professional experience
                    </Label>
                    <Controller
                      name="totalExperience"
                      control={control}
                      render={({ field }) => (
                        <Select
                          value={field.value || null}
                          onValueChange={(v) => {
                            if (v != null) field.onChange(v);
                          }}
                        >
                          <SelectTrigger
                            id="totalExperience"
                            className={SELECT_TRIGGER_CLASS}
                            aria-invalid={!!errors.totalExperience}
                          >
                            <SelectValue placeholder="Select an option" />
                          </SelectTrigger>
                          <SelectContent>
                            {TOTAL_EXPERIENCE.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.totalExperience ? (
                      <p className="text-sm text-destructive">
                        {errors.totalExperience.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="aiMlExperience">AI / ML experience</Label>
                    <Controller
                      name="aiMlExperience"
                      control={control}
                      render={({ field }) => (
                        <Select
                          value={field.value || null}
                          onValueChange={(v) => {
                            if (v != null) field.onChange(v);
                          }}
                        >
                          <SelectTrigger
                            id="aiMlExperience"
                            className={SELECT_TRIGGER_CLASS}
                            aria-invalid={!!errors.aiMlExperience}
                          >
                            <SelectValue placeholder="Select an option" />
                          </SelectTrigger>
                          <SelectContent>
                            {AI_ML_EXPERIENCE.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.aiMlExperience ? (
                      <p className="text-sm text-destructive">
                        {errors.aiMlExperience.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="currentTitleCompany">
                      Current title & company
                    </Label>
                    <Input
                      id="currentTitleCompany"
                      placeholder="e.g. Senior Software Engineer at Acme Corp"
                      maxLength={200}
                      {...register("currentTitleCompany")}
                      aria-invalid={!!errors.currentTitleCompany}
                    />
                    {errors.currentTitleCompany ? (
                      <p className="text-sm text-destructive">
                        {errors.currentTitleCompany.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="industry">Industry</Label>
                    <Controller
                      name="industry"
                      control={control}
                      render={({ field }) => (
                        <Select
                          value={field.value || null}
                          onValueChange={(v) => {
                            if (v != null) field.onChange(v);
                          }}
                        >
                          <SelectTrigger
                            id="industry"
                            className={SELECT_TRIGGER_CLASS}
                            aria-invalid={!!errors.industry}
                          >
                            <SelectValue placeholder="Select an option" />
                          </SelectTrigger>
                          <SelectContent>
                            {INDUSTRIES.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.industry ? (
                      <p className="text-sm text-destructive">
                        {errors.industry.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="primaryLanguagesTools">
                      Primary languages & tools
                    </Label>
                    <Input
                      id="primaryLanguagesTools"
                      placeholder="e.g. Python, TypeScript, AWS, LangChain"
                      maxLength={300}
                      {...register("primaryLanguagesTools")}
                      aria-invalid={!!errors.primaryLanguagesTools}
                    />
                    {errors.primaryLanguagesTools ? (
                      <p className="text-sm text-destructive">
                        {errors.primaryLanguagesTools.message}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}

              {step === 3 ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="whyInterested">
                      Why are you interested in this program?{" "}
                      <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="whyInterested"
                      rows={6}
                      placeholder="Tell us what brought you here…"
                      {...register("whyInterested")}
                      aria-invalid={!!errors.whyInterested}
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Be specific - generic answers like &ldquo;I want to learn
                      AI&rdquo; are less compelling than concrete context about
                      your current situation.
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        150-250 words recommended
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {countWords(values.whyInterested ?? "")} words
                      </p>
                    </div>
                    {errors.whyInterested ? (
                      <p className="text-sm text-destructive">
                        {errors.whyInterested.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="whatToAchieve">
                      What do you hope to achieve?{" "}
                      <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="whatToAchieve"
                      rows={6}
                      placeholder="Describe the specific outcome you're working toward…"
                      {...register("whatToAchieve")}
                      aria-invalid={!!errors.whatToAchieve}
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Name the role, company type, project, or capability you
                      want to have 90 days after the program ends.
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        150-250 words recommended
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {countWords(values.whatToAchieve ?? "")} words
                      </p>
                    </div>
                    {errors.whatToAchieve ? (
                      <p className="text-sm text-destructive">
                        {errors.whatToAchieve.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="targetRole">Target role after the program</Label>
                    <Controller
                      name="targetRole"
                      control={control}
                      render={({ field }) => (
                        <Select
                          value={field.value || null}
                          onValueChange={(v) => {
                            if (v != null) field.onChange(v);
                          }}
                        >
                          <SelectTrigger
                            id="targetRole"
                            className={SELECT_TRIGGER_CLASS}
                            aria-invalid={!!errors.targetRole}
                          >
                            <SelectValue placeholder="Select an option" />
                          </SelectTrigger>
                          <SelectContent>
                            {TARGET_ROLES.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.targetRole ? (
                      <p className="text-sm text-destructive">
                        {errors.targetRole.message}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}

              {step === 4 ? (
                <>
                  <div className="space-y-4">
                    {COMMITMENTS.map(({ name, label }) => (
                      <div key={name} className="space-y-1">
                        <div className="flex items-start gap-3">
                          <Controller
                            name={name}
                            control={control}
                            render={({ field }) => (
                              <Checkbox
                                id={name}
                                checked={field.value === true}
                                onCheckedChange={(checked) =>
                                  field.onChange(checked === true)
                                }
                                aria-invalid={!!errors[name]}
                                className="mt-0.5"
                              />
                            )}
                          />
                          <Label
                            htmlFor={name}
                            className="cursor-pointer text-sm font-normal leading-snug"
                          >
                            {label}
                          </Label>
                        </div>
                        {errors[name] ? (
                          <p className="pl-7 text-sm text-destructive">
                            {errors[name]?.message}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-4 rounded-lg border border-border/70 bg-muted/20 p-4">
                    <div className="space-y-1">
                      <div className="flex items-start gap-3">
                        <Controller
                          name="acceptLegal"
                          control={control}
                          render={({ field }) => (
                            <Checkbox
                              id="acceptLegal"
                              checked={field.value === true}
                              onCheckedChange={(checked) =>
                                field.onChange(checked === true)
                              }
                              aria-invalid={!!errors.acceptLegal}
                              className="mt-0.5 size-4 border-foreground/50 bg-background shadow-sm"
                            />
                          )}
                        />
                        <Label
                          htmlFor="acceptLegal"
                          className="cursor-pointer text-sm font-normal leading-snug"
                        >
                          I agree to the{" "}
                          <Link
                            href="/terms"
                            target="_blank"
                            className="font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Terms of Service
                          </Link>{" "}
                          and{" "}
                          <Link
                            href="/privacy"
                            target="_blank"
                            className="font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Privacy Policy
                          </Link>
                          .
                        </Label>
                      </div>
                      {errors.acceptLegal ? (
                        <p className="pl-7 text-sm text-destructive">
                          {errors.acceptLegal?.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1 border-t border-border/60 pt-3">
                      <div className="flex items-start gap-3">
                        <Controller
                          name="newsletterOptIn"
                          control={control}
                          render={({ field }) => (
                            <Checkbox
                              id="newsletterOptIn"
                              checked={field.value === true}
                              onCheckedChange={(checked) =>
                                field.onChange(checked === true)
                              }
                              className="mt-0.5 size-4 border-foreground/50 bg-background shadow-sm"
                            />
                          )}
                        />
                        <Label
                          htmlFor="newsletterOptIn"
                          className="cursor-pointer text-sm font-normal leading-snug"
                        >
                          Send me occasional updates about new challenges,
                          workshops and opportunities.
                        </Label>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="preferredStartWindow">
                      Preferred start window
                    </Label>
                    <Controller
                      name="preferredStartWindow"
                      control={control}
                      render={({ field }) => (
                        <Select
                          value={field.value || null}
                          onValueChange={(v) => {
                            if (v != null) field.onChange(v);
                          }}
                        >
                          <SelectTrigger
                            id="preferredStartWindow"
                            className={SELECT_TRIGGER_CLASS}
                            aria-invalid={!!errors.preferredStartWindow}
                          >
                            <SelectValue placeholder="Select an option" />
                          </SelectTrigger>
                          <SelectContent>
                            {START_WINDOWS.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.preferredStartWindow ? (
                      <p className="text-sm text-destructive">
                        {errors.preferredStartWindow.message}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}

              {step === 5 ? (
                <div className="space-y-6">
                  <ReviewSection title="Personal Information">
                    <ReviewRow
                      label="Name"
                      value={`${values.firstName} ${values.lastName}`.trim()}
                    />
                    <ReviewRow label="Email" value={values.email} />
                    <ReviewRow label="LinkedIn" value={values.linkedinUrl} />
                    <ReviewRow label="Visa status" value={values.visaCategory} />
                  </ReviewSection>

                  <ReviewSection title="Professional Background">
                    <ReviewRow
                      label="Education"
                      value={values.educationLevel}
                    />
                    <ReviewRow
                      label="Experience"
                      value={values.totalExperience}
                    />
                    <ReviewRow label="AI/ML exp." value={values.aiMlExperience} />
                    <ReviewRow
                      label="Title & company"
                      value={values.currentTitleCompany}
                    />
                    <ReviewRow label="Industry" value={values.industry} />
                    <ReviewRow
                      label="Languages & tools"
                      value={values.primaryLanguagesTools}
                    />
                  </ReviewSection>

                  <ReviewSection title="Your Story">
                    <ReviewRow label="Why interested" value={values.whyInterested} />
                    <ReviewRow
                      label="What to achieve"
                      value={values.whatToAchieve}
                    />
                  </ReviewSection>

                  <ReviewSection title="Commitment & Readiness">
                    <ReviewRow label="Confirmations" value="All 5 confirmed ✓" />
                    <ReviewRow
                      label="Start window"
                      value={values.preferredStartWindow}
                    />
                  </ReviewSection>

                  <ReviewSection title="Target Role">
                    <ReviewRow label="Target role" value={values.targetRole} />
                  </ReviewSection>

                  <p className="text-sm text-muted-foreground">
                    By submitting, you confirm all information provided is
                    accurate and complete.
                  </p>
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
            {step > 1 ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={isSubmitting}
              >
                Back
              </Button>
            ) : (
              <span />
            )}

            {step < 5 ? (
              <Button
                type="button"
                className={cn("sm:ml-auto")}
                onClick={() => void handleNext()}
              >
                Next
              </Button>
            ) : (
              <Button
                type="button"
                className="sm:ml-auto"
                disabled={isSubmitting}
                onClick={() => void handleSubmit(onSubmit)()}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Submitting…
                  </>
                ) : (
                  "Submit Application →"
                )}
              </Button>
            )}
          </div>

          {step === 4 ? (
            <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="font-display text-xs font-bold uppercase tracking-wide text-primary">
                What happens next:
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                After submitting, our team reviews your application within 3-5
                business days. Shortlisted applicants receive a calendar invite
                for a 30-minute pre-cohort call with a program instructor. Seats
                are confirmed after the call on a first-qualified basis.
              </p>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
