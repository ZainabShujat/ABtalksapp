"use client";

import { useMemo, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
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
import { PHONE_COUNTRIES } from "@/features/hackathon-video/phone-countries";
import { submitVideoRegistrationAction } from "@/app/actions/hackathon-video-registration-actions";
import {
  videoRegistrationSchema,
  type VideoRegistrationInput,
} from "@/lib/validations/hackathon-video";
import { cn } from "@/lib/utils";

type Prefill = {
  fullName: string;
  email: string;
};

type FormValues = {
  phoneCountryCode: string;
  phoneNumber: string;
  city: string;
  employment: "LEARNER" | "WORKING";
  currentCtc: string;
  portfolioUrl: string;
  acceptLegal: boolean;
  newsletterOptIn: boolean;
};

const DEFAULT_DIAL = PHONE_COUNTRIES[0]?.dial ?? "+91";

/**
 * VideoThon registration form. Rendered inside a dialog on the landing.
 * Identity is displayed from `prefill` (session-derived) — never editable,
 * never sent to the server — the action reads name/email from the session.
 */
export function VideoRegistrationForm({
  prefill,
  onSuccess,
}: {
  prefill: Prefill;
  onSuccess: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [legalConsent, setLegalConsent] = useState<LegalConsentValues>(
    DEFAULT_LEGAL_CONSENT,
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(
      videoRegistrationSchema,
    ) as unknown as Resolver<FormValues>,
    defaultValues: {
      phoneCountryCode: DEFAULT_DIAL,
      phoneNumber: "",
      city: "",
      employment: "LEARNER",
      currentCtc: "",
      portfolioUrl: "",
      acceptLegal: DEFAULT_LEGAL_CONSENT.acceptLegal,
      newsletterOptIn: DEFAULT_LEGAL_CONSENT.newsletterOptIn,
    },
    mode: "onTouched",
  });

  const employment = form.watch("employment");
  const consented = legalConsentAccepted(legalConsent);

  const countryOptions = useMemo(() => PHONE_COUNTRIES, []);

  function onSubmit(values: FormValues) {
    setSubmitError(null);
    if (!consented) {
      setSubmitError("Please accept the Terms of Service and Privacy Policy.");
      return;
    }

    const payload: VideoRegistrationInput = {
      phoneCountryCode: values.phoneCountryCode,
      phoneNumber: values.phoneNumber,
      city: values.city,
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

        <div className="vt-form__row-2">
          <FormField
            control={form.control}
            name="phoneCountryCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Country code</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full min-w-0">
                      <SelectValue placeholder="+91" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {countryOptions.map((c) => (
                      <SelectItem key={c.iso} value={c.dial}>
                        {c.name} ({c.dial})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phoneNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone number</FormLabel>
                <FormControl>
                  <Input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="98765 43210"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel>City</FormLabel>
              <FormControl>
                <Input
                  autoComplete="address-level2"
                  placeholder="Mumbai"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="employment"
          render={({ field }) => (
            <FormItem>
              <FormLabel>You are a…</FormLabel>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={(v) => field.onChange(v)}
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

        <FormField
          control={form.control}
          name="currentCtc"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Current CTC{" "}
                <span className="vt-form__hint">
                  {employment === "WORKING"
                    ? "(required — type NA if you'd rather not share)"
                    : "(optional)"}
                </span>
              </FormLabel>
              <FormControl>
                <Input placeholder="e.g. 800000 or NA" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

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
                  placeholder="https://behance.net/... or drive.google.com/... or your reel"
                  {...field}
                />
              </FormControl>
              <p className="vt-form__hint">
                Any public link — Drive, Behance, YouTube, Vimeo, personal site.
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
