"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { verifyOtpAction } from "@/app/actions/otp-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  INDIA_DIALING_CODE,
  indianMobileNumberSchema,
  toE164,
  toWidgetMobile,
} from "@/lib/validations/phone";

/* MSG91 OTP widget globals (loaded from verify.msg91.com/otp-provider.js). */
type WidgetCallback = (data: unknown) => void;
declare global {
  interface Window {
    initSendOTP?: (config: {
      widgetId: string;
      tokenAuth: string;
      exposeMethods: boolean;
      success?: WidgetCallback;
      failure?: WidgetCallback;
    }) => void;
    sendOtp?: (
      identifier: string,
      success: WidgetCallback,
      failure: WidgetCallback,
    ) => void;
    verifyOtp?: (
      otp: string,
      success: WidgetCallback,
      failure: WidgetCallback,
    ) => void;
    retryOtp?: (
      channel: string | null,
      success: WidgetCallback,
      failure: WidgetCallback,
    ) => void;
  }
}

const WIDGET_ID = process.env.NEXT_PUBLIC_MSG91_WIDGET_ID;
const TOKEN_AUTH = process.env.NEXT_PUBLIC_MSG91_TOKEN_AUTH;
/** No widget configured on the client → run in dev-bypass mode (fixed code). */
const IS_BYPASS = !WIDGET_ID || !TOKEN_AUTH;

/** Curated dialing codes. India first (the only one that requires OTP). */
const COUNTRY_CODES: { code: string; label: string }[] = [
  { code: "+91", label: "🇮🇳 +91 India" },
  { code: "+1", label: "🇺🇸 +1 US/Canada" },
  { code: "+44", label: "🇬🇧 +44 UK" },
  { code: "+971", label: "🇦🇪 +971 UAE" },
  { code: "+65", label: "🇸🇬 +65 Singapore" },
  { code: "+61", label: "🇦🇺 +61 Australia" },
  { code: "+49", label: "🇩🇪 +49 Germany" },
  { code: "+880", label: "🇧🇩 +880 Bangladesh" },
  { code: "+977", label: "🇳🇵 +977 Nepal" },
  { code: "+94", label: "🇱🇰 +94 Sri Lanka" },
];

let widgetInitPromise: Promise<void> | null = null;
/** Fallback: MSG91 delivers the final verified token to the init `success` cb. */
let lastAccessToken: string | null = null;
function ensureWidget(): Promise<void> {
  if (widgetInitPromise) return widgetInitPromise;
  widgetInitPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined" || !WIDGET_ID || !TOKEN_AUTH) {
      reject(new Error("Widget not configured"));
      return;
    }
    const init = () => {
      if (typeof window.initSendOTP === "function") {
        // `success`/`failure` are REQUIRED by the widget or sendOtp throws
        // "success callback function missing".
        window.initSendOTP({
          widgetId: WIDGET_ID,
          tokenAuth: TOKEN_AUTH,
          exposeMethods: true,
          success: (data: unknown) => {
            const t = extractAccessToken(data);
            if (t) lastAccessToken = t;
          },
          failure: () => {},
        });
        resolve();
      } else {
        reject(new Error("Widget failed to initialize"));
      }
    };
    if (window.initSendOTP) {
      init();
      return;
    }
    const existing = document.getElementById(
      "msg91-otp-provider",
    ) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", init);
    script.addEventListener("error", () =>
      reject(new Error("Failed to load OTP widget")),
    );
    if (!existing) {
      script.id = "msg91-otp-provider";
      script.src = "https://verify.msg91.com/otp-provider.js";
      script.async = true;
      document.body.appendChild(script);
    }
  });
  return widgetInitPromise;
}

/** Poll until a widget global method is attached (initSendOTP attaches them). */
async function waitForFn(getFn: () => unknown, ms = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (typeof getFn() === "function") return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("MSG91 OTP method not available");
}

/**
 * Pull the access token out of the widget verify-success payload.
 * MSG91 versions return the JWT under different keys (or as a bare string),
 * so check the common shapes.
 */
function extractAccessToken(data: unknown): string | null {
  if (typeof data === "string") return data.trim() || null;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["message", "accessToken", "access-token", "access_token", "token", "jwt"]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

const RESEND_COOLDOWN_SECONDS = 30;

type Props = {
  defaultCountryCode?: string;
  defaultPhoneNumber?: string;
  onChange?: (v: {
    countryCode: string;
    phoneNumber: string;
    e164: string;
  }) => void;
  onVerifiedChange?: (verified: boolean) => void;
  /** Fires once when a real OTP verification succeeds (not for the non-India no-op). */
  onVerified?: (e164: string) => void;
  disabled?: boolean;
  /** When false (local next dev), OTP controls are hidden and the field is allowed to continue. */
  verificationRequired?: boolean;
};

export function PhoneVerifyField({
  defaultCountryCode = INDIA_DIALING_CODE,
  defaultPhoneNumber = "",
  onChange,
  onVerifiedChange,
  onVerified,
  disabled,
  verificationRequired = true,
}: Props) {
  const [countryCode, setCountryCode] = useState(defaultCountryCode);
  const [phoneNumber, setPhoneNumber] = useState(defaultPhoneNumber);
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"idle" | "sent" | "verified">("idle");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const isIndia = countryCode === INDIA_DIALING_CODE;

  // Keep the parent in sync with the current value.
  useEffect(() => {
    onChange?.({
      countryCode,
      phoneNumber,
      e164: toE164(countryCode, phoneNumber),
    });
  }, [countryCode, phoneNumber, onChange]);

  // Non-India numbers need no verification; report "verified" so gating passes.
  // When verification is not required (local next dev), always allow continue.
  useEffect(() => {
    if (!verificationRequired) {
      onVerifiedChange?.(true);
      return;
    }
    onVerifiedChange?.(!isIndia ? true : step === "verified");
  }, [isIndia, step, onVerifiedChange, verificationRequired]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const resetVerification = useCallback(() => {
    setStep("idle");
    setOtp("");
  }, []);

  function handleCountryChange(next: string | null) {
    if (next == null) return;
    setCountryCode(next);
    resetVerification();
  }

  function handleNumberChange(raw: string) {
    const cleaned = raw.replace(/[^\d]/g, "").slice(0, 15);
    setPhoneNumber(cleaned);
    if (step !== "idle") resetVerification();
  }

  const validMobile = indianMobileNumberSchema.safeParse(phoneNumber).success;

  async function handleSend() {
    if (!validMobile) {
      toast.error("Enter a valid 10-digit Indian mobile number");
      return;
    }
    setSending(true);
    try {
      if (IS_BYPASS) {
        setStep("sent");
        setCooldown(RESEND_COOLDOWN_SECONDS);
        toast.message("Dev mode — enter code 1234");
        return;
      }
      await ensureWidget();
      await waitForFn(() => window.sendOtp);
      const mobile = toWidgetMobile(toE164(countryCode, phoneNumber));
      await new Promise<void>((resolve, reject) => {
        window.sendOtp!(
          mobile,
          () => resolve(),
          (err) => reject(err),
        );
      });
      setStep("sent");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      toast.success("OTP sent to your phone");
    } catch (e) {
      console.error("[otp] sendOtp failed", e);
      toast.error("Could not send OTP. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0) return;
    if (IS_BYPASS) {
      setCooldown(RESEND_COOLDOWN_SECONDS);
      toast.message("Dev mode — enter code 1234");
      return;
    }
    try {
      await waitForFn(() => window.retryOtp);
      await new Promise<void>((resolve, reject) => {
        window.retryOtp!(
          null,
          () => resolve(),
          (err) => reject(err),
        );
      });
      setCooldown(RESEND_COOLDOWN_SECONDS);
      toast.success("OTP resent");
    } catch (e) {
      console.error("[otp] retryOtp failed", e);
      toast.error("Could not resend OTP.");
    }
  }

  async function handleVerify() {
    if (otp.length !== 4) {
      toast.error("Enter the 4-digit code");
      return;
    }
    setVerifying(true);
    try {
      let accessToken: string | undefined;
      if (!IS_BYPASS) {
        lastAccessToken = null;
        await waitForFn(() => window.verifyOtp);
        const token = await new Promise<string | null>((resolve, reject) => {
          window.verifyOtp!(
            otp,
            (data) => resolve(extractAccessToken(data) ?? lastAccessToken),
            (err) => reject(err),
          );
        });
        if (!token) {
          toast.error("Invalid code. Please try again.");
          return;
        }
        accessToken = token;
      }

      const res = await verifyOtpAction({
        countryCode,
        phoneNumber,
        ...(IS_BYPASS ? { otp } : { accessToken }),
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setStep("verified");
      toast.success("Phone number verified");
      onVerified?.(toE164(countryCode, phoneNumber));
    } catch (e) {
      console.error("[otp] verifyOtp failed", e);
      toast.error("Invalid code. Please try again.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="space-y-3">
      <Label htmlFor="phoneNumber">Phone Number</Label>
      <div className="flex gap-2">
        <Select
          value={countryCode}
          onValueChange={handleCountryChange}
          disabled={disabled || step === "verified"}
        >
          <SelectTrigger className="w-[7.5rem] shrink-0" aria-label="Country code">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COUNTRY_CODES.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          id="phoneNumber"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder={isIndia ? "9876543210" : "Phone number"}
          value={phoneNumber}
          onChange={(e) => handleNumberChange(e.target.value)}
          disabled={disabled || step === "verified"}
          className="flex-1"
        />
        {verificationRequired && isIndia && step !== "verified" ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleSend}
            disabled={disabled || sending || !validMobile}
            className="shrink-0"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : step === "sent" ? (
              "Resend"
            ) : (
              "Send OTP"
            )}
          </Button>
        ) : null}
      </div>

      {verificationRequired && isIndia && step === "verified" ? (
        <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-4" aria-hidden />
          Phone number verified
        </p>
      ) : null}

      {verificationRequired && isIndia && step === "sent" ? (
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
          <Label htmlFor="otp" className="text-sm">
            Enter the 4-digit code sent to {countryCode} {phoneNumber}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              placeholder="1234"
              value={otp}
              onChange={(e) =>
                setOtp(e.target.value.replace(/[^\d]/g, "").slice(0, 4))
              }
              className="w-28 text-center font-mono text-lg tracking-widest"
            />
            <Button
              type="button"
              onClick={handleVerify}
              disabled={verifying || otp.length !== 4}
            >
              {verifying ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                "Verify"
              )}
            </Button>
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0}
              className={cn(
                "text-sm text-muted-foreground underline-offset-4 hover:underline",
                cooldown > 0 && "cursor-not-allowed opacity-60",
              )}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </div>
        </div>
      ) : null}

      {!verificationRequired || !isIndia ? (
        <p className="text-xs text-muted-foreground">
          Optional. Visible to admins only.
        </p>
      ) : null}
    </div>
  );
}
