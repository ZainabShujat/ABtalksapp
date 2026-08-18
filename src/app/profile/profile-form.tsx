"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { updateProfileAction } from "@/app/actions/profile-actions";
import { CollegeCombobox } from "@/components/shared/college-combobox";
import { PhoneVerifyField } from "@/components/shared/phone-verify-field";
import {
  updateProfessionalProfileSchema,
  updateStudentProfileSchema,
  type ProfileFormValues,
} from "@/lib/validations/profile";
import { INDIA_DIALING_CODE, isIndianPhone } from "@/lib/validations/phone";
import { userTypeLabel } from "@/lib/profile-display";

type Props = {
  initialProfile: ProfileFormValues;
  phoneVerified: boolean;
  /** When false (local next dev), hide Verify button/dialog for unverified phones. */
  otpVerificationRequired: boolean;
};

export function ProfileForm({
  initialProfile,
  phoneVerified,
  otpVerificationRequired,
}: Props) {
  const router = useRouter();
  const [skillDraft, setSkillDraft] = useState("");
  const [verifyOpen, setVerifyOpen] = useState(false);
  const userType = initialProfile.userType;

  const currentPhone = initialProfile.phone ?? "";
  const defaultNational = isIndianPhone(currentPhone)
    ? currentPhone.slice(3)
    : "";

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(
      userType === "STUDENT"
        ? updateStudentProfileSchema
        : updateProfessionalProfileSchema,
    ) as never,
    defaultValues: initialProfile,
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = form;

  const skills = watch("skills") ?? [];

  const addSkillsFromDraft = useCallback(() => {
    const parts = skillDraft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...skills];
    for (const p of parts) {
      if (next.length >= 10) break;
      if (!next.includes(p)) next.push(p);
    }
    setValue("skills", next, { shouldValidate: true, shouldDirty: true });
    setSkillDraft("");
  }, [skillDraft, skills, setValue]);

  const removeSkill = useCallback(
    (skill: string) => {
      setValue(
        "skills",
        skills.filter((s) => s !== skill),
        { shouldValidate: true, shouldDirty: true },
      );
    },
    [skills, setValue],
  );

  async function onSubmit(values: ProfileFormValues) {
    const fd = new FormData();
    fd.append("fullName", values.fullName);
    fd.append("skills", JSON.stringify(values.skills));
    fd.append("linkedinUrl", values.linkedinUrl ?? "");
    fd.append("resumeUrl", values.resumeUrl ?? "");
    fd.append("phone", values.phone ?? "");
    fd.append("githubUsername", values.githubUsername ?? "");

    if (userType === "STUDENT") {
      const v = values as Extract<ProfileFormValues, { userType: "STUDENT" }>;
      fd.append("college", v.college);
      fd.append("collegeId", v.collegeId ?? "");
      fd.append("graduationYear", String(v.graduationYear));
    } else {
      const v = values as Extract<
        ProfileFormValues,
        { userType: "PROFESSIONAL" }
      >;
      fd.append("organization", v.organization);
      fd.append("role", v.role);
      fd.append("yearsExperience", String(v.yearsExperience));
    }

    const result = await updateProfileAction(fd);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Profile updated");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 sm:space-y-5">
      <div className="space-y-1.5 sm:space-y-2">
        <Label>Account type</Label>
        <p className="text-sm font-medium">{userTypeLabel(userType)}</p>
        <p className="text-xs text-muted-foreground">
          Set during registration and cannot be changed here.
        </p>
      </div>

      <div className="space-y-1.5 sm:space-y-2">
        <Label htmlFor="fullName">Full name</Label>
        <Input id="fullName" autoComplete="name" {...register("fullName")} />
        {errors.fullName ? (
          <p className="text-sm text-destructive">{errors.fullName.message}</p>
        ) : null}
      </div>

      {userType === "STUDENT" ? (
        <>
          <div className="space-y-1.5 sm:space-y-2">
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
                  aria-invalid={!!("college" in errors && errors.college)}
                />
              )}
            />
            {"college" in errors && errors.college ? (
              <p className="text-sm text-destructive">{errors.college.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5 sm:space-y-2">
            <Label htmlFor="graduationYear">Graduation year</Label>
            <Input
              id="graduationYear"
              type="number"
              min={2020}
              max={2035}
              {...register("graduationYear", { valueAsNumber: true })}
            />
            {"graduationYear" in errors && errors.graduationYear ? (
              <p className="text-sm text-destructive">
                {errors.graduationYear.message}
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1.5 sm:space-y-2">
            <Label htmlFor="organization">Organization</Label>
            <Input id="organization" {...register("organization")} />
            {"organization" in errors && errors.organization ? (
              <p className="text-sm text-destructive">
                {errors.organization.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5 sm:space-y-2">
            <Label htmlFor="role">Role</Label>
            <Input id="role" {...register("role")} />
            {"role" in errors && errors.role ? (
              <p className="text-sm text-destructive">{errors.role.message}</p>
            ) : null}
          </div>

          <div className="space-y-1.5 sm:space-y-2">
            <Label htmlFor="yearsExperience">Years of experience</Label>
            <Input
              id="yearsExperience"
              type="number"
              min={0}
              max={60}
              {...register("yearsExperience", { valueAsNumber: true })}
            />
            {"yearsExperience" in errors && errors.yearsExperience ? (
              <p className="text-sm text-destructive">
                {errors.yearsExperience.message}
              </p>
            ) : null}
          </div>
        </>
      )}

      <div className="space-y-1.5 sm:space-y-2">
        <Label>Skills (max 10)</Label>
        <div className="flex flex-wrap gap-2">
          {skills.map((s) => (
            <Badge key={s} variant="secondary" className="gap-1 pr-1">
              {s}
              <button
                type="button"
                className="rounded p-0.5 hover:bg-muted-foreground/20"
                onClick={() => removeSkill(s)}
                aria-label={`Remove ${s}`}
              >
                <X className="size-3.5" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            placeholder="Type skills, comma-separated, then Add"
            value={skillDraft}
            onChange={(e) => setSkillDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSkillsFromDraft();
              }
            }}
            disabled={skills.length >= 10}
          />
          <Button
            type="button"
            variant="outline"
            onClick={addSkillsFromDraft}
            disabled={skills.length >= 10}
          >
            Add
          </Button>
        </div>
        {errors.skills ? (
          <p className="text-sm text-destructive">{errors.skills.message}</p>
        ) : null}
      </div>

      <div className="space-y-1.5 sm:space-y-2">
        <Label htmlFor="linkedinUrl">LinkedIn URL (optional)</Label>
        <Input
          id="linkedinUrl"
          type="url"
          placeholder="https://www.linkedin.com/in/…"
          {...register("linkedinUrl")}
        />
        {errors.linkedinUrl ? (
          <p className="text-sm text-destructive">
            {errors.linkedinUrl.message}
          </p>
        ) : null}
      </div>

      {phoneVerified ? (
        <div className="space-y-1.5 sm:space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="phone">Phone Number</Label>
            <Badge
              variant="secondary"
              className="gap-1 bg-emerald-100 text-emerald-700"
            >
              <CheckCircle2 className="size-3.5" aria-hidden />
              Verified
            </Badge>
          </div>
          <Input
            id="phone"
            type="tel"
            autoComplete="tel"
            readOnly
            aria-readonly
            className="cursor-not-allowed bg-muted/50 opacity-70"
            {...register("phone")}
          />
          {errors.phone ? (
            <p className="text-sm text-destructive">{errors.phone.message}</p>
          ) : null}
        </div>
      ) : otpVerificationRequired ? (
        <div className="space-y-1.5 sm:space-y-2">
          <Label htmlFor="phone">Phone Number</Label>
          <div className="flex gap-2">
            <Input
              id="phone"
              type="tel"
              placeholder="+91 9876543210 or +1 555 123 4567"
              autoComplete="tel"
              className="flex-1"
              {...register("phone")}
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => setVerifyOpen(true)}
            >
              Verify
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Indian (+91) numbers can be verified by OTP. Visible to admins only.
          </p>
          {errors.phone ? (
            <p className="text-sm text-destructive">{errors.phone.message}</p>
          ) : null}

          <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Verify your phone number</DialogTitle>
                <DialogDescription>
                  Enter your Indian (+91) mobile number and the OTP we send to
                  confirm it.
                </DialogDescription>
              </DialogHeader>
              <PhoneVerifyField
                defaultCountryCode={INDIA_DIALING_CODE}
                defaultPhoneNumber={defaultNational}
                onVerified={() => {
                  setVerifyOpen(false);
                  router.refresh();
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <div className="space-y-1.5 sm:space-y-2">
          <Label htmlFor="phone">Phone Number</Label>
          <Input
            id="phone"
            type="tel"
            placeholder="+91 9876543210 or +1 555 123 4567"
            autoComplete="tel"
            {...register("phone")}
          />
          <p className="text-xs text-muted-foreground">
            Optional. Visible to admins only.
          </p>
          {errors.phone ? (
            <p className="text-sm text-destructive">{errors.phone.message}</p>
          ) : null}
        </div>
      )}

      <div className="space-y-1.5 sm:space-y-2">
        <Label htmlFor="githubUsername">GitHub username (optional)</Label>
        <Input
          id="githubUsername"
          placeholder="octocat"
          autoComplete="username"
          {...register("githubUsername")}
        />
        {errors.githubUsername ? (
          <p className="text-sm text-destructive">
            {errors.githubUsername.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5 sm:space-y-2">
        <Label htmlFor="resumeUrl">Resume Link</Label>
        <Input
          id="resumeUrl"
          type="url"
          placeholder="https://drive.google.com/... or LinkedIn resume URL"
          {...register("resumeUrl")}
        />
        <p className="text-xs text-muted-foreground">
          Visible to admins only. Paste a Google Drive, Dropbox, or LinkedIn-hosted
          resume link.
        </p>
        {errors.resumeUrl ? (
          <p className="text-sm text-destructive">{errors.resumeUrl.message}</p>
        ) : null}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
