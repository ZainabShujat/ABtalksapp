"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Mail } from "lucide-react";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import {
  registerRecruiterWithOtpAction,
  requestRecruiterOtpAction,
} from "@/app/actions/recruiter-auth-actions";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { useTrack } from "@/lib/analytics/use-track";
import { PasswordInput } from "@/components/auth/password-input";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PASSWORD_MIN_LENGTH } from "@/lib/validations/email-auth";

/**
 * Recruiter registration, open to anyone.
 *
 * The email is verified by a code before anything is written, so a registration
 * always carries an address the ABTalks team can actually reach — which is the
 * whole point of the review step that follows. Phone is a contact detail, not a
 * credential, so it is optional and unverified.
 */
export function RecruiterRegisterForm({
  passwordEnabled = false,
}: {
  /** Plan 154: offer an optional password alongside the emailed code. */
  passwordEnabled?: boolean;
}) {
  const track = useTrack();
  const [step, setStep] = useState<"form" | "code">("form");
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [newsletterOptIn, setNewsletterOptIn] = useState(true);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSubmitForm =
    fullName.trim().length >= 2 &&
    company.trim().length >= 2 &&
    email.trim().length > 3 &&
    (!password || password.length >= PASSWORD_MIN_LENGTH) &&
    acceptedTerms;

  function sendCode() {
    startTransition(async () => {
      const res = await requestRecruiterOtpAction({
        email,
        intent: "register",
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setDevCode(res.data.devCode ?? null);
      setStep("code");
    });
  }

  function finish() {
    startTransition(async () => {
      const res = await registerRecruiterWithOtpAction({
        fullName,
        company,
        email,
        phone: phone || undefined,
        code,
        acceptedTerms: true,
        newsletterOptIn,
        ...(password ? { password } : {}),
      });
      if (!res.ok) {
        toast.error(res.message);
        setCode("");
        return;
      }
      track(ANALYTICS_EVENTS.recruiterRegSubmitted, { method: "otp" });
      const signin = await signIn("recruiter-otp", {
        email,
        code,
        redirect: false,
      });
      if (!signin || signin.error) {
        // Account exists; this code did not open a session. Sign-in can
        // issue a fresh one so they are not stranded.
        toast.error("Account created. Sign in with a new code.");
        window.location.href = `/talent/login?email=${encodeURIComponent(email)}`;
        return;
      }
      // Full navigation: the session cookie is new and every guard downstream
      // reads it server-side. An App Router transition that lands on a
      // server redirect leaves useTransition pending forever.
      window.location.href = "/hire";
    });
  }

  if (step === "code") {
    return (
      <div className="space-y-4 rounded-xl border bg-card p-5">
        <div className="space-y-1">
          <p className="text-sm">
            Verify <span className="font-medium">{email}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            We sent a 6-digit code. It expires in 10 minutes.
          </p>
        </div>

        {devCode && (
          <p className="rounded-lg border border-[#AA821D]/30 bg-[#AA821D]/10 px-3 py-2 text-xs text-[#AA821D] dark:text-[#FFEDB0]">
            <strong className="font-semibold">Development only.</strong> No mail
            provider is configured, so the code is shown here instead of
            emailed:{" "}
            <span className="font-mono text-sm font-bold tracking-widest">
              {devCode}
            </span>
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="reg-code">6-digit code</Label>
          <Input
            id="reg-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && code.length === 6) finish();
            }}
            placeholder="000000"
            disabled={pending}
            className="text-center font-mono text-lg tracking-[0.5em]"
          />
        </div>

        <button
          type="button"
          disabled={pending || code.length !== 6}
          onClick={finish}
          className={cn(
            buttonVariants({ size: "lg" }),
            "w-full gap-2 disabled:opacity-50",
          )}
        >
          {pending && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
          Complete registration
        </button>

        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setStep("form");
            setCode("");
            setDevCode(null);
          }}
          className="mx-auto block text-xs text-muted-foreground hover:text-foreground"
        >
          Change details
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="space-y-2">
        <Label htmlFor="reg-name">Full name</Label>
        <Input
          id="reg-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="reg-company">Company</Label>
        <Input
          id="reg-company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="reg-email">Work email</Label>
        <Input
          id="reg-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          placeholder="you@company.com"
        />
        <p className="text-xs text-muted-foreground">
          {passwordEnabled
            ? "We’ll send a code here to verify it. You can sign in later with an emailed code or the password below."
            : "We’ll send a code here to verify it. This is also how you sign in later — no password."}
        </p>
      </div>

      {passwordEnabled ? (
        <div className="space-y-2">
          <Label htmlFor="reg-password">Password (optional)</Label>
          <PasswordInput
            id="reg-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            aria-describedby="reg-password-hint"
          />
          <p id="reg-password-hint" className="text-xs text-muted-foreground">
            At least {PASSWORD_MIN_LENGTH} characters. Leave blank to sign in
            with emailed codes only.
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="reg-phone">Phone (optional)</Label>
        <Input
          id="reg-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={pending}
        />
      </div>

      <div className="space-y-2.5 rounded-lg border p-3">
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]"
          />
          <span>
            I agree to the{" "}
            <Link href="/terms" className="text-primary hover:underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={newsletterOptIn}
            onChange={(e) => setNewsletterOptIn(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]"
          />
          <span>
            Send me occasional updates about talent-pool access, cohort releases
            and recruiter product news.
          </span>
        </label>
      </div>

      <button
        type="button"
        disabled={pending || !canSubmitForm}
        onClick={sendCode}
        className={cn(
          buttonVariants({ size: "lg" }),
          "w-full gap-2 disabled:opacity-50",
        )}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Mail className="size-4" aria-hidden="true" />
        )}
        Verify email &amp; register
      </button>
    </div>
  );
}
