"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { switchHackathonAccountAction } from "@/app/actions/hackathon-auth-actions";
import {
  lookupHackathonTeamAction,
  submitHackathonRegistrationAction,
} from "@/app/actions/hackathon-actions";
import { CollegeCombobox } from "@/components/shared/college-combobox";
import { SuccessPanel } from "@/components/hackathon/success-panel";
import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import {
  LegalConsentFields,
  legalConsentAccepted,
  type LegalConsentValues,
} from "@/components/legal/legal-consent-fields";
import {
  hackathonRegistrationSchema,
  type HackathonRegistrationInput,
} from "@/lib/validations/hackathon";
import { cn } from "@/lib/utils";

const GRADUATION_YEARS = [
  2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032,
] as const;

type EntryType = HackathonRegistrationInput["entryType"];

type FormValues = {
  entryType: EntryType;
  fullName: string;
  email: string;
  phone: string;
  college: string;
  graduationYear: number;
  teamName: string;
  teamCode: string;
  acceptLegal: boolean;
  newsletterOptIn: boolean;
};

type SuccessState = {
  entryType: EntryType;
  teamCode: string;
  teamName: string | null;
};

const ENTRY_OPTIONS: { value: EntryType; title: string; body: string }[] = [
  {
    value: "SOLO",
    title: "Going solo",
    body: "Register as an individual. You'll still get a code if you ever need it.",
  },
  {
    value: "TEAM_CREATE",
    title: "Create a team",
    body: "Start a team of up to 3. You'll get a 6-character code to share.",
  },
  {
    value: "TEAM_JOIN",
    title: "Join a team with a code",
    body: "Enter the code your team leader shared with you.",
  },
];

export function RegistrationForm({
  initialEmail,
  initialName = "",
}: {
  initialEmail: string;
  initialName?: string;
}) {
  const [step, setStep] = useState(1);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [pending, startTransition] = useTransition();
  const [lookupPending, startLookup] = useTransition();
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [lookupOk, setLookupOk] = useState(false);
  const [lookupTeamName, setLookupTeamName] = useState<string | null>(null);
  const [lookupSpots, setLookupSpots] = useState<number | null>(null);
  const [legalConsent, setLegalConsent] = useState<LegalConsentValues>({
    acceptLegal: false, newsletterOptIn: true,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(
      hackathonRegistrationSchema,
    ) as unknown as Resolver<FormValues>,
    defaultValues: {
      entryType: "SOLO",
      fullName: initialName,
      email: initialEmail,
      phone: "",
      college: "",
      graduationYear: 2026,
      teamName: "",
      teamCode: "",
      acceptLegal: false, newsletterOptIn: true,
    },
    mode: "onTouched",
  });

  const entryType = form.watch("entryType");
  const totalSteps = entryType === "SOLO" ? 2 : 3;

  function buildPayload(values: FormValues): HackathonRegistrationInput {
    const legal = {
      acceptLegal: values.acceptLegal,
      newsletterOptIn: values.newsletterOptIn,
    };
    if (values.entryType === "SOLO") {
      return {
        entryType: "SOLO",
        fullName: values.fullName,
        email: values.email,
        phone: values.phone,
        college: values.college,
        graduationYear: values.graduationYear,
        ...legal,
      };
    }
    if (values.entryType === "TEAM_CREATE") {
      return {
        entryType: "TEAM_CREATE",
        fullName: values.fullName,
        email: values.email,
        phone: values.phone,
        college: values.college,
        graduationYear: values.graduationYear,
        teamName: values.teamName,
        ...legal,
      };
    }
    return {
      entryType: "TEAM_JOIN",
      fullName: values.fullName,
      email: values.email,
      phone: values.phone,
      college: values.college,
      graduationYear: values.graduationYear,
      teamCode: values.teamCode,
      ...legal,
    };
  }

  async function goNext() {
    setSubmitError(null);
    if (step === 1) {
      const ok = await form.trigger("entryType");
      if (!ok) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      const ok = await form.trigger([
        "fullName",
        "email",
        "phone",
        "college",
        "graduationYear",
      ]);
      if (!ok) return;
      if (entryType === "SOLO") {
        if (!legalConsentAccepted(legalConsent)) {
          setSubmitError(
            "Please accept the Terms of Service and Privacy Policy.",
          );
          return;
        }
        form.setValue("acceptLegal", legalConsent.acceptLegal);
        form.setValue("newsletterOptIn", legalConsent.newsletterOptIn);
        form.handleSubmit(onSubmit)();
        return;
      }
      setStep(3);
    }
  }

  function checkTeamCode() {
    const code = form.getValues("teamCode").trim().toUpperCase();
    form.setValue("teamCode", code, { shouldValidate: true });
    setLookupMessage(null);
    setLookupOk(false);
    setLookupTeamName(null);
    setLookupSpots(null);

    startLookup(async () => {
      const result = await lookupHackathonTeamAction(code);
      if (!result.ok) {
        setLookupMessage(result.message);
        setLookupOk(false);
        return;
      }
      setLookupOk(true);
      setLookupTeamName(result.data.teamName);
      setLookupSpots(result.data.spotsLeft);
      setLookupMessage(
        `Joining ${result.data.teamName ?? "team"}, ${result.data.spotsLeft} spot(s) left`,
      );
    });
  }

  function onSubmit(values: FormValues) {
    setSubmitError(null);
    if (!legalConsentAccepted(legalConsent)) {
      setSubmitError(
        "Please accept the Terms of Service and Privacy Policy.",
      );
      return;
    }
    const payload = buildPayload(values);

    startTransition(async () => {
      const result = await submitHackathonRegistrationAction(payload);
      if (!result.ok) {
        setSubmitError(result.message);
        toast.error(result.message);
        return;
      }
      setSuccess({
        entryType: result.data.entryType,
        teamCode: result.data.teamCode,
        teamName: result.data.teamName,
      });
    });
  }

  if (success) {
    return (
      <SuccessPanel
        entryType={success.entryType}
        teamCode={success.teamCode}
        teamName={success.teamName}
      />
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Step {step} of {totalSteps}
            </span>
            <span className="tabular-nums">
              {Math.round((step / totalSteps) * 100)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(step / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Registering as <span className="font-medium text-foreground">{initialEmail}</span>
          {" · "}
          <button
            type="button"
            className="text-primary underline-offset-2 hover:underline"
            onClick={() => {
              if (form.formState.isDirty) {
                const ok = window.confirm(
                  "Switch account? You'll lose what you've entered here.",
                );
                if (!ok) return;
              }
              void switchHackathonAccountAction();
            }}
          >
            Not you? Switch account
          </button>
        </p>

        {step === 1 ? (
          <FormField
            control={form.control}
            name="entryType"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormLabel className="text-base font-semibold">
                  How are you entering?
                </FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={(v) => {
                      const next =
                        v === "TEAM_CREATE" || v === "TEAM_JOIN" || v === "SOLO"
                          ? v
                          : "SOLO";
                      field.onChange(next);
                      setLookupOk(false);
                      setLookupMessage(null);
                      if (step > 2 && next === "SOLO") setStep(2);
                    }}
                    className="grid gap-3"
                  >
                    {ENTRY_OPTIONS.map((opt) => (
                      <Label
                        key={opt.value}
                        htmlFor={`entry-${opt.value}`}
                        className="cursor-pointer"
                      >
                        <div
                          className={cn(
                            "flex items-start gap-3 rounded-xl border border-border p-4 transition-colors",
                            field.value === opt.value &&
                              "border-primary bg-primary/5 ring-2 ring-primary/20",
                          )}
                        >
                          <RadioGroupItem
                            value={opt.value}
                            id={`entry-${opt.value}`}
                            className="mt-1"
                          />
                          <div className="min-w-0">
                            <div className="font-display font-semibold text-foreground">
                              {opt.title}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {opt.body}
                            </p>
                          </div>
                        </div>
                      </Label>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      readOnly
                      tabIndex={-1}
                      className="bg-muted text-muted-foreground"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>WhatsApp number</FormLabel>
                  <FormControl>
                    <Input
                      type="tel"
                      autoComplete="tel"
                      placeholder="+91…"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="college"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>College</FormLabel>
                  <FormControl>
                    <CollegeCombobox
                      value={field.value}
                      onChange={(name) => field.onChange(name)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="graduationYear"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Graduation year</FormLabel>
                  <Select
                    value={String(field.value)}
                    onValueChange={(v) => {
                      if (v != null) field.onChange(Number(v));
                    }}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full min-w-0">
                        <SelectValue placeholder="Select year" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {GRADUATION_YEARS.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        ) : null}

        {step === 3 && entryType === "TEAM_CREATE" ? (
          <FormField
            control={form.control}
            name="teamName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Team name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <p className="text-sm text-muted-foreground">
                  You&apos;ll get a 6-character code to share with your teammates.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        {step === 3 && entryType === "TEAM_JOIN" ? (
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="teamCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Team code</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={6}
                      autoCapitalize="characters"
                      className="font-mono tracking-widest uppercase"
                      onChange={(e) => {
                        field.onChange(e.target.value.toUpperCase());
                        setLookupOk(false);
                        setLookupMessage(null);
                      }}
                      onBlur={() => {
                        field.onBlur();
                        if (form.getValues("teamCode").trim().length === 6) {
                          checkTeamCode();
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="button"
              variant="outline"
              onClick={checkTeamCode}
              disabled={lookupPending}
            >
              {lookupPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Checking…
                </>
              ) : (
                "Check code"
              )}
            </Button>
            {lookupMessage ? (
              <p
                className={cn(
                  "text-sm",
                  lookupOk ? "text-foreground" : "text-destructive",
                )}
              >
                {lookupOk && lookupTeamName != null && lookupSpots != null
                  ? `Joining ${lookupTeamName}, ${lookupSpots} spot(s) left`
                  : lookupMessage}
              </p>
            ) : null}
          </div>
        ) : null}

        {step === totalSteps ? (
          <LegalConsentFields
            values={legalConsent}
            onChange={(next) => {
              setLegalConsent(next);
              form.setValue("acceptLegal", next.acceptLegal);
              form.setValue("newsletterOptIn", next.newsletterOptIn);
            }}
          />
        ) : null}

        {submitError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {submitError}
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          {step > 1 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSubmitError(null);
                setStep((s) => s - 1);
              }}
              disabled={pending}
            >
              Back
            </Button>
          ) : (
            <span />
          )}

          {step === 2 && entryType === "SOLO" ? (
            <Button
              type="button"
              onClick={goNext}
              disabled={pending || !legalConsentAccepted(legalConsent)}
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Registering…
                </>
              ) : (
                "Register"
              )}
            </Button>
          ) : step < totalSteps ? (
            <Button type="button" onClick={goNext} disabled={pending}>
              Continue
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={
                pending ||
                !legalConsentAccepted(legalConsent) ||
                (entryType === "TEAM_JOIN" && !lookupOk)
              }
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Registering…
                </>
              ) : (
                "Register"
              )}
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
}
