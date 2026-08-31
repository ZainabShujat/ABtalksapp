"use client";

import { useId, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MONTHS } from "@/lib/candidate-vocab";
import { cn } from "@/lib/utils";

/* ─── Field wrapper ──────────────────────────────────────────────────────── */

export function Field({
  label,
  required,
  error,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/* ─── Month + year ───────────────────────────────────────────────────────── */

export function MonthYearField({
  label,
  required,
  years,
  month,
  year,
  onMonthChange,
  onYearChange,
  disabled,
  error,
}: {
  label: string;
  required?: boolean;
  years: number[];
  month: number | null;
  year: number | null;
  onMonthChange: (v: number | null) => void;
  onYearChange: (v: number | null) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  return (
    <Field label={label} required={required} error={error}>
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={month === null ? "" : String(month)}
          onValueChange={(v) => onMonthChange(v ? Number(v) : null)}
          disabled={disabled}
        >
          <SelectTrigger aria-label={`${label} month`}>
            <SelectValue placeholder="month" />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m) => (
              <SelectItem key={m.value} value={String(m.value)}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={year === null ? "" : String(year)}
          onValueChange={(v) => onYearChange(v ? Number(v) : null)}
          disabled={disabled}
        >
          <SelectTrigger aria-label={`${label} year`}>
            <SelectValue placeholder="year" />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Field>
  );
}

/* ─── Free text with suggestions ─────────────────────────────────────────── */

/**
 * An ordinary input backed by a `<datalist>`. The vocabularies are curated
 * suggestions, never an allow-list — anything typed is accepted, so nobody is
 * blocked by a degree or job title we did not think of.
 */
export function SuggestInput({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const listId = useId();
  return (
    <>
      <Input
        id={id}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

/* ─── Chip list ──────────────────────────────────────────────────────────── */

export function ChipInput({
  values,
  onChange,
  placeholder,
  max = 20,
  suggestions,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  suggestions?: readonly string[];
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();

  function commit() {
    const parts = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const p of parts) {
      if (next.length >= max) break;
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          list={suggestions ? listId : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={placeholder}
          disabled={values.length >= max}
          autoComplete="off"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={commit}
          disabled={draft.trim() === "" || values.length >= max}
          aria-label="Add"
        >
          <Plus className="size-4" aria-hidden />
        </Button>
      </div>
      {suggestions ? (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}

      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 pr-1">
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="rounded-full p-0.5 hover:bg-foreground/10"
                aria-label={`Remove ${v}`}
              >
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ─── Repeatable row card ────────────────────────────────────────────────── */

export function RowCard({
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
    <div className="relative space-y-4 rounded-xl border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">
          {title} {index + 1}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={`Remove ${title.toLowerCase()} ${index + 1}`}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      {children}
    </div>
  );
}

/* ─── Empty state ────────────────────────────────────────────────────────── */

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/* ─── Section footer ─────────────────────────────────────────────────────── */

export function SectionActions({
  onAdd,
  addLabel,
  saving,
  saveLabel = "Save",
  disabled,
}: {
  onAdd?: () => void;
  addLabel?: string;
  saving: boolean;
  saveLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      {onAdd && addLabel ? (
        <Button type="button" variant="ghost" onClick={onAdd} className="px-2">
          <Plus className="size-4" aria-hidden />
          {addLabel}
        </Button>
      ) : (
        <span />
      )}
      <Button type="submit" disabled={saving || disabled}>
        {saving ? "Saving…" : saveLabel}
      </Button>
    </div>
  );
}
