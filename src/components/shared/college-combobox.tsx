"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type CollegeOption = {
  id: string;
  name: string;
  state: string | null;
  district: string | null;
};

type Props = {
  id?: string;
  value: string;
  onChange: (name: string, collegeId: string | null) => void;
  placeholder?: string;
  "aria-invalid"?: boolean;
};

const INPUT_CLASS =
  "h-10 w-full min-w-0 rounded-xl border border-input bg-transparent px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-input focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

type SearchEnvelope =
  | { ok: true; data: CollegeOption[] }
  | { ok: false; message: string };

function isSearchEnvelope(value: unknown): value is SearchEnvelope {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return false;
  }
  const envelope = value as { ok: unknown };
  if (envelope.ok === true && "data" in envelope) {
    return Array.isArray((envelope as { data: unknown }).data);
  }
  return envelope.ok === false;
}

export function CollegeCombobox({
  id,
  value,
  onChange,
  placeholder,
  "aria-invalid": ariaInvalid,
}: Props) {
  const [results, setResults] = useState<CollegeOption[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const queryRef = useRef(value);
  const highlightedRef = useRef<CollegeOption | null>(null);
  const visibleResults = value.trim().length < 2 ? [] : results;

  useEffect(() => {
    queryRef.current = value;
    const q = value.trim();
    if (q.length < 2) {
      abortRef.current?.abort();
      return;
    }

    const handle = window.setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requested = value;

      fetch(`/api/colleges/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (res) => {
          const json: unknown = await res.json();
          if (!isSearchEnvelope(json) || json.ok !== true) return;
          if (queryRef.current !== requested) return;
          setResults(json.data);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (err instanceof Error && err.name === "AbortError") return;
        });
    }, 250);

    return () => {
      window.clearTimeout(handle);
    };
  }, [value]);

  return (
    <Autocomplete.Root
      mode="none"
      filter={null}
      items={visibleResults}
      value={value}
      itemToStringValue={(item) => item.name}
      onItemHighlighted={(item) => {
        highlightedRef.current = item ?? null;
      }}
      onValueChange={(text, details) => {
        if (details.reason === "item-press") {
          const item = highlightedRef.current;
          onChange(item?.name ?? text, item?.id ?? null);
          return;
        }
        onChange(text, null);
      }}
    >
      <Autocomplete.Input
        id={id}
        placeholder={placeholder}
        aria-invalid={ariaInvalid}
        autoComplete="nope"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        data-lpignore="true"
        data-1p-ignore=""
        className={INPUT_CLASS}
      />
      <Autocomplete.Portal>
        <Autocomplete.Positioner
          className="isolate z-50"
          sideOffset={4}
          align="start"
        >
          <Autocomplete.Popup
            className={cn(
              "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            )}
          >
            <Autocomplete.Empty className="px-2 py-1.5 text-sm text-muted-foreground">
              {value.trim()
                ? `No match — press Enter to use "${value}"`
                : null}
            </Autocomplete.Empty>
            <Autocomplete.List>
              {(item: CollegeOption) => {
                const secondary = [
                  item.state,
                  item.district && item.district !== item.state
                    ? item.district
                    : null,
                ]
                  .filter((part): part is string => Boolean(part))
                  .join(" · ");
                return (
                  <Autocomplete.Item
                    key={item.id}
                    value={item}
                    className="relative flex w-full cursor-default flex-col gap-0.5 rounded-md py-1.5 pr-2 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                    onClick={() => onChange(item.name, item.id)}
                  >
                    <span>{item.name}</span>
                    {secondary ? (
                      <span className="text-xs text-muted-foreground">
                        {secondary}
                      </span>
                    ) : null}
                  </Autocomplete.Item>
                );
              }}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
