"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import {
  registerRecruiterWithOtpAction,
  requestRecruiterOtpAction,
} from "@/app/actions/recruiter-auth-actions";
import {
  getRecruiterProfileAction,
  updateRecruiterProfileAction,
} from "@/app/actions/recruiter-profile-actions";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { useTrack } from "@/lib/analytics/use-track";
import { useMotionMode, type Direction, type StepMotion } from "./motion";
import {
  EMPTY_DRAFT,
  clearDraft,
  hasCompanyExtras,
  readDraft,
  writeDraft,
  type OnboardingDraft,
  type StepId,
} from "./onboarding-draft";
import { OnboardingProgress } from "./onboarding-progress";
import { OnboardingShell } from "./onboarding-shell";
import { OnboardingStage, TEXT_LINK } from "./onboarding-step";
import { SupportingVisual, type VisualStage } from "./supporting-visual";
import { CompanyStep, COMPANY_FIELD_IDS, validateCompany } from "./steps/company-step";
import { CompleteStep } from "./steps/complete-step";
import { IdentityStep, IDENTITY_FIELD_IDS, validateIdentity } from "./steps/identity-step";
import { CodeStep, VerifyReviewStep } from "./steps/verify-step";
import { Field, INPUT_CLASS } from "./onboarding-fields";
import { PasswordInput } from "@/components/auth/password-input";
import { PASSWORD_MIN_LENGTH } from "@/lib/validations/email-auth";
import { WelcomeStep } from "./steps/welcome-step";

/*
 * Recruiter onboarding: one route, one card stack.
 *
 *   welcome → identity → company → verify → verify-code
 *     → [registerRecruiterWithOtpAction] → [signIn("recruiter-otp")]
 *     → ready → /hire
 *
 * The account rules are exactly the old sign-up screen's — the same two
 * server actions, the same analytics event, the same passwordless sign-in —
 * with the steps between them spread over cards. One emailed code both
 * proves the address and opens the session. A second sign-in code is only
 * requested if that sign-in fails after the account exists, or a saved
 * draft resumes with `registered: true` and no session.
 *
 * After sign-in, on "Start discovering talent", any optional company details
 * are saved through the settings action before /hire. That save happens on
 * the way out, not on arrival at the ready card: the action revalidates, and
 * a re-render of this route for a now-active recruiter redirects to /hire.
 */

const SCREENS = [
  "welcome",
  "identity",
  "company",
  "verify",
  "verify-code",
  "signin-code",
  "ready",
] as const;
type Screen = (typeof SCREENS)[number];

const STEP_OF: Record<Screen, StepId> = {
  welcome: "welcome",
  identity: "identity",
  company: "company",
  verify: "verify",
  "verify-code": "verify",
  "signin-code": "complete",
  ready: "complete",
};

const VISUAL_OF: Record<Screen, VisualStage> = {
  welcome: "welcome",
  identity: "identity",
  company: "company",
  verify: "verify",
  "verify-code": "verify",
  "signin-code": "account",
  ready: "complete",
};

const RESEND_COOLDOWN_S = 30;

function isScreen(id: StepId): id is StepId & Screen {
  return (SCREENS as readonly string[]).includes(id);
}

/** Where a saved draft resumes. An account that exists resumes at sign-in. */
function resumeScreen(draft: OnboardingDraft): Screen {
  if (draft.registered) return "signin-code";
  return isScreen(draft.step) ? draft.step : "verify";
}

function focusField(id: string) {
  window.requestAnimationFrame(() => document.getElementById(id)?.focus());
}

async function saveCompanyExtras(draft: OnboardingDraft): Promise<boolean> {
  try {
    // Read first: the stored company name may be a verified seat's rather than
    // what was typed, and the settings action rewrites the name it is given.
    const current = await getRecruiterProfileAction();
    if (!current.ok) return false;
    const saved = await updateRecruiterProfileAction({
      fullName: current.data.fullName,
      phone: current.data.phone,
      companyName: current.data.companyName,
      website: draft.website.trim() || current.data.website,
      industry: draft.industry || current.data.industry,
      companySize: draft.companySize || current.data.companySize,
      location: draft.companyLocation.trim() || current.data.location,
    });
    return saved.ok;
  } catch {
    return false;
  }
}

export function RecruiterOnboardingWizard({
  initialScreen = "welcome",
  passwordEnabled = false,
}: {
  /** /recruiter-onboarding/signup starts at the first question. */
  initialScreen?: "welcome" | "identity";
  /** Plan 154: offer an optional password on the code card. */
  passwordEnabled?: boolean;
}) {
  const track = useTrack();
  const motionMode = useMotionMode();
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState<OnboardingDraft>(() => ({
    ...EMPTY_DRAFT,
    step: initialScreen,
  }));
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [dir, setDir] = useState<Direction>(1);
  const [instant, setInstant] = useState(false);
  const [navigated, setNavigated] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // Consent is given in the session it counts for, so it is not restored.
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [code, setCode] = useState("");
  // Plan 154. Memory only: the draft goes to sessionStorage, a password never
  // does.
  const [password, setPassword] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [resendUntil, setResendUntil] = useState(0);
  const [now, setNow] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);

  // Declared before the restore effect on purpose: on mount this runs first,
  // while `persisting` is still false, so the empty draft never overwrites
  // the saved one.
  const persisting = useRef(false);
  useEffect(() => {
    if (persisting.current) writeDraft(draft);
  }, [draft]);

  useEffect(() => {
    const saved = readDraft();
    persisting.current = true;
    if (!saved) return;
    const target = resumeScreen(saved);
    // sessionStorage only exists in the browser, so the saved step can only
    // be applied after hydration — and it must not animate in.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft({ ...saved, step: STEP_OF[target] });
    if (target !== initialScreen) {
      setInstant(true);
      setScreen(target);
    }
    if (target === "signin-code" && saved.email.trim()) {
      void requestRecruiterOtpAction({
        email: saved.email.trim(),
        intent: "signin",
      }).then((issued) => {
        if (!issued.ok) {
          setCodeError(issued.message);
          return;
        }
        setDevCode(issued.data.devCode ?? null);
        startCooldown();
      });
    }
  }, [initialScreen]);

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

  function startCooldown() {
    const t = Date.now();
    setNow(t);
    setResendUntil(t + RESEND_COOLDOWN_S * 1000);
  }

  function update(patch: Partial<OnboardingDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function go(next: Screen, direction: Direction) {
    setDir(direction);
    setInstant(false);
    setNavigated(true);
    setShowErrors(false);
    setScreen(next);
    update({ step: STEP_OF[next] });
    // The next card starts at its heading: phones scroll the page, desktop
    // scrolls the form column (see OnboardingShell).
    if (window.matchMedia("(min-width: 1024px)").matches) {
      document.querySelector("[data-onboarding-scroll]")?.scrollTo({ top: 0, behavior: "instant" });
    } else {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }

  function submitIdentity() {
    const errors = validateIdentity(draft);
    const first = (Object.keys(errors) as (keyof typeof errors)[])[0];
    if (first) {
      setShowErrors(true);
      focusField(IDENTITY_FIELD_IDS[first]);
      return;
    }
    update({ fullName: draft.fullName.trim(), email: draft.email.trim() });
    go("company", 1);
  }

  function submitCompany() {
    const errors = validateCompany(draft);
    const first = (Object.keys(errors) as (keyof typeof errors)[])[0];
    if (first) {
      setShowErrors(true);
      focusField(COMPANY_FIELD_IDS[first]);
      return;
    }
    update({ company: draft.company.trim(), website: draft.website.trim() });
    go("verify", 1);
  }

  function sendRegisterCode() {
    // A restored draft or an Edit jump can reach Verify with an earlier step
    // no longer valid; send them back to it rather than to a server error.
    if (Object.keys(validateIdentity(draft)).length > 0) {
      go("identity", -1);
      setShowErrors(true);
      return;
    }
    if (Object.keys(validateCompany(draft)).length > 0) {
      go("company", -1);
      setShowErrors(true);
      return;
    }
    if (!acceptedTerms) {
      setShowErrors(true);
      return;
    }
    setServerError(null);
    setAlreadyRegistered(false);
    startTransition(async () => {
      const res = await requestRecruiterOtpAction({
        email: draft.email.trim(),
        intent: "register",
      });
      if (!res.ok) {
        setServerError(res.message);
        setAlreadyRegistered(/already registered/i.test(res.message));
        return;
      }
      setDevCode(res.data.devCode ?? null);
      setCode("");
      setCodeError(null);
      startCooldown();
      go("verify-code", 1);
    });
  }

  function resendCode(intent: "register" | "signin") {
    setCodeError(null);
    startTransition(async () => {
      const res = await requestRecruiterOtpAction({ email: draft.email.trim(), intent });
      if (!res.ok) {
        setCodeError(res.message);
        return;
      }
      setDevCode(res.data.devCode ?? null);
      setCode("");
      startCooldown();
    });
  }

  function register() {
    if (code.length !== 6) {
      setCodeError("Enter the 6-digit code.");
      return;
    }
    if (password && password.length < PASSWORD_MIN_LENGTH) {
      setCodeError(
        `Use at least ${PASSWORD_MIN_LENGTH} characters, or leave the password blank.`,
      );
      return;
    }
    setCodeError(null);
    startTransition(async () => {
      const res = await registerRecruiterWithOtpAction({
        fullName: draft.fullName,
        company: draft.company,
        email: draft.email,
        code,
        acceptedTerms: true,
        newsletterOptIn: draft.newsletterOptIn,
        ...(password ? { password } : {}),
      });
      if (!res.ok) {
        setCodeError(res.message);
        setCode("");
        return;
      }
      setPassword("");
      track(ANALYTICS_EVENTS.recruiterRegSubmitted, { method: "otp" });
      update({ registered: true });

      const signin = await signIn("recruiter-otp", {
        email: draft.email.trim(),
        code,
        redirect: false,
      });
      if (!signin || signin.error) {
        // Account exists; the register code did not open a session. Fall
        // back to a dedicated sign-in code so they are not stranded.
        setCode("");
        setDevCode(null);
        setResendUntil(0);
        go("signin-code", 1);
        const issued = await requestRecruiterOtpAction({
          email: draft.email.trim(),
          intent: "signin",
        });
        if (!issued.ok) {
          setCodeError(issued.message);
          return;
        }
        setDevCode(issued.data.devCode ?? null);
        startCooldown();
        return;
      }
      setCode("");
      setDevCode(null);
      go("ready", 1);
    });
  }

  function openWorkspace() {
    if (code.length !== 6) {
      setCodeError("Enter the 6-digit code.");
      return;
    }
    setCodeError(null);
    startTransition(async () => {
      const res = await signIn("recruiter-otp", {
        email: draft.email.trim(),
        code,
        redirect: false,
      });
      if (!res || res.error) {
        setCodeError("That code isn’t right, or it has expired.");
        setCode("");
        return;
      }
      setCode("");
      setDevCode(null);
      go("ready", 1);
    });
  }

  function finish() {
    startTransition(async () => {
      // Forget the draft before anything that can navigate away.
      persisting.current = false;
      clearDraft();
      if (hasCompanyExtras(draft) && !saveFailed) {
        const saved = await saveCompanyExtras(draft);
        if (!saved) {
          setSaveFailed(true);
          return;
        }
      }
      // Full navigation: the session cookie is new and every guard downstream
      // reads it server-side.
      window.location.href = "/hire";
    });
  }

  const stepMotion = useMemo<StepMotion>(
    // The first card uses a quiet fade for everyone: before hydration there is
    // no way to know whether this is a desktop.
    () => ({ dir, mode: navigated ? motionMode : "fade", instant }),
    [dir, motionMode, navigated, instant],
  );
  const focusHeading = navigated;
  const email = draft.email.trim();

  function renderScreen() {
    switch (screen) {
      case "welcome":
        return (
          <WelcomeStep
            key="welcome"
            motion={stepMotion}
            focusHeading={focusHeading}
            onStart={() => go("identity", 1)}
          />
        );
      case "identity":
        return (
          <IdentityStep
            key="identity"
            motion={stepMotion}
            focusHeading={focusHeading}
            draft={draft}
            showErrors={showErrors}
            onChange={update}
            onBack={() => go("welcome", -1)}
            onNext={submitIdentity}
          />
        );
      case "company":
        return (
          <CompanyStep
            key="company"
            motion={stepMotion}
            focusHeading={focusHeading}
            draft={draft}
            showErrors={showErrors}
            onChange={update}
            onBack={() => go("identity", -1)}
            onNext={submitCompany}
          />
        );
      case "verify":
        return (
          <VerifyReviewStep
            key="verify"
            motion={stepMotion}
            focusHeading={focusHeading}
            draft={draft}
            acceptedTerms={acceptedTerms}
            showErrors={showErrors}
            pending={pending}
            serverError={serverError}
            alreadyRegistered={alreadyRegistered}
            onTermsChange={setAcceptedTerms}
            onChange={update}
            onEdit={(step) => isScreen(step) && go(step, -1)}
            onBack={() => go("company", -1)}
            onSend={sendRegisterCode}
          />
        );
      case "verify-code":
        return (
          <CodeStep
            key="verify-code"
            codeId="ob-register-code"
            motion={stepMotion}
            focusHeading={focusHeading}
            eyebrow="Step 3 of 3 · Verify"
            title="Enter your code"
            lead="We sent a 6-digit code to"
            email={email}
            code={code}
            devCode={devCode}
            error={codeError}
            pending={pending}
            primaryLabel="Create workspace"
            resendIn={resendIn}
            onCodeChange={setCode}
            onResend={() => resendCode("register")}
            onBack={() => {
              setCode("");
              setPassword("");
              setDevCode(null);
              setCodeError(null);
              go("verify", -1);
            }}
            onSubmit={register}
          >
            {passwordEnabled ? (
              <Field
                id="ob-register-password"
                label="Password"
                optional
                hint={`Sign in with it next time instead of a code. At least ${PASSWORD_MIN_LENGTH} characters.`}
              >
                <PasswordInput
                  id="ob-register-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={pending}
                  className={INPUT_CLASS}
                  aria-describedby="ob-register-password-hint"
                />
              </Field>
            ) : null}
          </CodeStep>
        );
      case "signin-code":
        return (
          <CodeStep
            key="signin-code"
            codeId="ob-signin-code"
            motion={stepMotion}
            focusHeading={focusHeading}
            eyebrow="Account created"
            title="One more code opens your workspace"
            lead="Signing in always takes its own code. We sent it to"
            email={email}
            code={code}
            devCode={devCode}
            error={codeError}
            pending={pending}
            primaryLabel="Open workspace"
            resendIn={resendIn}
            onCodeChange={setCode}
            onResend={() => resendCode("signin")}
            onSubmit={openWorkspace}
          />
        );
      case "ready":
        return (
          <CompleteStep
            key="ready"
            motion={stepMotion}
            focusHeading={focusHeading}
            company={draft.company.trim()}
            pending={pending}
            saveFailed={saveFailed}
            onFinish={finish}
          />
        );
    }
  }

  const accountExists = draft.registered || screen === "signin-code" || screen === "ready";

  return (
    <OnboardingShell
      aside={
        accountExists ? null : (
          <p className="text-sm text-[#626262]">
            <span className="hidden sm:inline">Already have an account? </span>
            <Link href="/recruiter-onboarding/signin" className={TEXT_LINK}>
              Sign in
            </Link>
          </p>
        )
      }
      progress={
        <OnboardingProgress
          current={STEP_OF[screen]}
          onJump={
            accountExists || pending
              ? undefined
              : (id) => {
                  if (isScreen(id)) go(id, -1);
                }
          }
        />
      }
      visual={
        <SupportingVisual
          stage={VISUAL_OF[screen]}
          instant={instant}
          data={{
            fullName: draft.fullName,
            email: draft.email,
            company: draft.company,
            website: draft.website,
            industry: draft.industry,
            companySize: draft.companySize,
            companyLocation: draft.companyLocation,
          }}
        />
      }
    >
      <OnboardingStage motion={stepMotion}>{renderScreen()}</OnboardingStage>
    </OnboardingShell>
  );
}
