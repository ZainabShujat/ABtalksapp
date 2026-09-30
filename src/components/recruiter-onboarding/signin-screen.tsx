"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { requestRecruiterOtpAction } from "@/app/actions/recruiter-auth-actions";
import {
  requestEmailCodeAction,
  resetPasswordAction,
} from "@/app/actions/email-auth-actions";
import { PasswordInput } from "@/components/auth/password-input";
import {
  PASSWORD_MIN_LENGTH,
  signInErrorMessage,
} from "@/lib/validations/email-auth";
import { useMotionMode, type Direction, type StepMotion } from "./motion";
import {
  EMAIL_RE,
  Field,
  FieldError,
  INPUT_CLASS,
  fieldA11y,
} from "./onboarding-fields";
import { OnboardingShell } from "./onboarding-shell";
import {
  OnboardingNavigation,
  OnboardingStage,
  OnboardingStep,
  StaggerItem,
  TEXT_LINK,
} from "./onboarding-step";
import { CodeStep } from "./steps/verify-step";
import { EMPTY_VISUAL, SupportingVisual } from "./supporting-visual";

/*
 * Recruiter sign-in, in the onboarding's frame: cards in the same stack.
 *
 * The same flow as /talent/login: request a code for the email (the server
 * refuses an address with no registration), then sign in with the
 * `recruiter-otp` provider. Plan 154 adds, behind `passwordEnabled`, a
 * password card (the `password` provider, recruiter audience) and a
 * forgot-password card (emailed code + new password).
 *
 * Plan 166: password is the default when email login is on; the code flow
 * is the secondary option. With the flag off, authorizePassword refuses
 * everyone, so the code flow stays the entry point.
 */

type Screen = "email" | "code" | "password" | "reset";

export function SigninScreen({
  initialEmail = "",
  passwordEnabled = false,
}: {
  initialEmail?: string;
  passwordEnabled?: boolean;
}) {
  const motionMode = useMotionMode();
  // Password first (plan 166). Conditional, not absolute: with email login off
  // `authorizePassword` refuses everyone, so the code flow has to remain the
  // entry point or nobody can sign in at all.
  const entryScreen: Screen = passwordEnabled ? "password" : "email";
  const [screen, setScreen] = useState<Screen>(entryScreen);
  const [dir, setDir] = useState<Direction>(1);
  const [navigated, setNavigated] = useState(false);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [pending, startTransition] = useTransition();

  const emailError = EMAIL_RE.test(email.trim()) ? null : "Enter a valid work email address.";
  const stepMotion = useMemo<StepMotion>(
    () => ({ dir, mode: navigated ? motionMode : "fade" }),
    [dir, motionMode, navigated],
  );

  function go(next: Screen, direction: Direction) {
    setDir(direction);
    setNavigated(true);
    setScreen(next);
  }

  function goToCodeForm() {
    setPassword("");
    setError(null);
    go("email", 1);
  }

  function requestCode() {
    if (emailError) {
      setShowErrors(true);
      document.getElementById("si-email")?.focus();
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await requestRecruiterOtpAction({ email, intent: "signin" });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setDevCode(res.data.devCode ?? null);
      setCode("");
      go("code", 1);
    });
  }

  function submitCode() {
    if (code.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await signIn("recruiter-otp", { email, code, redirect: false });
      if (!res || res.error) {
        setError("That code isn’t right, or it has expired.");
        setCode("");
        return;
      }
      // Full navigation: the session cookie was just set and every guard
      // downstream reads it server-side. Straight to the desk — registering
      // provisions the workspace, so there is no setup or review step.
      window.location.href = "/hire";
    });
  }

  async function openWithPassword(secret: string): Promise<boolean> {
    const res = await signIn("password", {
      email: email.trim(),
      password: secret,
      audience: "recruiter",
      redirect: false,
    });
    if (!res || res.error) {
      setError(signInErrorMessage(res?.code, "password"));
      return false;
    }
    window.location.href = "/hire";
    return true;
  }

  function submitPassword() {
    if (emailError) {
      setShowErrors(true);
      document.getElementById("si-pw-email")?.focus();
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setError(null);
    startTransition(async () => {
      if (!(await openWithPassword(password))) setPassword("");
    });
  }

  function requestReset() {
    if (emailError) {
      setShowErrors(true);
      document.getElementById("si-pw-email")?.focus();
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await requestEmailCodeAction({
        email,
        purpose: "password-reset",
        audience: "recruiter",
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setDevCode(res.data.devCode ?? null);
      setCode("");
      setPassword("");
      if (screen !== "reset") go("reset", 1);
    });
  }

  function confirmReset() {
    if (code.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await resetPasswordAction({ email, code, newPassword: password });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      await openWithPassword(password);
    });
  }

  function passwordField(id: string, autoComplete: string, label: string) {
    return (
      <Field id={id} label={label}>
        <PasswordInput
          id={id}
          autoComplete={autoComplete}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
          className={INPUT_CLASS}
        />
      </Field>
    );
  }

  const codeInsteadLink = (
    <button
      type="button"
      onClick={goToCodeForm}
      disabled={pending}
      className={TEXT_LINK}
    >
      Email me a 6-digit code instead
    </button>
  );

  return (
    <OnboardingShell
      aside={
        <p className="text-sm text-[#626262]">
          <span className="hidden sm:inline">New to ABTalks Hire? </span>
          <Link href="/recruiter-onboarding" className={TEXT_LINK}>
            Create an account
          </Link>
        </p>
      }
      visual={
        <SupportingVisual stage="signin" data={{ ...EMPTY_VISUAL, email: email.trim() }} />
      }
    >
      <div className="lg:pt-[clamp(8px,6vh,72px)]">
        <OnboardingStage motion={stepMotion}>
          {screen === "email" ? (
            <OnboardingStep
              key="email"
              motion={stepMotion}
              focusHeading={navigated}
              eyebrow="ABTalks Hire"
              title="Welcome back"
              description={
                <p>
                  Pick up where you left off. Review candidates, track
                  conversations, and keep your hiring pipeline moving.
                </p>
              }
              onSubmit={requestCode}
              actions={
                <OnboardingNavigation
                  onBack={
                    entryScreen === "password"
                      ? () => {
                          setError(null);
                          go("password", -1);
                        }
                      : undefined
                  }
                  primaryLabel="Send code"
                  pending={pending}
                />
              }
              footer={
                <div className="space-y-2">
                  {passwordEnabled ? (
                    <p>
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          go("password", -1);
                        }}
                        disabled={pending}
                        className={TEXT_LINK}
                      >
                        Sign in with a password instead
                      </button>
                    </p>
                  ) : null}
                  <p>
                    Don’t have an account?{" "}
                    <Link href="/recruiter-onboarding/signup" className={TEXT_LINK}>
                      Sign up
                    </Link>
                  </p>
                </div>
              }
            >
              <StaggerItem>
                <Field
                  id="si-email"
                  label="Work email"
                  hint="We’ll email you a 6-digit code. No password needed."
                  error={showErrors ? emailError : null}
                  valid={!emailError}
                >
                  <input
                    id="si-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoFocus={entryScreen === "email"}
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={pending}
                    {...fieldA11y(
                      "si-email",
                      showErrors ? emailError : null,
                      "We’ll email you a 6-digit code. No password needed.",
                    )}
                    className={INPUT_CLASS}
                  />
                </Field>
                <FieldError message={error} />
              </StaggerItem>
            </OnboardingStep>
          ) : screen === "password" ? (
            <OnboardingStep
              key="password"
              motion={stepMotion}
              focusHeading={navigated}
              eyebrow="ABTalks Hire"
              title="Welcome back"
              description={
                <p>
                  Pick up where you left off. Review candidates, track
                  conversations, and keep your hiring pipeline moving.
                </p>
              }
              onSubmit={submitPassword}
              actions={
                <OnboardingNavigation
                  onBack={
                    entryScreen === "password"
                      ? undefined
                      : () => {
                          setPassword("");
                          setError(null);
                          go("email", -1);
                        }
                  }
                  primaryLabel="Sign in"
                  pending={pending}
                />
              }
              footer={
                <div className="space-y-2">
                  <p>{codeInsteadLink}</p>
                  <p>
                    Forgot it, or never set one?{" "}
                    <button
                      type="button"
                      onClick={requestReset}
                      disabled={pending}
                      className={TEXT_LINK}
                    >
                      Email me a code to set a password
                    </button>
                  </p>
                  <p>
                    Don’t have an account?{" "}
                    <Link href="/recruiter-onboarding/signup" className={TEXT_LINK}>
                      Sign up
                    </Link>
                  </p>
                </div>
              }
            >
              <StaggerItem className="space-y-4">
                <Field
                  id="si-pw-email"
                  label="Work email"
                  error={showErrors ? emailError : null}
                  valid={!emailError}
                >
                  <input
                    id="si-pw-email"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    autoFocus={entryScreen === "password"}
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={pending}
                    {...fieldA11y("si-pw-email", showErrors ? emailError : null)}
                    className={INPUT_CLASS}
                  />
                </Field>
                {passwordField("si-password", "current-password", "Password")}
                <FieldError message={error} />
                {/* Plan 166 §2b: after a failed password attempt, surface the
                    code route next to the generic error — affordance, not
                    disclosure of whether a password exists. */}
                {error ? <p className="text-sm">{codeInsteadLink}</p> : null}
              </StaggerItem>
            </OnboardingStep>
          ) : screen === "reset" ? (
            <CodeStep
              key="reset"
              codeId="si-reset-code"
              motion={stepMotion}
              focusHeading={navigated}
              eyebrow="Set a password"
              title="Check your email"
              lead="If this address has an account, we sent a 6-digit code to"
              email={email.trim()}
              code={code}
              devCode={devCode}
              error={error}
              pending={pending}
              primaryLabel="Save & sign in"
              resendIn={0}
              onCodeChange={setCode}
              onResend={requestReset}
              onBack={() => {
                setCode("");
                setPassword("");
                setDevCode(null);
                setError(null);
                go("password", -1);
              }}
              onSubmit={confirmReset}
            >
              {passwordField("si-new-password", "new-password", "New password")}
              <p className="mt-1.5 text-xs leading-5 text-[#787878]">
                At least {PASSWORD_MIN_LENGTH} characters.
              </p>
            </CodeStep>
          ) : (
            <CodeStep
              key="code"
              codeId="si-code"
              motion={stepMotion}
              focusHeading={navigated}
              eyebrow="Sign in"
              title="Check your email"
              lead="We sent a 6-digit code to"
              email={email.trim()}
              code={code}
              devCode={devCode}
              error={error}
              pending={pending}
              primaryLabel="Sign in"
              resendIn={0}
              onCodeChange={setCode}
              onResend={requestCode}
              onBack={() => {
                setCode("");
                setDevCode(null);
                setError(null);
                go(entryScreen === "password" ? "password" : "email", -1);
              }}
              onSubmit={submitCode}
            />
          )}
        </OnboardingStage>
      </div>
    </OnboardingShell>
  );
}
