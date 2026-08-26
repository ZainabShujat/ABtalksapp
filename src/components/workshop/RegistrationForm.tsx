"use client";

import { useMemo, useState, useTransition } from "react";
import { submitWorkshopRegistrationAction } from "@/app/actions/workshop-actions";
import {
  LegalConsentFields,
  legalConsentAccepted,
  type LegalConsentValues,
} from "@/components/legal/legal-consent-fields";

/** Palette oranges + the cream tints, so the burst stays in-system. */
const CONFETTI_COLORS = ["#e05226", "#c9411c", "#a93617", "#ffece3", "#fff1e9", "#353535"];

function buildConfetti() {
  return Array.from({ length: 44 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    bg: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 6 + Math.random() * 7,
    delay: Math.random() * 0.5,
    duration: 2.2 + Math.random() * 1.8,
    drift: (Math.random() - 0.5) * 220,
    rotate: Math.random() * 720,
    round: Math.random() > 0.6,
  }));
}

interface FormData {
  name: string;
  email: string;
  phone: string;
  countryCode: string;
  role: string;
  organization: string;
  graduationYear: string;
}

// Matches lib/validations/register.ts + profile.ts so a write-through to
// StudentProfile can never produce a year those schemas would reject.
const GRAD_YEARS = Array.from({ length: 16 }, (_, i) => 2020 + i);

/** Stored phone is "+91XXXXXXXXXX"; split it back for the two inputs. */
function splitPhone(stored: string | null): { code: string; rest: string } {
  if (!stored) return { code: "+91", rest: "" };
  const m = /^(\+\d{1,4})(\d+)$/.exec(stored.trim());
  if (m) return { code: m[1]!, rest: m[2]! };
  return { code: "+91", rest: stored.replace(/[^0-9]/g, "") };
}

interface Errors {
  name?: string;
  phone?: string;
  role?: string;
}

interface RegistrationFormProps {
  whatsappLink: string;
  isSignedIn: boolean;
  sessionEmail: string | null;
  sessionName: string | null;
  registrationOpen: boolean;
  alreadyRegistered: boolean;
  prefillName: string | null;
  prefillPhone: string | null;
  prefillOrganization: string | null;
  prefillGraduationYear: number | null;
  prefillRole: "Student" | "Professional" | null;
  isExistingMember: boolean;
}

const FALLBACK_WHATSAPP =
  "https://chat.whatsapp.com/LDUvHRIlb5dGHpDJLueR9i?s=cl&p=a&mlu=0&amv=0";

/**
 * National-number length for dial codes where it is fixed. India is always 10
 * digits, so the field caps input there and rejects anything shorter — other
 * countries vary, and fall back to a 7-15 range rather than a wrong hard rule.
 */
const PHONE_EXACT_LEN: Record<string, number> = {
  "+91": 10,
};

export default function RegistrationForm({
  whatsappLink,
  isSignedIn,
  sessionEmail,
  sessionName,
  registrationOpen,
  alreadyRegistered,
  prefillName,
  prefillPhone,
  prefillOrganization,
  prefillGraduationYear,
  prefillRole,
  isExistingMember,
}: RegistrationFormProps) {
  const initialPhone = splitPhone(prefillPhone);
  const [form, setForm] = useState<FormData>({
    // Known profile data wins over the Google display name.
    name: prefillName ?? sessionName ?? "",
    email: sessionEmail ?? "",
    phone: initialPhone.rest,
    countryCode: initialPhone.code,
    role: prefillRole ?? "",
    organization: prefillOrganization ?? "",
    graduationYear: prefillGraduationYear ? String(prefillGraduationYear) : "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [isPending, startTransition] = useTransition();
  const [apiError, setApiError] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [redirectCountdown, setRedirectCountdown] = useState(3);
  const [legalConsent, setLegalConsent] = useState<LegalConsentValues>({
    acceptLegal: false,
    newsletterOptIn: true,
  });
  const confetti = useMemo(buildConfetti, []);

  const set = (field: keyof FormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // Email is no longer user input — the server takes it from the session — so it
  // is not validated here.
  const validate = (): boolean => {
    const e: Errors = {};
    if (!form.name.trim()) e.name = "Full name is required";

    const digits = form.phone.replace(/\D/g, "");
    const exact = PHONE_EXACT_LEN[form.countryCode];
    if (!digits) e.phone = "Phone number is required";
    else if (exact ? digits.length !== exact : !/^\d{7,15}$/.test(digits))
      e.phone = exact
        ? `Enter your ${exact}-digit number`
        : "Please enter a valid phone number";
    if (!form.role) e.role = "Please select an option";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const startRedirect = () => {
    setShowSuccess(true);
    let count = 3;
    const interval = setInterval(() => {
      count -= 1;
      setRedirectCountdown(count);
      if (count <= 0) {
        clearInterval(interval);
        window.location.href = whatsappLink || FALLBACK_WHATSAPP;
      }
    }, 1000);
  };

  // Precedence matters: an already-registered user should see confirmation even
  // once the event closes, and the sign-in CTA is pointless if nothing is open.
  const state: "registered" | "closed" | "signedOut" | "form" = alreadyRegistered
    ? "registered"
    : !registrationOpen
      ? "closed"
      : !isSignedIn
        ? "signedOut"
        : "form";

  const heading =
    state === "registered"
      ? "You're registered"
      : state === "closed"
        ? "Registration closed"
        : "Reserve your seat";

  const subheading =
    state === "registered"
      ? "See you at the workshop — we've emailed your joining details."
      : state === "closed"
        ? "Registration isn't open right now."
        : state === "signedOut"
          ? "Sign in to confirm your seat · takes less than 30 seconds"
          : "Limited spots · takes less than 30 seconds";

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    if (!legalConsentAccepted(legalConsent)) {
      setApiError("Please accept the Terms of Service and Privacy Policy.");
      return;
    }
    setApiError("");
    startTransition(async () => {
      try {
        const result = await submitWorkshopRegistrationAction({
          name: form.name.trim(),
          phone: `${form.countryCode}${form.phone.trim()}`,
          role: form.role === "Professional" ? "Professional" : "Student",
          organization: form.organization.trim() || null,
          graduationYear: form.graduationYear ? Number(form.graduationYear) : null,
          acceptLegal: legalConsent.acceptLegal,
          newsletterOptIn: legalConsent.newsletterOptIn,
        });
        if (!result.ok) {
          setApiError(result.message);
          return;
        }
        startRedirect();
      } catch {
        setApiError("Network error. Please check your connection and try again.");
      }
    });
  };

  return (
    <>
      <style>{`
        .wk-input {
          width: 100%;
          padding: 13px 16px;
          border-radius: 12px;
          background: var(--wk-surface);
          border: 1px solid var(--wk-card-border);
          color: var(--wk-text);
          font-size: 15px;
          font-weight: 500;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
        }
        .wk-input::placeholder { color: var(--wk-placeholder); font-weight: 400; }
        .wk-input:focus {
          border-color: rgba(var(--wk-a1-rgb),0.55);
          background: var(--wk-surface);
          box-shadow: 0 0 0 3px rgba(var(--wk-a1-rgb),0.18);
        }
        .wk-input.err { border-color: rgba(248,113,113,0.6); }
        .wk-input.err:focus { box-shadow: 0 0 0 3px rgba(248,113,113,0.14); }
        .wk-select option { background: var(--wk-surface); color: var(--wk-text); }

        .register-btn {
          background: var(--wk-grad);
          box-shadow: 0 8px 28px -8px rgba(var(--wk-a1-rgb),0.42), inset 0 1px 0 rgba(255,255,255,0.25);
          transition: transform 0.18s ease, filter 0.18s ease, box-shadow 0.18s ease;
        }
        .register-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: brightness(1.07);
          box-shadow: 0 14px 36px -8px rgba(var(--wk-a1-rgb),0.52), inset 0 1px 0 rgba(255,255,255,0.3);
        }
        .register-btn:active:not(:disabled) { transform: translateY(0); }
        .register-btn:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>

      <form onSubmit={handleSubmit} className="mx-auto w-full max-w-xl px-4">
        <div
          className="relative overflow-hidden rounded-3xl p-6 sm:p-9"
          style={{
            background: "var(--wk-surface)",
            border: "1px solid var(--wk-card-border)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "var(--wk-shadow-lg), inset 0 1px 0 var(--wk-inset-hi)",
          }}
        >
          {/* top accent line */}
          <div
            className="absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(to right, transparent, rgba(var(--wk-a1-rgb),0.7), rgba(var(--wk-a1-rgb),0.52), transparent)",
            }}
          />

          <div className="mb-6 text-center">
            <h2 className="wk-t mt-3 text-2xl font-bold tracking-tight sm:text-[26px]">
              {heading}
            </h2>
            <p className="wk-dim mt-1.5 text-sm">{subheading}</p>
          </div>

          {state === "registered" && (
            <div className="text-center">
              <a
                href={whatsappLink || FALLBACK_WHATSAPP}
                target="_blank"
                rel="noopener noreferrer"
                className="register-btn inline-block w-full cursor-pointer rounded-full py-3.5 text-base font-semibold text-white"
              >
                Join the WhatsApp group
              </a>
              <p className="wk-faint mt-3.5 text-xs">
                Your webinar details are in your inbox — check Spam or Promotions if
                you don&apos;t see them.
              </p>
            </div>
          )}

          {state === "closed" && (
            <p className="wk-dim text-center text-sm leading-relaxed">
              There&apos;s no workshop open for registration at the moment. The next
              one will be announced here and on our WhatsApp community.
            </p>
          )}

          {state === "signedOut" && (
            <div className="text-center">
              <a
                href="/login?from=%2Fai-workshop%23register"
                className="register-btn inline-block w-full cursor-pointer rounded-full py-3.5 text-base font-semibold text-white"
              >
                Continue with Google to reserve your seat
              </a>
              <p className="wk-faint mt-3.5 text-xs">
                Takes a few seconds — we use it to confirm your seat.
              </p>
            </div>
          )}

          {state === "form" && (
          <div className="space-y-4">
            <Field label="Full Name" required error={errors.name}>
              <input
                type="text"
                placeholder="Enter your full name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                className={`wk-input ${errors.name ? "err" : ""}`}
              />
            </Field>

            <Field label="Email Address">
              <input
                type="email"
                value={sessionEmail ?? ""}
                readOnly
                disabled
                className="wk-input cursor-not-allowed opacity-60"
              />
              <p className="wk-faint mt-1.5 text-xs">
                Signed in as {sessionEmail} — your seat is confirmed to this address.
              </p>
            </Field>

            <Field label="Phone Number" required error={errors.phone}>
              <div className="flex gap-2">
                <select
                  value={form.countryCode}
                  onChange={(e) => {
                    // Trim on switch: +1 allows 15 digits, +91 only 10, so a
                    // number typed under the looser code would otherwise stay
                    // over-long and fail validation with no visible cause.
                    const code = e.target.value;
                    const cap = PHONE_EXACT_LEN[code] ?? 15;
                    setForm((prev) => ({
                      ...prev,
                      countryCode: code,
                      phone: prev.phone.slice(0, cap),
                    }));
                  }}
                  className="wk-input wk-select shrink-0 cursor-pointer"
                  style={{ width: "104px", paddingRight: "8px" }}
                >
                  <option value="+91">🇮🇳 +91</option>
                  <option value="+1">🇺🇸 +1</option>
                  <option value="+44">🇬🇧 +44</option>
                  <option value="+971">🇦🇪 +971</option>
                  <option value="+966">🇸🇦 +966</option>
                  <option value="+65">🇸🇬 +65</option>
                  <option value="+60">🇲🇾 +60</option>
                  <option value="+92">🇵🇰 +92</option>
                  <option value="+880">🇧🇩 +880</option>
                  <option value="+977">🇳🇵 +977</option>
                  <option value="+94">🇱🇰 +94</option>
                  <option value="+61">🇦🇺 +61</option>
                  <option value="+64">🇳🇿 +64</option>
                  <option value="+33">🇫🇷 +33</option>
                  <option value="+49">🇩🇪 +49</option>
                  <option value="+27">🇿🇦 +27</option>
                  <option value="+234">🇳🇬 +234</option>
                  <option value="+55">🇧🇷 +55</option>
                  <option value="+353">🇮🇪 +353</option>
                  <option value="+86">🇨🇳 +86</option>
                  <option value="+82">🇰🇷 +82</option>
                  <option value="+62">🇮🇩 +62</option>
                  <option value="+66">🇹🇭 +66</option>
                  <option value="+63">🇵🇭 +63</option>
                  <option value="+84">🇻🇳 +84</option>
                  <option value="+90">🇹🇷 +90</option>
                  <option value="+20">🇪🇬 +20</option>
                </select>
                <input
                  type="tel"
                  placeholder="Enter your phone number"
                  value={form.phone}
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={PHONE_EXACT_LEN[form.countryCode] ?? 15}
                  onChange={(e) => {
                    const cap = PHONE_EXACT_LEN[form.countryCode] ?? 15;
                    set("phone", e.target.value.replace(/[^0-9]/g, "").slice(0, cap));
                  }}
                  className={`wk-input ${errors.phone ? "err" : ""}`}
                />
              </div>
            </Field>

            <Field label="I am a" required error={errors.role}>
              <select
                value={form.role}
                onChange={(e) => set("role", e.target.value)}
                className={`wk-input wk-select cursor-pointer ${errors.role ? "err" : ""}`}
                style={{ color: form.role ? "var(--wk-text)" : "var(--wk-placeholder)" }}
              >
                <option value="" disabled>Select an option</option>
                <option value="Student">Student</option>
                <option value="Professional">Professional</option>
              </select>
            </Field>

            <Field
              label={form.role === "Professional" ? "Company" : "College / Company"}
            >
              <input
                type="text"
                placeholder={
                  form.role === "Professional"
                    ? "Your company (optional)"
                    : "Your college or company (optional)"
                }
                value={form.organization}
                onChange={(e) => set("organization", e.target.value)}
                className="wk-input"
              />
            </Field>

            {/* Students only — a professional has no graduation year to give. */}
            {form.role !== "Professional" && (
              <Field label="Graduation Year">
                <select
                  value={form.graduationYear}
                  onChange={(e) => set("graduationYear", e.target.value)}
                  className="wk-input wk-select cursor-pointer"
                  style={{
                    color: form.graduationYear
                      ? "var(--wk-text)"
                      : "var(--wk-placeholder)",
                  }}
                >
                  <option value="">Select year (optional)</option>
                  {GRAD_YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {isExistingMember && (
              <p className="wk-faint text-xs">
                Prefilled from your ABTalks profile — any changes here update it.
              </p>
            )}
          </div>
          )}

          <div className="mt-5">
            <LegalConsentFields
              values={legalConsent}
              onChange={setLegalConsent}
              // LegalConsentFields is shared app-wide and takes no `style`,
              // so the workshop palette is applied through className — cn()
              // runs tailwind-merge, which drops the component's own
              // border/bg/text defaults in favour of these.
              className="border-[var(--wk-card-border)] bg-[var(--wk-a5)] text-[var(--wk-text-faint)] [&_a]:font-semibold [&_a]:text-[var(--wk-a1)]"
            />
          </div>

          {apiError && (
            <div className="mt-5 rounded-xl border border-red-500/25 bg-red-500/10 p-3.5">
              <p className="text-center text-sm font-medium leading-relaxed text-red-300">
                {apiError}
              </p>
            </div>
          )}

          {state === "form" && (
            <>
              <button
                type="submit"
                disabled={isPending || !legalConsentAccepted(legalConsent)}
                className="register-btn mt-6 w-full cursor-pointer rounded-full py-3.5 text-base font-semibold text-white"
              >
                {isPending ? "Registering..." : "Register Now"}
              </button>

              <p className="mt-3.5 text-center text-xs" style={{ color: "var(--wk-muted)" }}>
                No spam. We&apos;ll only send your webinar details.
              </p>
            </>
          )}
        </div>
      </form>

      {showSuccess && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/70 px-4 backdrop-blur-md">
          <style>{`
            @keyframes modal-pop {
              0% { transform: scale(0.9) translateY(14px); opacity: 0; }
              100% { transform: scale(1) translateY(0); opacity: 1; }
            }
            .animate-pop { animation: modal-pop 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

            @keyframes confetti-fall {
              0%   { transform: translateY(-10vh) translateX(0) rotate(0deg); opacity: 1; }
              100% { transform: translateY(110vh) translateX(var(--drift)) rotate(var(--rot)); opacity: 1; }
            }
            .confetti-piece { position: absolute; top: -6vh; opacity: 0; animation-name: confetti-fall; animation-timing-function: cubic-bezier(0.2,0.6,0.4,1); animation-fill-mode: forwards; }

            @keyframes check-ring { to { stroke-dashoffset: 0; } }
            @keyframes check-mark { to { stroke-dashoffset: 0; } }
            @keyframes check-pop {
              0%   { transform: scale(0.5); opacity: 0; }
              55%  { transform: scale(1.12); }
              100% { transform: scale(1); opacity: 1; }
            }
            @keyframes ring-pulse {
              0%   { transform: scale(0.8); opacity: 0.5; }
              100% { transform: scale(1.9); opacity: 0; }
            }
            .check-wrap { animation: check-pop 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s both; }
            .check-ring-circle { stroke-dasharray: 151; stroke-dashoffset: 151; animation: check-ring 0.6s ease-out 0.2s forwards; }
            .check-mark-path  { stroke-dasharray: 48; stroke-dashoffset: 48; animation: check-mark 0.35s ease-out 0.7s forwards; }
          `}</style>

          {/* confetti burst */}
          <div className="pointer-events-none fixed inset-0 z-[101] overflow-hidden">
            {confetti.map((c) => (
              <span
                key={c.id}
                className="confetti-piece"
                style={{
                  left: `${c.left}%`,
                  width: c.size,
                  height: c.round ? c.size : c.size * 0.5,
                  borderRadius: c.round ? "9999px" : "2px",
                  background: c.bg,
                  animationDelay: `${c.delay}s`,
                  animationDuration: `${c.duration}s`,
                  // custom props consumed by the keyframe
                  ["--drift" as string]: `${c.drift}px`,
                  ["--rot" as string]: `${c.rotate}deg`,
                }}
              />
            ))}
          </div>

          <div
            className="animate-pop relative z-[102] w-full max-w-md overflow-hidden rounded-3xl p-8 text-center sm:p-10"
            style={{
              background: "rgba(17,17,17,0.94)",
              border: "1px solid rgba(255,255,255,0.1)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow: "0 40px 100px -20px rgba(var(--wk-ink-a),0.35)",
            }}
          >
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{
                background:
                  "linear-gradient(to right, transparent, rgba(var(--wk-a1-rgb),0.8), transparent)",
              }}
            />

            {/* animated check */}
            <div className="relative mx-auto mb-6 h-20 w-20">
              <span
                className="absolute inset-0 rounded-full"
                style={{
                  border: "2px solid rgba(var(--wk-a1-rgb),0.5)",
                  animation: "ring-pulse 1.4s ease-out 0.4s infinite",
                }}
              />
              <div
                className="check-wrap absolute inset-0 flex items-center justify-center rounded-full"
                style={{
                  background: "rgba(var(--wk-a1-rgb),0.14)",
                  border: "1px solid rgba(var(--wk-a1-rgb),0.4)",
                }}
              >
                <svg width="46" height="46" viewBox="0 0 52 52" fill="none">
                  <circle
                    className="check-ring-circle"
                    cx="26"
                    cy="26"
                    r="24"
                    stroke="#e05226"
                    strokeWidth="2.5"
                  />
                  <path
                    className="check-mark-path"
                    d="M15 27 L23 34 L38 18"
                    stroke="#e05226"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>

            <h3 className="mb-3 text-2xl font-extrabold tracking-tight text-white">
              You&apos;re Registered!
            </h3>
            <p className="mb-1.5 text-sm leading-relaxed text-white/60">
              Thank you for registering.
            </p>
            <p className="mb-6 text-[12.5px] font-medium leading-relaxed text-white/40">
              We&apos;ve sent your webinar details to your email. (Please check your Spam or Promotions folders if you don&apos;t see it).
            </p>
            <div className="inline-flex select-none items-center gap-2 rounded-xl border border-green-400/25 bg-green-400/10 px-4 py-2.5">
              <span className="h-2 w-2 animate-ping rounded-full bg-green-400" />
              <span className="text-xs font-semibold tracking-wide text-green-300">
                Redirecting to WhatsApp in{" "}
                <strong className="text-sm font-bold text-green-200">{redirectCountdown}s</strong>...
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, required, error, children }: FieldProps) {
  return (
    <div className="w-full">
      <label
        className="mb-1.5 block text-[13px] font-semibold"
        style={{ color: "var(--wk-text-dim)" }}
      >
        {label}
        {required && <span className="ml-1 text-(--wk-a2)">*</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1.5 text-xs font-medium tracking-wide text-red-600">{error}</p>
      )}
    </div>
  );
}
