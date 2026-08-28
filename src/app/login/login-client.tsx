"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import {
  DEFAULT_LEGAL_CONSENT,
  LegalConsentFields,
  legalConsentAccepted,
  type LegalConsentValues,
} from "@/components/legal/legal-consent-fields";
import { Button } from "@/components/ui/button";
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
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
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

type LoginClientProps = {
  showGoogle: boolean;
  showDev: boolean;
  redirectTo: string;
  /** Captured from ?ref= for future registration / OAuth (informational for now). */
  referralRef?: string;
};

export function LoginClient({
  showGoogle,
  showDev,
  redirectTo,
  referralRef,
}: LoginClientProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [legalConsent, setLegalConsent] =
    useState<LegalConsentValues>(DEFAULT_LEGAL_CONSENT);

  const target = safeRedirectPath(redirectTo, "/dashboard");
  const canSignIn = legalConsentAccepted(legalConsent);

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
      await signIn("google", { callbackUrl: target });
    } catch {
      toast.error("Could not start Google sign-in.");
      setPending(false);
    }
  }

  async function handleCredentialsSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (!ensureLegalAccepted()) return;
    writeNewsletterPrefCookie(legalConsent.newsletterOptIn);
    setPending(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        // Relative path only — Auth.js may rewrite absolute URLs using AUTH_URL
        // (often localhost), which breaks login when the app is opened via a LAN IP.
        callbackUrl: target,
      });
      if (result?.error) {
        toast.error(
          result.error === "CredentialsSignin"
            ? "Invalid email or password."
            : `Sign-in failed (${result.error}). If you're on a phone/LAN URL, unset AUTH_URL or set it to this host.`,
        );
        setPending(false);
        return;
      }
      // Always stay on the origin the user opened (LAN IP vs localhost).
      // Do not follow result.url — it often points at AUTH_URL's host.
      window.location.assign(target);
    } catch {
      toast.error("Something went wrong. Try again.");
      setPending(false);
    }
  }

  if (!showGoogle && !showDev) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        No sign-in methods are configured for this environment.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
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
            Google sign-in).
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
              "h-11 w-full gap-3 bg-white hover:bg-white dark:bg-white dark:text-black dark:hover:bg-white dark:hover:text-[#E05226]",
            )}
            disabled={pending || !canSignIn}
            onClick={handleGoogleSignIn}
          >
            <GoogleMark className="size-5 shrink-0" />
            Sign in with Google
          </Button>
        </div>
      ) : null}

      {showGoogle && showDev ? (
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs font-medium text-muted-foreground">OR</span>
          <Separator className="flex-1" />
        </div>
      ) : null}

      {showDev ? (
        <form
          method="post"
          action="#"
          onSubmit={handleCredentialsSignIn}
          className="flex flex-col gap-4"
        >
          {referralRef ? (
            <input type="hidden" name="ref" value={referralRef} readOnly />
          ) : null}
          <p className="text-sm font-medium text-foreground">Dev Login</p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="dev-email">Email</Label>
            <Input
              id="dev-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={pending}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="dev-password">Password</Label>
            <Input
              id="dev-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={pending}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            className={cn(
              HUB_BUTTON_CLASS,
              "h-11 w-full bg-white hover:bg-white dark:bg-white dark:text-black dark:hover:bg-white dark:hover:text-[#E05226]",
            )}
            disabled={pending || !canSignIn}
          >
            Sign in
          </Button>
          <p className="text-xs text-muted-foreground">
            Dev mode: use test accounts from seed script
          </p>
        </form>
      ) : null}

      <LegalConsentFields
        values={legalConsent}
        onChange={setLegalConsent}
      />
      {!canSignIn ? (
        <p className="text-center text-xs text-muted-foreground">
          Accept the Terms of Service and Privacy Policy to enable Sign in.
        </p>
      ) : null}
    </div>
  );
}
