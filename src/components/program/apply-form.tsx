"use client";

import { useState, type KeyboardEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info, Loader2, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { z } from "zod";
import { applyToProgramAction } from "@/app/actions/program-entry-actions";
import {
  LegalConsentFields,
  legalConsentAccepted,
  type LegalConsentValues,
} from "@/components/legal/legal-consent-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applyProfileSchema,
  type ApplyProfileInput,
} from "@/lib/validations/program";

type ApplyFormInput = z.input<typeof applyProfileSchema>;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-[0.8rem] font-medium text-destructive">{message}</p>;
}

export function ApplyForm({ joinCode }: { joinCode: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [skillInput, setSkillInput] = useState("");
  const [legalConsent, setLegalConsent] = useState<LegalConsentValues>({
    acceptLegal: false,
    newsletterOptIn: true,
  });
  const [recruiterVisibility, setRecruiterVisibility] = useState(false);

  const form = useForm<ApplyFormInput, unknown, ApplyProfileInput>({
    resolver: zodResolver(applyProfileSchema),
    defaultValues: {
      fullName: "",
      jobRole: "",
      company: "",
      education: "",
      university: "",
      skills: [],
      linkedinUrl: "",
      resumeUrl: "",
      phone: "",
      githubUsername: "",
      githubRepoUrl: "",
      acceptLegal: false,
      newsletterOptIn: true,
      recruiterVisibilityConsent: false,
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = form;

  const skills = watch("skills") ?? [];

  function addSkill() {
    const value = skillInput.trim().replace(/,$/, "").trim();
    if (!value) return;
    if (skills.length >= 8) {
      toast.error("You can add up to 8 skills.");
      return;
    }
    if (skills.some((s) => s.toLowerCase() === value.toLowerCase())) {
      setSkillInput("");
      return;
    }
    setValue("skills", [...skills, value], { shouldValidate: true });
    setSkillInput("");
  }

  function removeSkill(skill: string) {
    setValue(
      "skills",
      skills.filter((s) => s !== skill),
      { shouldValidate: true },
    );
  }

  function onSkillKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addSkill();
    } else if (e.key === "Backspace" && skillInput === "" && skills.length > 0) {
      removeSkill(skills[skills.length - 1]!);
    }
  }

  async function onSubmit(values: ApplyProfileInput) {
    if (!legalConsentAccepted(legalConsent)) {
      toast.error("Please accept the Terms of Service and Privacy Policy.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await applyToProgramAction({
        ...values,
        joinCode,
        acceptLegal: legalConsent.acceptLegal,
        newsletterOptIn: legalConsent.newsletterOptIn,
        recruiterVisibilityConsent: recruiterVisibility,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Application submitted.");
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="fullName">Full name</Label>
        <Input id="fullName" {...register("fullName")} />
        <FieldError message={errors.fullName?.message} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="jobRole">Current role</Label>
          <Input id="jobRole" {...register("jobRole")} />
          <FieldError message={errors.jobRole?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company">Company</Label>
          <Input id="company" {...register("company")} />
          <FieldError message={errors.company?.message} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="yearsExperience">Years of experience</Label>
          <Input
            id="yearsExperience"
            type="number"
            min={0}
            max={40}
            {...register("yearsExperience", { valueAsNumber: true })}
          />
          <FieldError message={errors.yearsExperience?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="graduationYear">Graduation year (optional)</Label>
          <Input
            id="graduationYear"
            type="number"
            {...register("graduationYear", {
              setValueAs: (v) => (v === "" ? "" : Number(v)),
            })}
          />
          <FieldError message={errors.graduationYear?.message} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="education">Education (optional)</Label>
          <Input id="education" {...register("education")} />
          <FieldError message={errors.education?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="university">University (optional)</Label>
          <Input id="university" {...register("university")} />
          <FieldError message={errors.university?.message} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="skillInput">Skills</Label>
        <div className="flex flex-wrap gap-2">
          {skills.map((skill) => (
            <span
              key={skill}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-sm text-primary"
            >
              {skill}
              <button
                type="button"
                onClick={() => removeSkill(skill)}
                className="rounded-full hover:bg-primary/20"
                aria-label={`Remove ${skill}`}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
        <Input
          id="skillInput"
          value={skillInput}
          onChange={(e) => setSkillInput(e.target.value)}
          onKeyDown={onSkillKeyDown}
          onBlur={addSkill}
          placeholder="Type a skill and press Enter"
        />
        <FieldError message={errors.skills?.message} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="linkedinUrl">LinkedIn URL</Label>
          <Input
            id="linkedinUrl"
            placeholder="https://linkedin.com/in/you"
            {...register("linkedinUrl")}
          />
          <FieldError message={errors.linkedinUrl?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="resumeUrl">Resume URL (optional)</Label>
          <Input id="resumeUrl" {...register("resumeUrl")} />
          <FieldError message={errors.resumeUrl?.message} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input id="phone" {...register("phone")} />
        <FieldError message={errors.phone?.message} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="githubUsername">GitHub username</Label>
          <Input id="githubUsername" {...register("githubUsername")} />
          <FieldError message={errors.githubUsername?.message} />
        </div>
        <div className="space-y-2">
          <Label
            htmlFor="githubRepoUrl"
            className="inline-flex items-center gap-1.5"
          >
            Program repo URL
            <span
              className="inline-flex size-4 items-center justify-center rounded-full border border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              title="IMPORTANT: This repository will be used throughout the cohort for task completion and verification. Make sure you type it correctly."
              aria-label="Important information about the program repository URL"
            >
              <Info className="size-2.5" strokeWidth={3} aria-hidden />
            </span>
          </Label>
          <Input
            id="githubRepoUrl"
            placeholder="https://github.com/you/ai-cohort"
            {...register("githubRepoUrl")}
          />
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
            <span className="font-semibold">IMPORTANT:</span> The repository you
            create will be used in the cohort for task completion and
            verification, make sure you type it correctly.
          </p>
          <FieldError message={errors.githubRepoUrl?.message} />
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-3 text-sm leading-snug">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 rounded border"
            {...register("hasLaptop8Gb", {
              setValueAs: (v) => v === true || v === "on",
            })}
          />
          <span>
            I have a laptop with at least 8 GB RAM available for this program
          </span>
        </label>
        <FieldError message={errors.hasLaptop8Gb?.message} />
      </div>

      <LegalConsentFields
        values={legalConsent}
        onChange={(next) => {
          setLegalConsent(next);
          setValue("acceptLegal", next.acceptLegal);
          setValue("newsletterOptIn", next.newsletterOptIn);
        }}
      >
        <label className="flex items-start gap-3 text-sm leading-snug">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 rounded border"
            checked={recruiterVisibility}
            onChange={(e) => {
              setRecruiterVisibility(e.target.checked);
              setValue("recruiterVisibilityConsent", e.target.checked);
            }}
          />
          <span>
            I opt in to share my program profile with approved recruiters on the
            ABTalks talent portal after results are published (email, LinkedIn,
            resume, GitHub, scores, and interview summary — not my phone or full
            interview transcript).
          </span>
        </label>
      </LegalConsentFields>

      <Button
        type="submit"
        disabled={submitting || !legalConsentAccepted(legalConsent)}
        className="w-full sm:w-auto"
      >        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Submitting…
          </>
        ) : (
          "Submit application"
        )}
      </Button>
    </form>
  );
}
