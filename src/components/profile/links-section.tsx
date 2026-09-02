"use client";

import { Controller, useFieldArray, useForm } from "react-hook-form";
import { CandidateLinkType } from "@prisma/client";
import { Briefcase, CodeXml, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { saveLinksAction } from "@/app/actions/candidate-profile-actions";
import { EXTRA_LINK_TYPES, LINK_TYPE_LABELS } from "@/lib/candidate-vocab";
import { Field, SectionActions } from "./fields";
import { useSectionSave } from "./use-section-save";

export type ExtraLinkFormRow = {
  type: CandidateLinkType;
  label: string;
  url: string;
};

export type LinksFormValues = {
  linkedinUrl: string;
  githubUsername: string;
  portfolioUrl: string;
  extra: ExtraLinkFormRow[];
};

export function LinksSection({ initial }: { initial: LinksFormValues }) {
  const { saving, save } = useSectionSave(saveLinksAction, "Links");
  const { control, register, handleSubmit } = useForm<LinksFormValues>({
    defaultValues: initial,
  });
  const { fields, append, remove } = useFieldArray({ control, name: "extra" });

  return (
    <form onSubmit={handleSubmit((v) => save(v))} className="space-y-5">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <Briefcase className="mt-8 size-5 shrink-0 text-[#0A66C2]" aria-hidden />
          <Field label="LinkedIn" htmlFor="ln-linkedin" className="flex-1">
            <Input
              id="ln-linkedin"
              type="url"
              inputMode="url"
              placeholder="https://www.linkedin.com/in/…"
              {...register("linkedinUrl")}
            />
          </Field>
        </div>

        <div className="flex items-start gap-3">
          <CodeXml className="mt-8 size-5 shrink-0" aria-hidden />
          <Field
            label="GitHub"
            htmlFor="ln-github"
            className="flex-1"
            hint="Username or full profile URL — both are stored as your username."
          >
            <Input
              id="ln-github"
              placeholder="https://github.com/username"
              {...register("githubUsername")}
            />
          </Field>
        </div>

        <div className="flex items-start gap-3">
          <Globe className="mt-8 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <Field label="Portfolio" htmlFor="ln-portfolio" className="flex-1">
            <Input
              id="ln-portfolio"
              type="url"
              inputMode="url"
              placeholder="https://example.com/"
              {...register("portfolioUrl")}
            />
          </Field>
        </div>
      </div>

      {fields.length > 0 ? (
        <div className="space-y-3 border-t pt-4">
          <p className="text-xs font-medium text-muted-foreground">
            Additional links
          </p>
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
            >
              <Field label="Type">
                <Controller
                  control={control}
                  name={`extra.${index}.type`}
                  render={({ field: f }) => (
                    <Select
                      value={f.value}
                      onValueChange={(v) => f.onChange(v as CandidateLinkType)}
                    >
                      <SelectTrigger aria-label="Link type">
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        {EXTRA_LINK_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {LINK_TYPE_LABELS[t] ?? t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Label" htmlFor={`ln-label-${index}`}>
                  <Input
                    id={`ln-label-${index}`}
                    placeholder="ex: LeetCode"
                    {...register(`extra.${index}.label`)}
                  />
                </Field>
                <Field label="URL" htmlFor={`ln-url-${index}`}>
                  <Input
                    id={`ln-url-${index}`}
                    type="url"
                    inputMode="url"
                    placeholder="https://…"
                    {...register(`extra.${index}.url`)}
                  />
                </Field>
              </div>

              <Button
                type="button"
                variant="ghost"
                onClick={() => remove(index)}
                className="sm:mb-1"
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <SectionActions
        saving={saving}
        onAdd={() =>
          append({ type: CandidateLinkType.LEETCODE, label: "", url: "" })
        }
        addLabel="Add another"
        saveLabel="Save links"
      />
    </form>
  );
}
