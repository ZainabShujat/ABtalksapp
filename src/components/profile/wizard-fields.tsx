"use client";

import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

const MONTHS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

function yearOptions(): string[] {
  const out: string[] = [];
  const y = new Date().getFullYear() + 6;
  for (let i = y; i >= 1975; i--) out.push(String(i));
  return out;
}

const YEARS = yearOptions();

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function markFilled(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  if ("value" in el && String(el.value).length > 0) el.classList.add("pw-filled");
  else el.classList.remove("pw-filled");
  el.classList.remove("pw-invalid");
}

export function PwRow({
  cols,
  grow,
  children,
}: {
  cols: 1 | 2 | 3;
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`pw-row pw-cols-${cols}${grow ? " pw-grow" : ""}`}>
      {children}
    </div>
  );
}

export function PwField({
  label,
  required,
  verified,
  counter,
  helper,
  error,
  htmlFor,
  icon,
  area,
  inlineCheck,
  children,
}: {
  label?: string;
  required?: boolean;
  verified?: boolean;
  counter?: string;
  helper?: string;
  error?: string | null;
  htmlFor?: string;
  icon?: ReactNode;
  area?: boolean;
  inlineCheck?: boolean;
  children: ReactNode;
}) {
  const className = [
    "pw-field",
    icon ? "pw-field-linked" : "",
    area ? "pw-field-area" : "",
    inlineCheck ? "pw-field-inline-check" : "",
    error ? "pw-has-error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      {icon ? <span className="pw-field-icon">{icon}</span> : null}
      {label ? (
        <div className="pw-field-top">
          <label htmlFor={htmlFor}>
            {label}
            {required ? (
              <span className="pw-req" aria-hidden>
                *
              </span>
            ) : null}
          </label>
          {verified ? <span className="pw-verified">Verified</span> : null}
          {counter ? <span className="pw-counter">{counter}</span> : null}
        </div>
      ) : null}
      {children}
      {helper ? <div className="pw-helper">{helper}</div> : null}
      <div className="pw-error-msg">{error ?? "This field is required."}</div>
    </div>
  );
}

export const PwInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function PwInput({ className, onInput, onChange, ...props }, ref) {
  return (
    <input
      {...props}
      ref={ref}
      className={className}
      onInput={(e) => {
        markFilled(e.currentTarget);
        onInput?.(e);
      }}
      onChange={(e) => {
        markFilled(e.currentTarget);
        onChange?.(e);
      }}
    />
  );
});

export const PwTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function PwTextarea({ className, onInput, onChange, ...props }, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={className}
      onInput={(e) => {
        markFilled(e.currentTarget);
        onInput?.(e);
      }}
      onChange={(e) => {
        markFilled(e.currentTarget);
        onChange?.(e);
      }}
    />
  );
});

export const PwSelect = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function PwSelect({ className, onChange, children, ...props }, ref) {
  return (
    <select
      {...props}
      ref={ref}
      className={className}
      onChange={(e) => {
        markFilled(e.currentTarget);
        onChange?.(e);
      }}
    >
      {children}
    </select>
  );
});

export function PwMonthYear({
  monthId,
  yearId,
  monthName,
  yearName,
  month,
  year,
  onMonthChange,
  onYearChange,
  disabled,
  invalid,
}: {
  monthId?: string;
  yearId?: string;
  monthName?: string;
  yearName?: string;
  month: number | null;
  year: number | null;
  onMonthChange: (v: number | null) => void;
  onYearChange: (v: number | null) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className="pw-date-pair">
      <select
        id={monthId}
        name={monthName}
        aria-label="Month"
        disabled={disabled}
        className={invalid && month === null ? "pw-invalid" : undefined}
        value={month === null ? "" : String(month)}
        onChange={(e) => {
          const v = e.target.value;
          onMonthChange(v === "" ? null : Number(v));
        }}
      >
        <option value="">MM</option>
        {MONTHS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select
        id={yearId}
        name={yearName}
        aria-label="Year"
        disabled={disabled}
        className={invalid && year === null ? "pw-invalid" : undefined}
        value={year === null ? "" : String(year)}
        onChange={(e) => {
          const v = e.target.value;
          onYearChange(v === "" ? null : Number(v));
        }}
      >
        <option value="">YYYY</option>
        {YEARS.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PwCheckbox({
  id,
  checked,
  onChange,
  children,
}: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="pw-checkbox" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

export function PwCheckGroup({
  options,
  value,
  onChange,
}: {
  options: readonly { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="pw-checkgroup">
      {options.map((o) => {
        const checked = value.includes(o.value);
        return (
          <label key={o.value} className="pw-checkbox">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, o.value]
                    : value.filter((v) => v !== o.value),
                )
              }
            />
            <span>{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export function PwTogglePanel({
  id,
  title,
  text,
  checked,
  onChange,
}: {
  id?: string;
  title: string;
  text: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const autoId = useId();
  const switchId = id ?? autoId;
  return (
    <div className="pw-toggle-panel">
      <div className="pw-toggle-copy">
        <div className="pw-toggle-title">{title}</div>
        <div className="pw-toggle-text">{text}</div>
      </div>
      <label className="pw-switch" htmlFor={switchId}>
        <input
          id={switchId}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span />
      </label>
    </div>
  );
}

export function PwTags({
  id,
  values,
  onChange,
  placeholder,
  helper,
  noAddButton,
  quickAdds,
  emptyText,
}: {
  id?: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  helper?: string;
  noAddButton?: boolean;
  quickAdds?: readonly string[];
  emptyText?: string;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const v = raw.trim();
    if (!v) return;
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      onChange([...values, v]);
    }
    setDraft("");
  }

  return (
    <div>
      <div className="pw-tag-input-row">
        <input
          id={id}
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            }
          }}
        />
        {noAddButton ? null : (
          <button
            type="button"
            className="pw-tag-add"
            aria-label="Add"
            onClick={() => add(draft)}
          >
            <PlusIcon />
          </button>
        )}
      </div>
      {helper ? <div className="pw-helper">{helper}</div> : null}
      {quickAdds && quickAdds.length > 0 ? (
        <div className="pw-quick-adds">
          <div className="pw-quick-label">Quick adds</div>
          <div className="pw-quick-row">
            {quickAdds.map((q) => (
              <button
                key={q}
                type="button"
                className="pw-quick-chip"
                onClick={() => add(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className={`pw-tag-list${emptyText ? " pw-tag-list-boxed" : ""}`}>
        {values.length === 0 && emptyText ? (
          <div className="pw-tag-empty">{emptyText}</div>
        ) : (
          values.map((t) => (
            <span key={t} className="pw-tag-chip">
              <span>{t}</span>
              <button
                type="button"
                className="pw-tag-remove"
                aria-label={`Remove ${t}`}
                onClick={() => onChange(values.filter((x) => x !== t))}
              >
                <CloseIcon />
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

export function PwEntryCard({
  index,
  title,
  onRemove,
  children,
}: {
  index: number;
  title: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="pw-entry">
      <div className="pw-entry-head">
        <div className="pw-entry-title">
          {title} {index + 1}
        </div>
        <button
          type="button"
          className="pw-entry-remove"
          aria-label={`Remove ${title.toLowerCase()} ${index + 1}`}
          onClick={onRemove}
        >
          <CloseIcon />
        </button>
      </div>
      {children}
    </div>
  );
}

export function PwAddMore({
  onClick,
  children = "+ Add More",
}: {
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button type="button" className="pw-add-more" onClick={onClick}>
      {children}
    </button>
  );
}

export function PwNote({
  muted,
  children,
}: {
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={muted ? "pw-note pw-note-muted" : "pw-note"}>{children}</div>
  );
}

/**
 * Inert (D5): holds the File in local state and submits nothing.
 * Wiring (upload + profile autofill) is a later plan.
 */
export function PwFileDrop({
  id,
  accept = ".pdf,.doc,.docx",
  maxSizeMB = 5,
  hint = "PDF or DOCX — up to 5 MB. Drop a file here or browse.",
}: {
  id?: string;
  accept?: string;
  maxSizeMB?: number;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const autoId = useId();
  const inputId = id ?? autoId;

  function acceptFile(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    const okType = accept.split(",").some((ext) =>
      f.name.toLowerCase().endsWith(ext.trim().toLowerCase()),
    );
    if (!okType) {
      setError("Use a PDF or DOCX file.");
      return;
    }
    const maxBytes = maxSizeMB * 1024 * 1024;
    if (f.size > maxBytes) {
      setError(
        `That file is ${formatBytes(f.size)}. The limit is ${maxSizeMB} MB.`,
      );
      return;
    }
    setError(null);
    setFile({ name: f.name, size: f.size });
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    acceptFile(e.target.files);
  }

  return (
    <PwField
      label="Resume"
      htmlFor={inputId}
      helper="Saved when resume upload ships"
      error={error}
    >
      <div
        className={[
          "pw-file-drop",
          dragging ? "pw-dragging" : "",
          file ? "pw-has-file" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          acceptFile(e.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="pw-file-input"
          accept={accept}
          onChange={onInputChange}
        />
        {file ? (
          <div className="pw-file-body">
            <span className="pw-file-icon pw-file-icon-doc">
              <FileIcon />
            </span>
            <span className="pw-file-copy">
              <span className="pw-file-title">{file.name}</span>
              <span className="pw-file-hint">{formatBytes(file.size)} · uploaded</span>
            </span>
            <button
              type="button"
              className="pw-file-browse"
              onClick={() => inputRef.current?.click()}
            >
              Replace
            </button>
            <button
              type="button"
              className="pw-file-remove"
              aria-label="Remove resume"
              onClick={() => {
                setFile(null);
                setError(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              <CloseIcon />
            </button>
          </div>
        ) : (
          <div className="pw-file-body">
            <span className="pw-file-icon">
              <UploadIcon />
            </span>
            <span className="pw-file-copy">
              <span className="pw-file-title">Upload your resume</span>
              <span className="pw-file-hint">{hint}</span>
            </span>
            <button
              type="button"
              className="pw-file-browse"
              onClick={() => inputRef.current?.click()}
            >
              Browse
            </button>
          </div>
        )}
      </div>
    </PwField>
  );
}
