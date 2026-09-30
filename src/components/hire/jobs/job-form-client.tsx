"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { JobStatus, JobType, JobWorkMode } from "@prisma/client";
import {
  Bold,
  Briefcase,
  Check,
  Clock,
  Eye,
  FileText,
  Italic,
  Lightbulb,
  Link2,
  List,
  ListOrdered,
  MapPin,
  Monitor,
  Save,
  Send,
  Tag,
} from "lucide-react";
import {
  createRecruiterJobAction,
  publishRecruiterJobAction,
  updateRecruiterJobAction,
} from "@/app/actions/recruiter-job-actions";
import { JOB_TYPE_LABEL, WORK_MODE_LABEL } from "@/components/jobs/job-ui";
import {
  applyListEnter,
  applyListToggle,
  type ListKind,
} from "@/components/hire/jobs/markdown-list";

type Initial = {
  jobId?: string;
  title: string;
  description: string;
  location: string;
  workMode: JobWorkMode;
  type: JobType;
  skills: string[];
  /** Held as a string because an empty input is "" and must stay distinct
   *  from 0 — "not stated" and "no experience needed" are different answers.
   *  Coerced once, in `payload()`. */
  minExperience: string;
  applyExternalUrl: string;
};

const DEFAULT_INITIAL: Initial = {
  title: "",
  description: "",
  location: "",
  workMode: "REMOTE",
  type: "FULL_TIME",
  skills: [],
  minExperience: "",
  applyExternalUrl: "",
};

const DESCRIPTION_MAX = 5000;

const TIPS = [
  "Be clear and specific",
  "Mention key technologies",
  "Describe impact and growth",
  "Keep it inclusive and open",
] as const;

type Props = {
  initial?: Partial<Initial>;
  jobId?: string;
  company?: string;
  variant?: "page" | "embedded";
  status?: JobStatus;
};

function parseSkills(raw: string) {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function JobFormClient({
  initial,
  jobId,
  company,
  variant = "page",
  status,
}: Props) {
  const router = useRouter();
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [values, setValues] = useState<Initial>({
    ...DEFAULT_INITIAL,
    ...initial,
  });
  const [skillsInput, setSkillsInput] = useState<string>(
    (initial?.skills ?? []).join(", "),
  );
  const [preview, setPreview] = useState(false);
  const [pending, startTransition] = useTransition();
  const isPage = variant === "page" && !jobId;
  const canPublish = !jobId || status === "DRAFT";
  const descMax = Math.max(DESCRIPTION_MAX, values.description.length);

  function set<K extends keyof Initial>(key: K, value: Initial[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function wrapSelection(prefix: string, suffix = prefix) {
    const el = descRef.current;
    if (!el) {
      set("description", `${values.description}${prefix}text${suffix}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = values.description.slice(start, end) || "text";
    const next =
      values.description.slice(0, start) +
      prefix +
      selected +
      suffix +
      values.description.slice(end);
    set("description", next);
    requestAnimationFrame(() => {
      el.focus();
      const from = start + prefix.length;
      el.setSelectionRange(from, from + selected.length);
    });
  }

  function toggleList(kind: ListKind) {
    const el = descRef.current;
    const text = values.description;
    if (!el) {
      const sep = text && !text.endsWith("\n") ? "\n" : "";
      set("description", `${text}${sep}${kind === "number" ? "1. " : "- "}`);
      return;
    }
    const edit = applyListToggle(text, el.selectionStart, el.selectionEnd, kind);
    set("description", edit.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(edit.selStart, edit.selEnd);
    });
  }

  function handleDescKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const edit = applyListEnter(values.description, el.selectionStart);
    if (!edit || edit.text.length > descMax) return;
    e.preventDefault();
    set("description", edit.text);
    requestAnimationFrame(() => el.setSelectionRange(edit.selStart, edit.selEnd));
  }

  function payload() {
    return {
      title: values.title,
      description: values.description,
      location: values.location,
      workMode: values.workMode,
      opportunityType: values.type,
      skills: parseSkills(skillsInput),
      // "" means the recruiter left it alone, which is a real answer and must
      // reach the server as null rather than as 0.
      minExperience:
        values.minExperience.trim() === ""
          ? null
          : Number(values.minExperience),
      applyExternalUrl: values.applyExternalUrl,
    };
  }

  function missingRequired() {
    if (!values.title.trim()) return "Add a job title.";
    if (!values.description.trim()) return "Add a job description.";
    return null;
  }

  function submit(intent: "draft" | "publish" | "update") {
    const missing = missingRequired();
    if (missing) {
      toast.error(missing);
      return;
    }

    startTransition(async () => {
      if (jobId) {
        const res = await updateRecruiterJobAction({ ...payload(), jobId });
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        if (intent === "publish") {
          const published = await publishRecruiterJobAction({ jobId });
          if (!published.ok) {
            toast.error(published.message);
            router.refresh();
            return;
          }
          toast.success("Job published");
          router.refresh();
          return;
        }
        toast.success("Job updated");
        router.refresh();
        return;
      }

      const res = await createRecruiterJobAction(payload());
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (intent === "publish") {
        const published = await publishRecruiterJobAction({
          jobId: res.data.id,
        });
        if (!published.ok) {
          toast.error(published.message);
          router.push(`/hire/jobs/${res.data.id}`);
          return;
        }
        toast.success("Job published");
        router.push(`/hire/jobs/${res.data.id}`);
        return;
      }
      toast.success("Draft saved");
      router.push(`/hire/jobs/${res.data.id}`);
    });
  }

  const fields = (
    <>
      <section className="hire-jobs-form__card">
        <header className="hire-jobs-form__section-head">
          <span className="hire-jobs-form__n" aria-hidden="true">
            1
          </span>
          <div>
            <h2>Basic information</h2>
            <p>Start with the key details about the role.</p>
          </div>
        </header>

        <label className="hire-jobs-form__field">
          <span>
            Job title <abbr title="required">*</abbr>
          </span>
          <span className="hire-jobs-form__control">
            <Briefcase aria-hidden="true" />
            <input
              id="job-title"
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Full-Stack Engineer"
              maxLength={200}
              required
            />
          </span>
        </label>

        <div className="hire-jobs-form__grid">
          <label className="hire-jobs-form__field">
            <span>Location</span>
            <span className="hire-jobs-form__control">
              <MapPin aria-hidden="true" />
              <input
                id="job-location"
                value={values.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="e.g. Bengaluru, India"
                maxLength={200}
              />
            </span>
          </label>

          <label className="hire-jobs-form__field">
            <span>Minimum experience</span>
            <span className="hire-jobs-form__control">
              <Clock aria-hidden="true" />
              <input
                id="job-min-experience"
                type="number"
                inputMode="numeric"
                min={0}
                max={50}
                value={values.minExperience}
                onChange={(e) => set("minExperience", e.target.value)}
                placeholder="e.g. 2"
              />
            </span>
          </label>
          <label className="hire-jobs-form__field">
            <span>
              Work mode <abbr title="required">*</abbr>
            </span>
            <span className="hire-jobs-form__control">
              <Monitor aria-hidden="true" />
              <select
                id="job-workmode"
                value={values.workMode}
                onChange={(e) => set("workMode", e.target.value as JobWorkMode)}
              >
                {(Object.keys(WORK_MODE_LABEL) as JobWorkMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {WORK_MODE_LABEL[mode]}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="hire-jobs-form__field">
            <span>
              Opportunity type <abbr title="required">*</abbr>
            </span>
            <span className="hire-jobs-form__control">
              <FileText aria-hidden="true" />
              <select
                id="job-type"
                value={values.type}
                onChange={(e) => set("type", e.target.value as JobType)}
              >
                {(Object.keys(JOB_TYPE_LABEL) as JobType[]).map((type) => (
                  <option key={type} value={type}>
                    {JOB_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="hire-jobs-form__field">
            <span>External apply URL</span>
            <span className="hire-jobs-form__control">
              <Link2 aria-hidden="true" />
              <input
                id="job-apply-url"
                type="url"
                value={values.applyExternalUrl}
                onChange={(e) => set("applyExternalUrl", e.target.value)}
                placeholder="https://company.com/careers/…"
                maxLength={2048}
              />
            </span>
          </label>
        </div>
      </section>

      <section className="hire-jobs-form__card">
        <header className="hire-jobs-form__section-head">
          <span className="hire-jobs-form__n" aria-hidden="true">
            2
          </span>
          <div>
            <h2>Skills</h2>
            <p>Add relevant skills to help candidates find this role.</p>
          </div>
        </header>
        <label className="hire-jobs-form__field">
          <span>Skills (comma-separated)</span>
          <span className="hire-jobs-form__control">
            <Tag aria-hidden="true" />
            <input
              id="job-skills"
              value={skillsInput}
              onChange={(e) => setSkillsInput(e.target.value)}
              placeholder="e.g. react, node, aws"
              maxLength={800}
            />
          </span>
          <em>Add 3–10 key skills. Separate with commas.</em>
        </label>
      </section>

      <section className="hire-jobs-form__card">
        <header className="hire-jobs-form__section-head">
          <span className="hire-jobs-form__n" aria-hidden="true">
            3
          </span>
          <div>
            <h2>Description</h2>
            <p>Give candidates a clear picture of the role.</p>
          </div>
        </header>
        <div className="hire-jobs-form__field">
          <span>
            Job description <abbr title="required">*</abbr>
          </span>
          <div className="hire-jobs-form__editor">
            <div className="hire-jobs-form__toolbar" role="toolbar" aria-label="Formatting">
              <button
                type="button"
                onClick={() => wrapSelection("**")}
                aria-label="Bold"
              >
                <Bold />
              </button>
              <button
                type="button"
                onClick={() => wrapSelection("_")}
                aria-label="Italic"
              >
                <Italic />
              </button>
              <button
                type="button"
                onClick={() => toggleList("bullet")}
                aria-label="Bullet list"
              >
                <List />
              </button>
              <button
                type="button"
                onClick={() => toggleList("number")}
                aria-label="Numbered list"
              >
                <ListOrdered />
              </button>
              <button
                type="button"
                onClick={() => wrapSelection("[", "](https://)")}
                aria-label="Link"
              >
                <Link2 />
              </button>
              <button
                type="button"
                className={preview ? "is-active" : undefined}
                aria-pressed={preview}
                onClick={() => setPreview((v) => !v)}
              >
                <Eye />
                Preview
              </button>
            </div>
            {preview ? (
              <div className="hire-jobs-form__preview">
                {values.description.trim() ? (
                  <ReactMarkdown>{values.description}</ReactMarkdown>
                ) : (
                  <p>Nothing to preview yet.</p>
                )}
              </div>
            ) : (
              <textarea
                ref={descRef}
                id="job-description"
                value={values.description}
                onChange={(e) => set("description", e.target.value)}
                onKeyDown={handleDescKeyDown}
                placeholder="What the role is, who it's for, what they'll build…"
                maxLength={descMax}
                required
              />
            )}
            <p className="hire-jobs-form__count">
              {values.description.length}/{descMax}
            </p>
          </div>
        </div>
      </section>
    </>
  );

  const actions = (
    <div className="hire-jobs-form__actions">
      {isPage ? (
        <Link href="/hire/jobs" className="hire-jobs__btn hire-jobs__btn--ghost">
          Cancel
        </Link>
      ) : null}
      <div className="hire-jobs-form__actions-end">
        <button
          type="button"
          className="hire-jobs__btn hire-jobs__btn--secondary"
          disabled={pending}
          onClick={() => submit(jobId ? "update" : "draft")}
        >
          <Save aria-hidden="true" />
          {pending ? "Saving…" : jobId ? "Save changes" : "Save as draft"}
        </button>
        {canPublish ? (
          <button
            type="button"
            className="hire-jobs__btn"
            disabled={pending}
            onClick={() => submit("publish")}
          >
            <Send aria-hidden="true" />
            {pending ? "Publishing…" : "Publish job"}
          </button>
        ) : null}
      </div>
    </div>
  );

  if (!isPage) {
    return (
      <div className="hire-jobs-form hire-jobs-form--embedded">
        {fields}
        {actions}
      </div>
    );
  }

  return (
    <div className="hire-jobs hire-jobs--compose">
      <div className="hire-jobs-form__top">
        <Link href="/hire/jobs" className="hire-back">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 19 8 12l7-7" />
          </svg>
          <span>All jobs</span>
        </Link>
        <button
          type="button"
          className="hire-jobs__btn hire-jobs__btn--secondary hire-jobs__btn--sm"
          disabled={pending}
          onClick={() => submit("draft")}
        >
          <Save aria-hidden="true" />
          Save as draft
        </button>
      </div>

      <div className="hire-jobs-form__title-row">
        <div>
          <h1>Write a job</h1>
          <p>
            Post on ABTalks. Save as a draft — you can publish it when
            you&apos;re ready
            {company ? ` as ${company}` : ""}.
          </p>
        </div>
        <a className="hire-jobs__guidelines" href="#job-posting-tips">
          Need help? View posting guidelines
        </a>
      </div>

      <div className="hire-jobs-form__layout">
        <form
          className="hire-jobs-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit("draft");
          }}
        >
          {fields}
          {actions}
        </form>

        <aside className="hire-jobs-form__aside" id="job-posting-tips">
          <section className="hire-jobs-form__tips">
            <header>
              <Lightbulb aria-hidden="true" />
              <h2>Tips for a great job post</h2>
            </header>
            <ul>
              {TIPS.map((tip) => (
                <li key={tip}>
                  <Check aria-hidden="true" />
                  {tip}
                </li>
              ))}
            </ul>
          </section>
          <section className="hire-jobs-form__note">
            <FileText aria-hidden="true" />
            <div>
              <h2>Title and description required</h2>
              <p>
                Save a draft any time. Add location and skills before you
                publish so the right candidates can find the role.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
