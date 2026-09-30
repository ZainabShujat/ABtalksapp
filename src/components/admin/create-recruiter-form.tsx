"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Building2,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import {
  createRecruiterAction,
  type CreatedRecruiter,
} from "@/app/actions/admin-recruiter-actions";
import { LOGO_MIME_TYPES } from "@/lib/validations/recruiter-profile";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const LOGO_ACCEPT = LOGO_MIME_TYPES.join(",");
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_MAX_EDGE = 512;

/**
 * Fit inside a 512px box preserving aspect ratio, export PNG.
 *
 * Same treatment as the recruiter's own control in /hire/settings: no
 * centre-crop, because a logo is rarely square, and PNG rather than JPEG
 * because JPEG has no alpha and would sit a transparent logo on black.
 */
function fitPng(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, LOGO_MAX_EDGE / Math.max(img.width, img.height || 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not prepare the image."));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error("Could not prepare the image."));
        else resolve(blob);
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy. Select the text and copy it manually.");
        }
      }}
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "h-8 shrink-0 gap-1.5 px-2.5",
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * The credentials, shown once.
 *
 * This is the only place the plaintext password exists after the action
 * returns — it is never logged, persisted, audited or emailed. Closing this
 * panel loses it, which is why the copy is right here and the warning is
 * explicit.
 */
function CredentialsPanel({
  created,
  onDone,
}: {
  created: CreatedRecruiter;
  onDone: () => void;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div>
          <p className="font-medium text-foreground">Recruiter account created</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            This password is shown once. Copy it now and send it to the
            recruiter — it is not stored anywhere and cannot be shown again.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border bg-background px-3 py-2 font-mono text-sm">
            {created.email}
          </code>
          <CopyButton value={created.email} label="email" />
        </div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border bg-background px-3 py-2 font-mono text-sm">
            {created.password}
          </code>
          <CopyButton value={created.password} label="password" />
        </div>
      </div>

      {created.logoMessage && (
        <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>
            The account was created, but the logo was not attached:{" "}
            {created.logoMessage} The recruiter can set it in their own
            settings.
          </span>
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        They sign in at <span className="font-medium">/recruiter-onboarding/signin</span>{" "}
        with this email and password.
      </p>

      <button
        type="button"
        onClick={onDone}
        className={buttonVariants({ size: "sm" })}
      >
        Done
      </button>
    </div>
  );
}

/**
 * Create a recruiter from admin (plan 159).
 *
 * Client Component: owns the form state, the logo downscale and the one-time
 * credentials panel. `emailLoginEnabled` is resolved on the server and arrives
 * as a boolean.
 */
export function CreateRecruiterForm({
  emailLoginEnabled,
}: {
  emailLoginEnabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<CreatedRecruiter | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [location, setLocation] = useState("");
  const [passwordMode, setPasswordMode] = useState<"generate" | "manual">("generate");
  const [password, setPassword] = useState("");
  const [logo, setLogo] = useState<{ file: File; preview: string } | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFullName("");
    setEmail("");
    setPhone("");
    setCompanyName("");
    setWebsite("");
    setIndustry("");
    setCompanySize("");
    setLocation("");
    setPasswordMode("generate");
    setPassword("");
    if (logo) URL.revokeObjectURL(logo.preview);
    setLogo(null);
    setError(null);
    if (logoInputRef.current) logoInputRef.current.value = "";
  }

  async function onPickLogo(file: File | undefined) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (
      file.type === "image/svg+xml" ||
      name.endsWith(".svg") ||
      !(LOGO_MIME_TYPES as readonly string[]).includes(file.type)
    ) {
      toast.error("Please choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("That file is too large. Please choose an image under 2 MB.");
      return;
    }
    try {
      const blob = await fitPng(file);
      const prepared = new File([blob], "logo.png", { type: "image/png" });
      if (logo) URL.revokeObjectURL(logo.preview);
      setLogo({ file: prepared, preview: URL.createObjectURL(prepared) });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not read that image.",
      );
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const form = new FormData();
    form.set("fullName", fullName);
    form.set("email", email);
    form.set("phone", phone);
    form.set("companyName", companyName);
    form.set("website", website);
    form.set("industry", industry);
    form.set("companySize", companySize);
    form.set("location", location);
    form.set("passwordMode", passwordMode);
    if (passwordMode === "manual") form.set("password", password);
    if (logo) form.set("logo", logo.file);

    startTransition(async () => {
      const res = await createRecruiterAction(form);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setCreated(res.data);
      reset();
      router.refresh();
    });
  }

  if (created) {
    return (
      <CredentialsPanel
        created={created}
        onDone={() => {
          setCreated(null);
          setOpen(false);
        }}
      />
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
      >
        <UserPlus className="size-4" />
        Create recruiter
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6 rounded-xl border p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UserPlus className="size-4 text-muted-foreground" />
          <h3 className="font-medium">Create recruiter</h3>
        </div>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
        >
          <ChevronDown className="size-4" />
          Close
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {/* Recruiter */}
      <fieldset className="space-y-3" disabled={pending}>
        <legend className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Recruiter
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Full name" required>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Recruiter"
              required
            />
          </Field>
          <Field label="Work email" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@acme.com"
              required
            />
          </Field>
          <Field label="Phone">
            <Input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Consumer mailboxes (gmail, yahoo, outlook…) are refused on every path,
          including this one.
        </p>
      </fieldset>

      {/* Company */}
      <fieldset className="space-y-3" disabled={pending}>
        <legend className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Company
        </legend>

        <div className="flex items-start gap-4">
          <div className="flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted/50 p-2">
            {logo ? (
              // Blob/object URLs are not in next.config images.remotePatterns.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo.preview}
                alt=""
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <Building2 className="size-6 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Company logo</p>
            <p className="text-xs text-muted-foreground">
              PNG, JPEG or WebP · up to 2 MB. Optional — the recruiter can also
              set it themselves later.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "h-8 px-3",
                )}
              >
                {logo ? "Replace" : "Choose file"}
              </button>
              {logo && (
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(logo.preview);
                    setLogo(null);
                    if (logoInputRef.current) logoInputRef.current.value = "";
                  }}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "h-8 px-3 text-destructive hover:text-destructive",
                  )}
                >
                  Remove
                </button>
              )}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              className="sr-only"
              accept={LOGO_ACCEPT}
              onChange={(e) => void onPickLogo(e.target.files?.[0])}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name" required>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Technologies"
              required
            />
          </Field>
          <Field label="Website">
            <Input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="acme.com"
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Industry">
            <Input
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="FinTech"
            />
          </Field>
          <Field label="Company size">
            <Input
              value={companySize}
              onChange={(e) => setCompanySize(e.target.value)}
              placeholder="50-200"
            />
          </Field>
          <Field label="Location">
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Bengaluru, IN"
            />
          </Field>
        </div>
      </fieldset>

      {/* Access */}
      <fieldset className="space-y-3" disabled={pending}>
        <legend className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Access
        </legend>

        {!emailLoginEnabled && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            Password sign-in is switched off right now, so this recruiter will
            sign in with an emailed code instead.
          </p>
        )}

        <div className="flex flex-wrap gap-4">
          {(["generate", "manual"] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="passwordMode"
                value={mode}
                checked={passwordMode === mode}
                disabled={mode === "manual" && !emailLoginEnabled}
                onChange={() => setPasswordMode(mode)}
              />
              {mode === "generate" ? "Generate a password" : "Set a password"}
            </label>
          ))}
        </div>

        {passwordMode === "manual" ? (
          <Field label="Password" required>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="off"
              required
            />
          </Field>
        ) : (
          <p className="text-xs text-muted-foreground">
            A 20-character password is generated and shown to you once, right
            after the account is created.
          </p>
        )}
      </fieldset>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className={cn(buttonVariants({ size: "sm" }), "gap-2")}
        >
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creating…
            </>
          ) : (
            "Create recruiter"
          )}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="font-medium">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      {children}
    </label>
  );
}
