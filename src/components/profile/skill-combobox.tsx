"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type SkillOption = {
  id: string;
  name: string;
  slug: string;
  categoryName: string | null;
};

const INPUT_CLASS =
  "h-10 w-full min-w-0 rounded-xl border border-input bg-transparent px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-input focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80";

type SearchEnvelope =
  | { ok: true; data: SkillOption[] }
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

/**
 * Typeahead over the canonical skill catalog.
 *
 * Selection only — there is no "create" path. Skills must come from `Skill` so
 * that slug and alias normalization keeps "Python", "python" and "Python 3"
 * from becoming three separate things a recruiter has to search for
 * individually.
 */
export function SkillCombobox({
  id,
  excludeIds,
  onSelect,
  placeholder = "Search for skills",
}: {
  id?: string;
  excludeIds: readonly string[];
  onSelect: (skill: SkillOption) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillOption[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const queryRef = useRef("");

  const exclude = new Set(excludeIds);
  const visible =
    query.trim().length < 1 ? [] : results.filter((r) => !exclude.has(r.id));

  useEffect(() => {
    queryRef.current = query;
    const q = query.trim();
    if (q.length < 1) {
      // No setState here: `visible` already returns [] for a short query, so
      // clearing would only trigger a second render for the same output.
      abortRef.current?.abort();
      return;
    }

    const handle = window.setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requested = query;

      fetch(`/api/skills/search?q=${encodeURIComponent(q)}`, {
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
    }, 200);

    return () => {
      window.clearTimeout(handle);
    };
  }, [query]);

  function choose(skill: SkillOption) {
    onSelect(skill);
    setQuery("");
    setResults([]);
  }

  return (
    <Autocomplete.Root
      mode="none"
      filter={null}
      items={visible}
      value={query}
      itemToStringValue={(item) => item.name}
      onValueChange={(text) => setQuery(text)}
    >
      <Autocomplete.Input
        id={id}
        placeholder={placeholder}
        autoComplete="nope"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
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
              "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10",
            )}
          >
            <Autocomplete.Empty className="px-2 py-1.5 text-sm text-muted-foreground">
              {query.trim() ? "No matching skill in the catalog" : null}
            </Autocomplete.Empty>
            <Autocomplete.List>
              {(item: SkillOption) => (
                <Autocomplete.Item
                  key={item.id}
                  value={item}
                  className="relative flex w-full cursor-default items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  onClick={() => choose(item)}
                >
                  <span>{item.name}</span>
                  {item.categoryName ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {item.categoryName}
                    </span>
                  ) : null}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
