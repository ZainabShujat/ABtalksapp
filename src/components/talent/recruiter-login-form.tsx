"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { requestRecruiterOtpAction } from "@/app/actions/recruiter-auth-actions";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * One email box.
 *
 * The recruiter never has to know whether they already have an account — the
 * server does, and both answers look the same from here. Only "we haven't
 * verified this company" is different, because that is the one case where they
 * need to do something about it.
 */
export function RecruiterLoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function requestCode() {
    startTransition(async () => {
      const res = await requestRecruiterOtpAction({ email, intent: "signin" });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setDevCode(res.data.devCode ?? null);
      setStep("code");
    });
  }

  function submitCode() {
    startTransition(async () => {
      const res = await signIn("recruiter-otp", {
        email,
        code,
        redirect: false,
      });
      if (!res || res.error) {
        toast.error("That code isn't right, or it has expired.");
        setCode("");
        return;
      }
      // A full navigation, not router.push: the session cookie has just been
      // set and every guard downstream reads it server-side.
      window.location.href = redirectTo;
    });
  }

  if (step === "email") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="recruiter-email" className="text-sm font-medium">
            Work email
          </label>
          <Input
            id="recruiter-email"
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && email.trim()) requestCode();
            }}
            placeholder="you@company.com"
            disabled={pending}
          />
          <p className="text-xs text-muted-foreground">
            We&apos;ll email you a 6-digit code. No password, no Google account.
          </p>
        </div>

        <button
          type="button"
          disabled={pending || !email.trim()}
          onClick={requestCode}
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
          Continue
        </button>

        <p className="text-center text-xs text-muted-foreground">
          Only for recruiters we have already verified.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm">
          Code sent to <span className="font-medium">{email}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          The code expires in 10 minutes.
        </p>
      </div>

      {devCode && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          <strong className="font-semibold">Development only.</strong> No mail
          provider is configured, so the code is shown here instead of emailed:{" "}
          <span className="font-mono text-sm font-bold tracking-widest">
            {devCode}
          </span>
        </p>
      )}

      <div className="space-y-2">
        <label htmlFor="recruiter-code" className="text-sm font-medium">
          6-digit code
        </label>
        <Input
          id="recruiter-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.length === 6) submitCode();
          }}
          placeholder="000000"
          disabled={pending}
          className="text-center font-mono text-lg tracking-[0.5em]"
        />
      </div>

      <button
        type="button"
        disabled={pending || code.length !== 6}
        onClick={submitCode}
        className={cn(
          buttonVariants({ size: "lg" }),
          "w-full gap-2 disabled:opacity-50",
        )}
      >
        {pending && (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        )}
        Sign in
      </button>

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setStep("email");
          setCode("");
          setDevCode(null);
          router.refresh();
        }}
        className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" aria-hidden="true" />
        Use a different email
      </button>
    </div>
  );
}
