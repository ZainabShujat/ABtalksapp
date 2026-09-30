"use client";

import { useCallback, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LegalConsentFields,
  DEFAULT_LEGAL_CONSENT,
  legalConsentAccepted,
  type LegalConsentValues,
} from "@/components/legal/legal-consent-fields";
import { PhoneVerifyField } from "@/components/shared/phone-verify-field";
import { CityCombobox } from "@/components/marketplace/city-combobox";
import {
  INDIA_STATE_NAMES,
  citiesForState,
  statesForCity,
} from "@/data/india-locations";
import { PHONE_COUNTRIES } from "@/features/hackathon-video/phone-countries";
import { submitVideoRegistrationAction } from "@/app/actions/hackathon-video-registration-actions";
import {
  videoRegistrationSchema,
  type VideoRegistrationInput,
} from "@/lib/validations/hackathon-video";
import { INDIA_DIALING_CODE } from "@/lib/validations/phone";
import { cn } from "@/lib/utils";

export type VideoRegistrationPrefill = {
  fullName: string;
  email: string;
  /** A +91 number this user already OTP-verified on the platform, if any. */
  verifiedPhone: { countryCode: string; phoneNumber: string } | null;
  /** False under `next dev`, where OTP is skipped. */
  phoneOtpRequired: boolean;
};

type FormValues = {
  phoneCountryCode: string;
  phoneNumber: string;
  city: string;
  state: string;
  employment: "LEARNER" | "WORKING";
  currentCtc: string;
  portfolioUrl: string;
  acceptLegal: boolean;
  newsletterOptIn: boolean;
};

const DEFAULT_DIAL = PHONE_COUNTRIES[0]?.dial ?? "+91";

/**
 * Dial codes for the phone picker. Select values must be unique, so countries
 * sharing a code (Canada / United States on +1) collapse into one option.
 * Code first, so it stays visible when the trigger truncates the name.
 */
const PHONE_OPTIONS: { code: string; label: string }[] = (() => {
  const byDial = new Map<string, string[]>();
  for (const c of PHONE_COUNTRIES) {
    byDial.set(c.dial, [...(byDial.get(c.dial) ?? []), c.name]);
  }
  return [...byDial].map(([code, names]) => ({
    code,
    label: `${code} ${names.join(" / ")}`,
  }));
})();

/**
 * Every control in the form shares the Input's height (40px) and radius.
 * SelectTrigger sizes itself with `data-[size=default]:h-8`, which outranks a
 * plain `h-10`, so the height is overridden on the same attribute selector.
 */
const CONTROL_HEIGHT_CLASS = "h-10 data-[size=default]:h-10 rounded-xl";
const CONTROL_CLASS = `${CONTROL_HEIGHT_CLASS} w-full min-w-0`;
/** Same look as `Input`, for the city combobox (which renders its own input). */
const COMBOBOX_INPUT_CLASS =
  "h-10 w-full min-w-0 rounded-xl border border-input bg-transparent px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm";

/**
 * VideoThon registration form. Rendered inside a dialog on the landing.
 * Identity is displayed from `prefill` (session-derived) — never editable,
 * never sent to the server — the action reads name/email from the session.
 */
export function VideoRegistrationForm({
  prefill,
  onSuccess,
}: {
  prefill: VideoRegistrationPrefill;
  onSuccess: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [legalConsent, setLegalConsent] = useState<LegalConsentValues>(
    DEFAULT_LEGAL_CONSENT,
  );
  // A number verified earlier on the platform is locked and needs no OTP.
  const lockedPhone = prefill.verifiedPhone;
  const [phoneVerified, setPhoneVerified] = useState(lockedPhone !== null);

  const form = useForm<FormValues>({
    resolver: zodResolver(
      videoRegistrationSchema,
    ) as unknown as Resolver<FormValues>,
    defaultValues: {
      phoneCountryCode: lockedPhone?.countryCode ?? DEFAULT_DIAL,
      phoneNumber: lockedPhone?.phoneNumber ?? "",
      city: "",
      state: "",
      employment: "LEARNER",
      currentCtc: "",
      portfolioUrl: "",
      acceptLegal: DEFAULT_LEGAL_CONSENT.acceptLegal,
      newsletterOptIn: DEFAULT_LEGAL_CONSENT.newsletterOptIn,
    },
    mode: "onTouched",
  });

  const employment = form.watch("employment");
  const phoneCountryCode = form.watch("phoneCountryCode");
  const selectedState = form.watch("state");
  const consented = legalConsentAccepted(legalConsent);
  const stateRequired = phoneCountryCode === INDIA_DIALING_CODE;

  // Stable: PhoneVerifyField reports through an effect keyed on this callback.
  const handlePhoneChange = useCallback(
    (v: { countryCode: string; phoneNumber: string }) => {
      const opts = { shouldValidate: form.formState.isSubmitted };
      form.setValue("phoneCountryCode", v.countryCode, opts);
      form.setValue("phoneNumber", v.phoneNumber, opts);
    },
    [form],
  );

  function handleStateChange(next: string) {
    form.setValue("state", next, { shouldValidate: true });
    // A listed city from another state no longer fits; a typed one is kept.
    const city = form.getValues("city");
    if (
      city &&
      statesForCity(city).length > 0 &&
      !citiesForState(next).includes(city)
    ) {
      form.setValue("city", "");
    }
  }

  function onSubmit(values: FormValues) {
    setSubmitError(null);
    if (!phoneVerified) {
      setSubmitError("Please verify your phone number with the OTP.");
      return;
    }
    if (!consented) {
      setSubmitError("Please accept the Terms of Service and Privacy Policy.");
      return;
    }

    const payload: VideoRegistrationInput = {
      phoneCountryCode: values.phoneCountryCode,
      phoneNumber: values.phoneNumber,
      city: values.city,
      state: values.state || undefined,
      employment: values.employment,
      currentCtc: values.currentCtc || undefined,
      portfolioUrl: values.portfolioUrl,
      acceptLegal: values.acceptLegal,
      newsletterOptIn: values.newsletterOptIn,
    };

    startTransition(async () => {
      const result = await submitVideoRegistrationAction(payload);
      if (!result.ok) {
        setSubmitError(result.message);
        toast.error(result.message);
        return;
      }
      toast.success("You're in.");
      onSuccess();
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="vt-form">
        {/* Identity — read-only echo so the user knows which Google account is
            being used. The server ignores anything the client sends here. */}
        <div className="vt-form__identity">
          <div className="vt-form__identity-row">
            <span className="vt-form__identity-label">Name</span>
            <span className="vt-form__identity-value">{prefill.fullName}</span>
          </div>
          <div className="vt-form__identity-row">
            <span className="vt-form__identity-label">Email</span>
            <span className="vt-form__identity-value">{prefill.email}</span>
          </div>
        </div>

        {lockedPhone ? (
          <div className="space-y-2">
            <Label>Phone number</Label>
            <div className="vt-form__verified">
              <span className="vt-form__verified-number">
                {lockedPhone.countryCode} {lockedPhone.phoneNumber}
              </span>
              <span className="vt-form__verified-badge">
                <CheckCircle2 aria-hidden />
                Verified
              </span>
            </div>
          </div>
        ) : (
          <FormField
            control={form.control}
            name="phoneNumber"
            render={() => (
              <FormItem className="vt-form__phone">
                <PhoneVerifyField
                  label="Phone number"
                  countryOptions={PHONE_OPTIONS}
                  required
                  placeholder="Enter your phone number"
                  optionalHint={null}
                  verificationRequired={prefill.phoneOtpRequired}
                  controlClassName={CONTROL_HEIGHT_CLASS}
                  disabled={pending}
                  onChange={handlePhoneChange}
                  onVerifiedChange={setPhoneVerified}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="vt-form__row-2 vt-form__row-2--even">
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl>
                  <CityCombobox
                    value={field.value}
                    state={selectedState}
                    onChange={(city, impliedState) => {
                      field.onChange(city);
                      // Picking a listed city fills its state in.
                      if (impliedState && impliedState !== selectedState) {
                        form.setValue("state", impliedState, {
                          shouldValidate: true,
                        });
                      }
                    }}
                    disabled={pending}
                    placeholder={
                      selectedState ? "Search cities" : "Enter your city"
                    }
                    className={COMBOBOX_INPUT_CLASS}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="state"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  State{" "}
                  {stateRequired ? null : (
                    <span className="vt-form__hint">(optional outside India)</span>
                  )}
                </FormLabel>
                <Select
                  value={field.value || null}
                  onValueChange={(next) => {
                    if (typeof next === "string") handleStateChange(next);
                  }}
                  disabled={pending}
                >
                  <FormControl>
                    <SelectTrigger className={CONTROL_CLASS}>
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {INDIA_STATE_NAMES.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="employment"
          render={({ field }) => (
            <FormItem>
              <FormLabel>You are a…</FormLabel>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v);
                    // Clear leftover CTC when they switch back to Learner —
                    // the field is hidden, so any old value would silently
                    // ride along into the DB row otherwise.
                    if (v === "LEARNER") form.setValue("currentCtc", "");
                  }}
                  className="vt-form__choices"
                >
                  <label
                    htmlFor="vt-emp-learner"
                    className={cn(
                      "vt-form__choice",
                      field.value === "LEARNER" && "is-selected",
                    )}
                  >
                    <RadioGroupItem value="LEARNER" id="vt-emp-learner" />
                    <span>
                      <span className="vt-form__choice-title">Learner</span>
                      <span className="vt-form__choice-body">
                        Student, self-taught, or between roles.
                      </span>
                    </span>
                  </label>
                  <label
                    htmlFor="vt-emp-working"
                    className={cn(
                      "vt-form__choice",
                      field.value === "WORKING" && "is-selected",
                    )}
                  >
                    <RadioGroupItem value="WORKING" id="vt-emp-working" />
                    <span>
                      <span className="vt-form__choice-title">Working</span>
                      <span className="vt-form__choice-body">
                        Editing full-time, freelance, or in-house.
                      </span>
                    </span>
                  </label>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {employment === "WORKING" ? (
          <FormField
            control={form.control}
            name="currentCtc"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Current CTC{" "}
                  <span className="vt-form__hint">
                    (required, type NA if you&apos;d rather not share)
                  </span>
                </FormLabel>
                <FormControl>
                  <Input placeholder="e.g. 800000 or NA" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        <FormField
          control={form.control}
          name="portfolioUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Portfolio link</FormLabel>
              <FormControl>
                <Input
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  placeholder="Enter your portfolio link"
                  {...field}
                />
              </FormControl>
              <p className="vt-form__hint">
                Any public link. Drive, Behance, YouTube, Vimeo, personal site.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <LegalConsentFields
          className="vt-form__legal"
          values={legalConsent}
          onChange={(next) => {
            setLegalConsent(next);
            form.setValue("acceptLegal", next.acceptLegal);
            form.setValue("newsletterOptIn", next.newsletterOptIn);
          }}
        />

        {submitError ? (
          <div className="vt-form__error" role="alert">
            {submitError}
          </div>
        ) : null}

        <div className="vt-form__actions">
          <button
            type="submit"
            className="vt-btn vt-btn--primary"
            disabled={pending || !consented}
          >
            {pending ? "Registering…" : "Register for VideoThon"}
          </button>
        </div>
      </form>
    </Form>
  );
}
