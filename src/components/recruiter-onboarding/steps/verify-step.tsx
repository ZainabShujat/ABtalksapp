"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import type { StepMotion } from "../motion";
import type { OnboardingDraft, StepId } from "../onboarding-draft";
import {
  CheckRow,
  CodeInput,
  DevCodeNotice,
  FieldError,
} from "../onboarding-fields";
import {
  OnboardingNavigation,
  OnboardingStep,
  QUIET_BUTTON,
  StaggerItem,
  TEXT_LINK,
} from "../onboarding-step";

/*
 * Verify is two cards in the stack: a review (details, terms, newsletter →
 * send code) and the code itself (→ registerRecruiterWithOtpAction). "Change
 * details" goes back one card; the code is never kept.
 */

export const TERMS_MESSAGE = "Please accept the Terms and Privacy Policy.";

export function VerifyReviewStep({
  motion,
  focusHeading,
  draft,
  acceptedTerms,
  showErrors,
  pending,
  serverError,
  alreadyRegistered,
  onTermsChange,
  onChange,
  onEdit,
  onBack,
  onSend,
}: {
  motion: StepMotion;
  focusHeading: boolean;
  draft: OnboardingDraft;
  acceptedTerms: boolean;
  showErrors: boolean;
  pending: boolean;
  serverError: string | null;
  alreadyRegistered: boolean;
  onTermsChange: (accepted: boolean) => void;
  onChange: (patch: Partial<OnboardingDraft>) => void;
  onEdit: (step: StepId) => void;
  onBack: () => void;
  onSend: () => void;
}) {
  const company = [
    draft.company.trim(),
    draft.industry,
    draft.companySize && `${draft.companySize} people`,
    draft.companyLocation.trim(),
  ].filter(Boolean);

  return (
    <OnboardingStep
      motion={motion}
      focusHeading={focusHeading}
      eyebrow="Step 3 of 3 · Verify"
      title="Check your details"
      description={
        <p>
          Next we’ll email a 6-digit code to{" "}
          <span className="font-semibold text-[#161616]">{draft.email.trim()}</span>{" "}
          to verify it’s yours.
        </p>
      }
      onSubmit={onSend}
      actions={
        <OnboardingNavigation
          onBack={onBack}
          primaryLabel="Send code"
          pending={pending}
        />
      }
    >
      <StaggerItem>
        <dl className="divide-y divide-[#F0F0F0] rounded-[12px] border border-[#E9E9E9]">
          <SummaryRow
            label="You"
            lines={[draft.fullName.trim(), draft.email.trim()]}
            onEdit={() => onEdit("identity")}
            disabled={pending}
          />
          <SummaryRow
            label="Company"
            lines={[company.join(" · ")]}
            onEdit={() => onEdit("company")}
            disabled={pending}
          />
        </dl>
      </StaggerItem>

      <StaggerItem className="space-y-3">
        <CheckRow checked={acceptedTerms} onChange={onTermsChange} disabled={pending}>
          I agree to the{" "}
          <Link href="/terms" target="_blank" rel="noopener" className={TEXT_LINK}>
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" rel="noopener" className={TEXT_LINK}>
            Privacy Policy
          </Link>
          .
        </CheckRow>
        <FieldError message={showErrors && !acceptedTerms ? TERMS_MESSAGE : null} />
        <CheckRow
          checked={draft.newsletterOptIn}
          onChange={(newsletterOptIn) => onChange({ newsletterOptIn })}
          disabled={pending}
        >
          Send me occasional updates about talent-pool access and recruiter
          product news.
        </CheckRow>
      </StaggerItem>

      {serverError && (
        <StaggerItem>
          <FieldError message={serverError} />
          {alreadyRegistered && (
            <p className="mt-2 text-sm">
              <Link
                href={`/recruiter-onboarding/signin?email=${encodeURIComponent(draft.email.trim())}`}
                className={TEXT_LINK}
              >
                Sign in instead
              </Link>
            </p>
          )}
        </StaggerItem>
      )}
    </OnboardingStep>
  );
}

function SummaryRow({
  label,
  lines,
  empty,
  onEdit,
  disabled,
}: {
  label: string;
  lines: string[];
  empty?: string;
  onEdit: () => void;
  disabled: boolean;
}) {
  const visible = lines.filter((line) => line.trim().length > 0);
  return (
    <div className="flex items-start gap-4 px-4 py-3.5">
      <dt className="w-[72px] shrink-0 pt-px text-xs font-semibold uppercase tracking-[0.06em] text-[#8F8F8F]">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm leading-6 text-[#161616]">
        {visible.length > 0 ? (
          visible.map((line, index) => (
            <span key={`${label}-${index}`} className="block break-words">
              {line}
            </span>
          ))
        ) : (
          <span className="text-[#8F8F8F]">{empty}</span>
        )}
      </dd>
      <button
        type="button"
        onClick={onEdit}
        disabled={disabled}
        aria-label={`Edit ${label.toLowerCase()} details`}
        className="-my-1 -mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg text-[#626262] transition-colors hover:bg-[#EEF6F6] hover:text-[#03535F] focus-visible:outline-2 focus-visible:outline-[#03535F] disabled:opacity-50"
      >
        <Pencil className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

export function CodeStep({
  motion,
  focusHeading,
  codeId,
  eyebrow,
  title,
  email,
  lead,
  code,
  devCode,
  error,
  pending,
  primaryLabel,
  resendIn,
  onCodeChange,
  onResend,
  onBack,
  onSubmit,
  children,
}: {
  motion: StepMotion;
  focusHeading: boolean;
  /** Distinct per card: two code cards can share the stack mid-transition. */
  codeId: string;
  eyebrow: string;
  title: string;
  email: string;
  /** Sentence before the address, e.g. "We sent a 6-digit code to". */
  lead: string;
  code: string;
  devCode: string | null;
  error: string | null;
  pending: boolean;
  primaryLabel: string;
  /** Seconds until another code may be requested; 0 when it can be. */
  resendIn: number;
  onCodeChange: (code: string) => void;
  onResend: () => void;
  onBack?: () => void;
  onSubmit: () => void;
  /** Plan 154: fields below the code, e.g. a password. */
  children?: ReactNode;
}) {
  return (
    <OnboardingStep
      motion={motion}
      focusHeading={focusHeading}
      eyebrow={eyebrow}
      title={title}
      description={
        <p>
          {lead}{" "}
          <span className="font-semibold text-[#161616]">{email}</span>. It
          expires in 10 minutes.
        </p>
      }
      onSubmit={onSubmit}
      actions={
        <OnboardingNavigation onBack={onBack} primaryLabel={primaryLabel} pending={pending} />
      }
      footer={
        <p className="flex flex-wrap items-center gap-x-1">
          Didn’t get it? Check spam, or
          <button
            type="button"
            onClick={onResend}
            disabled={pending || resendIn > 0}
            className={`${QUIET_BUTTON} -mx-1 h-8 px-1 font-semibold text-[#03535F] disabled:text-[#8F8F8F] disabled:opacity-100`}
          >
            {resendIn > 0 ? `resend in ${resendIn}s` : "send a new code"}
          </button>
        </p>
      }
    >
      {devCode && (
        <StaggerItem>
          <DevCodeNotice code={devCode} />
        </StaggerItem>
      )}
      <StaggerItem>
        <CodeInput
          id={codeId}
          value={code}
          onChange={onCodeChange}
          disabled={pending}
          error={error}
        />
      </StaggerItem>
      {children ? <StaggerItem>{children}</StaggerItem> : null}
    </OnboardingStep>
  );
}
