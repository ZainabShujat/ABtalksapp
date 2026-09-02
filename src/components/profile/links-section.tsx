"use client";

import { useEffect } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { CandidateLinkType } from "@prisma/client";
import { saveLinksAction } from "@/app/actions/candidate-profile-actions";
import { EXTRA_LINK_TYPES, LINK_TYPE_LABELS } from "@/lib/candidate-vocab";
import { useSectionSave } from "./use-section-save";
import { useProfileWizard } from "./wizard-context";
import {
  PwAddMore,
  PwEntryCard,
  PwField,
  PwInput,
  PwRow,
  PwSelect,
} from "./wizard-fields";

export type ExtraLinkFormRow = {
  type: CandidateLinkType;
  label: string;
  url: string;
};

export type LinksFormValues = {
  linkedinUrl: string;
  githubUsername: string;
  portfolioUrl: string;
  resumeUrl: string;
  extra: ExtraLinkFormRow[];
};

function BriefcaseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}

export function LinksSection({ initial }: { initial: LinksFormValues }) {
  const { formId, onSaved, setDirty } = useProfileWizard();
  const { save } = useSectionSave(saveLinksAction, "Links");
  const { control, register, handleSubmit, formState } = useForm<LinksFormValues>(
    { defaultValues: initial },
  );
  const { fields, append, remove } = useFieldArray({
    control,
    name: "extra",
  });

  useEffect(() => {
    setDirty(formState.isDirty);
  }, [formState.isDirty, setDirty]);

  return (
    <form
      id={formId}
      onSubmit={handleSubmit(async (v) => {
        if (await save(v)) onSaved();
      })}
    >
      <PwRow cols={1}>
        <PwField
          label="LinkedIn"
          htmlFor="ln-linkedin"
          icon={<BriefcaseIcon />}
        >
          <PwInput
            id="ln-linkedin"
            type="url"
            inputMode="url"
            placeholder="https://www.linkedin.com/in/username/"
            {...register("linkedinUrl")}
          />
        </PwField>
      </PwRow>

      <PwRow cols={1}>
        <PwField
          label="GitHub"
          htmlFor="ln-github"
          icon={<CodeIcon />}
          helper="Username or full profile URL — both are stored as your username."
        >
          <PwInput
            id="ln-github"
            placeholder="https://github.com/username"
            {...register("githubUsername")}
          />
        </PwField>
      </PwRow>

      <PwRow cols={1}>
        <PwField
          label="Portfolio"
          htmlFor="ln-portfolio"
          icon={<GlobeIcon />}
        >
          <PwInput
            id="ln-portfolio"
            type="url"
            inputMode="url"
            placeholder="https://yoursite.com"
            {...register("portfolioUrl")}
          />
        </PwField>
      </PwRow>

      <PwRow cols={1}>
        <PwField
          label="Résumé"
          htmlFor="ln-resume"
          icon={<FileIcon />}
          helper="Visible to you and admins. Recruiters see it only if you allow it."
        >
          <PwInput
            id="ln-resume"
            type="url"
            inputMode="url"
            placeholder="https://drive.google.com/..."
            {...register("resumeUrl")}
          />
        </PwField>
      </PwRow>

      {fields.length > 0 ? (
        <div className="pw-entries">
          {fields.map((field, index) => (
            <PwEntryCard
              key={field.id}
              index={index}
              title="Link"
              onRemove={() => remove(index)}
            >
              <PwRow cols={2}>
                <PwField label="Type">
                  <Controller
                    control={control}
                    name={`extra.${index}.type`}
                    render={({ field: f }) => (
                      <PwSelect
                        value={f.value}
                        onChange={(e) =>
                          f.onChange(e.target.value as CandidateLinkType)
                        }
                      >
                        {EXTRA_LINK_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {LINK_TYPE_LABELS[t] ?? t}
                          </option>
                        ))}
                      </PwSelect>
                    )}
                  />
                </PwField>
                <PwField label="Label" htmlFor={`ln-label-${index}`}>
                  <PwInput
                    id={`ln-label-${index}`}
                    placeholder="ex: LeetCode"
                    {...register(`extra.${index}.label`)}
                  />
                </PwField>
              </PwRow>
              <PwRow cols={1}>
                <PwField label="URL" htmlFor={`ln-url-${index}`}>
                  <PwInput
                    id={`ln-url-${index}`}
                    type="url"
                    inputMode="url"
                    placeholder="https://…"
                    {...register(`extra.${index}.url`)}
                  />
                </PwField>
              </PwRow>
            </PwEntryCard>
          ))}
        </div>
      ) : null}

      <PwAddMore
        onClick={() =>
          append({ type: CandidateLinkType.LEETCODE, label: "", url: "" })
        }
      />
    </form>
  );
}
