"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Sparkles,
  FileText,
  CheckCircle2,
  ArrowRight,
  GraduationCap,
  Briefcase,
  Phone,
  Loader2,
  User,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { acknowledgeClaimProfileAction } from "@/app/actions/claim-profile-actions";

type ClaimSummary = {
  fullName: string;
  headline: string;
  phone: string | null;
  phoneVerified: boolean;
  education: {
    degree: string | null;
    institutionName: string | null;
    graduationYear: number | null;
  } | null;
  skills: string[];
  resumeFileName: string | null;
};

type Props = {
  summary: ClaimSummary;
  userEmail: string;
  isPreview?: boolean;
};

export function ClaimProfileClient({ summary, userEmail, isPreview = false }: Props) {
  const router = useRouter();
  const [loadingTarget, setLoadingTarget] = useState<"/profile" | "/dashboard" | null>(null);

  const firstName = summary.fullName.trim().split(/\s+/)[0] || "there";

  const handleAcknowledge = async (target: "/profile" | "/dashboard") => {
    if (isPreview) {
      setLoadingTarget(target);
      toast.success(
        target === "/profile"
          ? "[Preview Mode] Profile confirmed! Heading to profile."
          : "[Preview Mode] Profile confirmed! Heading to dashboard.",
      );
      setTimeout(() => {
        router.push(target);
      }, 600);
      return;
    }

    try {
      setLoadingTarget(target);
      const res = await acknowledgeClaimProfileAction(target);
      if (!res.ok) {
        toast.error(res.message || "Something went wrong");
        setLoadingTarget(null);
        return;
      }
      toast.success(
        target === "/profile"
          ? "Welcome! Please verify your phone number."
          : "Welcome to your dashboard!",
      );
      router.push(res.redirectUrl);
    } catch {
      toast.error("Failed to proceed. Please try again.");
      setLoadingTarget(null);
    }
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-100 px-4 py-6 sm:py-12 text-stone-900 sm:px-6 lg:px-8">
      {/* Decorative ambient background glows */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 flex transform-gpu justify-center overflow-hidden blur-3xl"
        aria-hidden="true"
      >
        <div className="aspect-[1318/752] w-[82.375rem] flex-none bg-gradient-to-tr from-amber-200/50 via-emerald-100/40 to-sky-200/40 opacity-70" />
      </div>

      <div className="mx-auto max-w-2xl">
        {/* Universal Top Brand Logo */}
        <div className="mb-6 sm:mb-8 flex justify-center">
          <Link href="/" className="inline-flex items-center gap-2 focus-visible:outline-none">
            <Image
              src="/abtalks-logo.png"
              alt="ABTalks"
              width={130}
              height={36}
              className="h-7 sm:h-8 w-auto object-contain"
              priority
            />
          </Link>
        </div>

        {/* Header Branding */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50/90 px-3.5 py-1 text-xs font-semibold text-amber-900 shadow-xs">
            <Sparkles className="size-3.5 text-amber-600" />
            <span>Profile Created From Résumé</span>
          </div>

          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-stone-950 sm:text-4xl">
            Welcome to ABTalks, {firstName}!
          </h1>

          <p className="mx-auto mt-2.5 max-w-lg text-sm sm:text-base leading-relaxed text-stone-600">
            Your profile has been created directly from your résumé and is{" "}
            <span className="font-semibold text-stone-900">now live for recruiters</span>.
            Review your details to ensure recruiters reach you on the right contact information.
          </p>
        </div>

        {/* Prominent Attention / Action Required Banner with Warning Triangle (Shallika requirement) */}
        <div className="mt-6 sm:mt-8 overflow-hidden rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 sm:p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start gap-3 sm:gap-3.5">
            <div className="flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-xs">
              <AlertTriangle className="size-5 sm:size-6 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <span className="rounded-md bg-amber-200 px-2 py-0.5 text-[10px] sm:text-[11px] font-bold tracking-wide uppercase text-amber-900">
                  Action Required
                </span>
                <h2 className="text-sm sm:text-base font-bold text-amber-950">
                  Verify your profile details & phone number
                </h2>
              </div>
              <p className="mt-1 text-xs sm:text-sm leading-relaxed text-amber-900">
                Your profile has been generated from your uploaded résumé and is{" "}
                <strong className="font-semibold text-amber-950">already live for recruiters</strong>.
                Please review your details below and verify your phone number so recruiters can
                reach out to you for interview calls.
              </p>
            </div>
          </div>
        </div>

        {/* Profile Snapshot Card */}
        <div className="mt-5 sm:mt-6 rounded-3xl border border-stone-200 bg-white/95 p-5 shadow-sm backdrop-blur-xs sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-100 pb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-10 sm:size-11 shrink-0 items-center justify-center rounded-2xl bg-stone-100 text-stone-700">
                <User className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm sm:text-base font-bold text-stone-900 truncate">
                  {summary.fullName || "Candidate"}
                </p>
                <p className="text-xs text-stone-500 truncate">{userEmail}</p>
              </div>
            </div>

            {summary.resumeFileName && (
              <div className="flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs text-stone-600 max-w-full">
                <FileText className="size-3.5 shrink-0 text-stone-500" />
                <span className="truncate max-w-[200px] sm:max-w-[220px]">
                  {summary.resumeFileName}
                </span>
              </div>
            )}
          </div>

          <div className="mt-5 space-y-4">
            {/* Headline */}
            {summary.headline && (
              <div className="flex items-start gap-3">
                <Briefcase className="mt-0.5 size-4 text-stone-400 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-stone-400">Target Role / Headline</p>
                  <p className="text-sm font-semibold text-stone-800">{summary.headline}</p>
                </div>
              </div>
            )}

            {/* Education */}
            {summary.education && (
              <div className="flex items-start gap-3">
                <GraduationCap className="mt-0.5 size-4 text-stone-400 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-stone-400">Education</p>
                  <p className="text-sm font-medium text-stone-800">
                    {summary.education.degree && (
                      <span className="font-semibold">{summary.education.degree}, </span>
                    )}
                    {summary.education.institutionName || "University"}
                    {summary.education.graduationYear && (
                      <span className="text-stone-500"> ({summary.education.graduationYear})</span>
                    )}
                  </p>
                </div>
              </div>
            )}

            {/* Phone */}
            <div className="flex items-start gap-3">
              <Phone className="mt-0.5 size-4 text-stone-400 shrink-0" />
              <div>
                <p className="text-xs font-medium text-stone-400">Phone Contact</p>
                <p className="text-sm font-medium text-stone-800">
                  {summary.phone ? (
                    <span className="inline-flex items-center gap-2">
                      <span>{summary.phone}</span>
                      {summary.phoneVerified ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                          <CheckCircle2 className="size-3" /> Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                          Verification pending
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-xs italic text-stone-400">
                      Not yet added — verify on /profile
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Extracted Skills */}
            {summary.skills.length > 0 && (
              <div className="pt-2">
                <p className="mb-2 text-xs font-medium text-stone-400">Extracted Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {summary.skills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-lg bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 sm:mt-8 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={loadingTarget !== null}
            onClick={() => handleAcknowledge("/dashboard")}
            className="h-11 sm:h-10 w-full sm:w-auto rounded-xl text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            {loadingTarget === "/dashboard" ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            Continue to Dashboard
          </Button>

          <Button
            type="button"
            disabled={loadingTarget !== null}
            onClick={() => handleAcknowledge("/profile")}
            className="h-11 sm:h-10 w-full sm:w-auto rounded-xl bg-stone-900 text-sm font-semibold text-white shadow-sm hover:bg-stone-800"
          >
            {loadingTarget === "/profile" ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 size-4" />
            )}
            Review & Verify Profile
          </Button>
        </div>

        {/* Footer / Privacy Note */}
        <div className="mt-8 text-center text-xs text-stone-500">
          <p className="flex items-center justify-center gap-1.5">
            <ShieldCheck className="size-4 text-stone-400" />
            <span>
              You have full control. You can update your skills, projects, or recruiter visibility anytime
              in{" "}
              <Link href="/profile" className="underline hover:text-stone-800">
                Profile Settings
              </Link>
              .
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
