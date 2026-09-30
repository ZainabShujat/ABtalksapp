"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  requestPasswordCodeAction,
  setPasswordAction,
} from "@/app/actions/email-auth-actions";
import { PasswordInput } from "@/components/auth/password-input";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  PASSWORD_MIN_LENGTH,
  type AuthAudience,
} from "@/lib/validations/email-auth";

/**
 * Plan 154. Set or change a password.
 *
 * - Changing needs the current password, and signs every other device out;
 *   this one is signed straight back in with the new password.
 * - A first password needs a recent sign-in, or else an emailed code
 *   (`needsCode`, decided on the server from the session's sign-in time).
 */
export function PasswordSettingsForm({
  email,
  audience,
  hasPassword,
  googleOnly,
  needsCode,
}: {
  email: string;
  audience: AuthAudience;
  hasPassword: boolean;
  googleOnly: boolean;
  needsCode: boolean;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (googleOnly) {
    return (
      <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        This account signs in with Google only, so it can&apos;t have a
        password.
      </p>
    );
  }

  const codeRequired = !hasPassword && needsCode;
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canSubmit =
    newPassword.length >= PASSWORD_MIN_LENGTH &&
    confirmPassword === newPassword &&
    (!hasPassword || currentPassword.length > 0) &&
    (!codeRequired || code.length === 6);

  function sendCode() {
    startTransition(async () => {
      const res = await requestPasswordCodeAction();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setDevCode(res.data.devCode ?? null);
      setCodeSent(true);
      toast.success(`Code sent to ${email}.`);
    });
  }

  function submit() {
    startTransition(async () => {
      const res = await setPasswordAction({
        newPassword,
        ...(hasPassword ? { currentPassword } : {}),
        ...(codeRequired ? { code } : {}),
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (res.data.reauthenticate) {
        // Every session was just signed out, this one included. Open a fresh
        // one with the new password before anything reads the old cookie.
        const signin = await signIn("password", {
          email,
          password: newPassword,
          audience,
          redirect: false,
        });
        if (!signin || signin.error) {
          toast.success("Password changed. Sign in again with your new password.");
          window.location.assign(
            audience === "recruiter" ? "/talent/login" : "/login",
          );
          return;
        }
      }
      toast.success(hasPassword ? "Password changed." : "Password set.");
      window.location.reload();
    });
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) submit();
      }}
      className="flex flex-col gap-5 rounded-xl border bg-card p-5"
    >
      <p className="text-sm font-medium text-foreground">
        {hasPassword ? "Change your password" : "Set a password"}
      </p>

      {/* Lets password managers file the new password under the right account. */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />

      {hasPassword ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-current-password">Current password</Label>
          <PasswordInput
            id="settings-current-password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={pending}
          />
          <p className="text-xs text-muted-foreground">
            Forgot it? Sign out and use &ldquo;Forgot password?&rdquo; on the
            sign-in page.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-new-password">New password</Label>
        <PasswordInput
          id="settings-new-password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">
          At least {PASSWORD_MIN_LENGTH} characters.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-confirm-password">Confirm new password</Label>
        <PasswordInput
          id="settings-confirm-password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={pending}
          aria-invalid={mismatch || undefined}
        />
        {mismatch ? (
          <p role="alert" className="text-xs text-destructive">
            The passwords don&apos;t match.
          </p>
        ) : null}
      </div>

      {codeRequired ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm text-foreground">
            You signed in a while ago, so confirm it&apos;s you with a code sent
            to <span className="font-medium">{email}</span>.
          </p>
          {devCode ? (
            <p className="rounded-lg border border-[#AA821D]/30 bg-[#AA821D]/10 px-3 py-2 text-xs text-[#6B5212]">
              <strong className="font-semibold">Development only.</strong> Code:{" "}
              <span className="font-mono text-sm font-bold tracking-widest">
                {devCode}
              </span>
            </p>
          ) : null}
          {codeSent ? (
            <>
              <Label htmlFor="settings-code">6-digit code</Label>
              <Input
                id="settings-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                disabled={pending}
                className="text-center font-mono text-lg tracking-[0.5em]"
              />
            </>
          ) : null}
          <button
            type="button"
            onClick={sendCode}
            disabled={pending}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
          >
            {codeSent ? "Send a new code" : "Email me a code"}
          </button>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending || !canSubmit}
        className={cn(buttonVariants({ size: "lg" }), "h-11 w-full gap-2 disabled:opacity-50")}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {hasPassword ? "Change password" : "Set password"}
      </button>
    </form>
  );
}
