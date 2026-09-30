"use client";

import { useEffect, useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { requestEmailCodeAction } from "@/app/actions/email-auth-actions";
import {
  PasswordSignIn,
  toastSignInError,
} from "@/components/auth/password-sign-in";
import {
  DEFAULT_LEGAL_CONSENT,
  LegalConsentFields,
  legalConsentAccepted,
  type LegalConsentValues,
} from "@/components/legal/legal-consent-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { HUB_BUTTON_CLASS } from "@/components/dashboard-hub/nav-items";
import { cn } from "@/lib/utils";

/** Cookie read by auth createUser so newsletter opt-out survives OAuth redirect. */
const NEWSLETTER_PREF_COOKIE = "abtalks_newsletter_pref";

function writeNewsletterPrefCookie(optIn: boolean) {
  // Short-lived: only needs to survive the OAuth round-trip.
  const maxAge = 60 * 15;
  document.cookie = `${NEWSLETTER_PREF_COOKIE}=${optIn ? "1" : "0"}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <path
        fill="#076573"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#27CA37"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#AA821D"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#D92D20"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function safeRedirectPath(from: string | undefined, fallback: string) {
  if (!from || !from.startsWith("/") || from.startsWith("//")) {
    return fallback;
  }
  return from;
}

/** Auth.js maps InvalidCheck / PKCE failures to error=Configuration. */
function messageForAuthError(error: string | undefined): string | null {
  if (!error) return null;
  switch (error) {
    case "OAuthAccountNotLinked":
      return "That Google account's email is already used by another ABTalks login. Sign in with the original method, or use a different Google account.";
    case "RecruiterAccount":
      return "That email belongs to a recruiter account. Sign in at ABTalks Hire instead.";
    case "AccessDenied":
      return "Sign-in was cancelled. Please try again.";
    case "Configuration":
    case "OAuthCallback":
    case "Callback":
    case "Default":
      return "Sign-in was interrupted. If you were switching accounts, sign out first, then try Google again.";
    default:
      return "Sign-in was interrupted. Please try again.";
  }
}

const RESEND_COOLDOWN_S = 30;

type LoginClientProps = {
  showGoogle: boolean;
  /** Plan 154: emailed code + password (ENABLE_EMAIL_LOGIN). */
  showEmail: boolean;
  redirectTo: string;
  /** Captured from ?ref= for future registration / OAuth (informational for now). */
  referralRef?: string;
  authError?: string;
};

export function LoginClient({
  showGoogle,
  showEmail,
  redirectTo,
  referralRef,
  authError,
}: LoginClientProps) {
  const [email, setEmail] = useState("");
  // Password first: signing in is the common case, and it is the one door
  // here that cannot create an account, so it needs no consent up front.
  const [method, setMethod] = useState<"code" | "password">("password");
  const [codeStep, setCodeStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendUntil, setResendUntil] = useState(0);
  const [now, setNow] = useState(0);
  const [pending, setPending] = useState(false);
  const [emailPending, startEmailTransition] = useTransition();
  const [legalConsent, setLegalConsent] =
    useState<LegalConsentValues>(DEFAULT_LEGAL_CONSENT);

  const target = safeRedirectPath(redirectTo, "/dashboard");
  // Candidates headed for the dashboard pass through the Welcome Back screen,
  // which forwards them on (see app/welcome/page.tsx).
  const afterSignIn = /^\/dashboard(?:[/?#]|$)/.test(target)
    ? `/welcome?next=${encodeURIComponent(target)}`
    : target;
  /**
   * Google (`events.createUser`) and an emailed code to an unknown address
   * (`createCandidateFromEmail`) both create the account, and both write the
   * consent record — so both wait for the box.
   *
   * A password never creates anything: `authorizePassword` only ever returns
   * an account that already exists, and records no consent. Gating it asked
   * someone to re-accept terms they agreed to at signup, and stored nothing
   * for the trouble.
   */
  const canSignIn = legalConsentAccepted(legalConsent);
  const authErrorMessage = messageForAuthError(authError);

  function ensureLegalAccepted(): boolean {
    if (legalConsentAccepted(legalConsent)) return true;
    toast.error("Please accept the Terms of Service and Privacy Policy.");
    return false;
  }

  async function handleGoogleSignIn() {
    if (!ensureLegalAccepted()) return;
    writeNewsletterPrefCookie(legalConsent.newsletterOptIn);
    setPending(true);
    try {
      await signIn("google", { callbackUrl: afterSignIn });
    } catch {
      toast.error("Could not start Google sign-in.");
      setPending(false);
    }
  }

  useEffect(() => {
    if (resendUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= resendUntil) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendUntil]);
  const resendIn = Math.max(0, Math.ceil((resendUntil - now) / 1000));

  /**
   * The emailed-code path only. Terms first, then the newsletter choice rides
   * along to account creation — a code to an unknown address makes the
   * account, so neither can be collected afterwards.
   */
  function beforeCredentialsSignIn(): boolean {
    if (!ensureLegalAccepted()) return false;
    writeNewsletterPrefCookie(legalConsent.newsletterOptIn);
    return true;
  }

  function requestCode() {
    // A code to an unknown address creates the account, so the Terms come
    // before the code, not after it.
    if (!beforeCredentialsSignIn()) return;
    startEmailTransition(async () => {
      const res = await requestEmailCodeAction({
        email,
        purpose: "candidate-login",
        audience: "candidate",
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setDevCode(res.data.devCode ?? null);
      setCode("");
      setCodeStep("code");
      const t = Date.now();
      setNow(t);
      setResendUntil(t + RESEND_COOLDOWN_S * 1000);
    });
  }

  function submitCode() {
    if (!beforeCredentialsSignIn()) return;
    startEmailTransition(async () => {
      const res = await signIn("email-code", {
        email: email.trim(),
        code,
        redirect: false,
      });
      if (!res || res.error) {
        toastSignInError(res?.code, "code", email);
        setCode("");
        return;
      }
      // Same-origin path, full navigation: see signInWithPassword.
      window.location.assign(afterSignIn);
    });
  }

  if (!showGoogle && !showEmail) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        No sign-in methods are configured for this environment.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {authErrorMessage ? (
        <p className="rounded-md border border-[#D92D20]/30 bg-[#D92D20]/5 px-3 py-2.5 text-sm text-foreground">
          {authErrorMessage}
        </p>
      ) : null}
      {referralRef ? (
        <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2.5">
          <p className="text-sm text-foreground">
            You were invited! You&apos;ll get credit for the referral after
            completing Day 7.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Enter referral code{" "}
            <span className="font-mono font-medium text-foreground">
              {referralRef}
            </span>{" "}
            when you complete registration (the link won&apos;t carry through
            sign-in).
          </p>
        </div>
      ) : null}

      {/* Standard order: auth controls first, legal checkboxes under them
          (every major app puts "I agree…" below the primary action). */}
      {showGoogle ? (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            className={cn(
              HUB_BUTTON_CLASS,
              "h-11 w-full gap-3 bg-white hover:bg-white dark:bg-white dark:text-black dark:hover:bg-white dark:hover:text-[#03535F]",
            )}
            disabled={pending || !canSignIn}
            onClick={handleGoogleSignIn}
          >
            <GoogleMark className="size-5 shrink-0" />
            Sign in with Google
          </Button>
        </div>
      ) : null}

      {showGoogle && showEmail ? (
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs font-medium text-muted-foreground">
            OR USE YOUR EMAIL
          </span>
          <Separator className="flex-1" />
        </div>
      ) : null}

      {showEmail ? (
        <div className="flex flex-col gap-4">
          <div
            role="radiogroup"
            aria-label="How to sign in with email"
            className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
          >
            {(
              [
                ["code", "Email code"],
                ["password", "Password"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={method === value}
                onClick={() => setMethod(value)}
                disabled={emailPending}
                className={cn(
                  "h-9 rounded-md text-sm font-medium transition-colors",
                  method === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {method === "password" ? (
            <PasswordSignIn
              audience="candidate"
              idPrefix="login"
              email={email}
              onEmailChange={setEmail}
              afterSignIn={afterSignIn}
              onUseEmailCode={() => {
                setMethod("code");
                setCodeStep("email");
              }}
            />
          ) : codeStep === "email" ? (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) requestCode();
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="login-code-email">Email</Label>
                <Input
                  id="login-code-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={emailPending}
                />
                <p className="text-xs text-muted-foreground">
                  We&apos;ll email you a 6-digit code. New here? The code
                  creates your account.
                </p>
              </div>
              <button
                type="submit"
                disabled={emailPending || !canSignIn || !email.trim()}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-11 w-full gap-2 disabled:opacity-50",
                )}
              >
                {emailPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Mail className="size-4" aria-hidden="true" />
                )}
                Email me a code
              </button>
            </form>
          ) : (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === 6) submitCode();
              }}
              className="flex flex-col gap-4"
            >
              <p className="text-sm text-foreground">
                Code sent to <span className="font-medium">{email.trim()}</span>.
                It expires in 10 minutes.
              </p>
              {devCode ? (
                <p className="rounded-lg border border-[#AA821D]/30 bg-[#AA821D]/10 px-3 py-2 text-xs text-[#6B5212]">
                  <strong className="font-semibold">Development only.</strong>{" "}
                  No mail provider is configured, so the code is shown here:{" "}
                  <span className="font-mono text-sm font-bold tracking-widest">
                    {devCode}
                  </span>
                </p>
              ) : null}
              <div className="flex flex-col gap-2">
                <Label htmlFor="login-code">6-digit code</Label>
                <Input
                  id="login-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  disabled={emailPending}
                  className="text-center font-mono text-lg tracking-[0.5em]"
                />
              </div>
              <button
                type="submit"
                disabled={emailPending || !canSignIn || code.length !== 6}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-11 w-full gap-2 disabled:opacity-50",
                )}
              >
                {emailPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Sign in
              </button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setCodeStep("email");
                    setCode("");
                    setDevCode(null);
                  }}
                  disabled={emailPending}
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="size-3" aria-hidden="true" />
                  Use a different email
                </button>
                <button
                  type="button"
                  onClick={requestCode}
                  disabled={emailPending || resendIn > 0}
                  className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:no-underline disabled:opacity-60"
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : "Send a new code"}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : null}

      <LegalConsentFields
        values={legalConsent}
        onChange={setLegalConsent}
      />
      {!canSignIn ? (
        <p className="text-center text-xs text-muted-foreground">
          {method === "password"
            ? "Signing in with a password needs no acceptance. Google and emailed codes do — either one creates your account if you're new."
            : "Accept the Terms of Service and Privacy Policy to enable Sign in."}
        </p>
      ) : null}
    </div>
  );
}
