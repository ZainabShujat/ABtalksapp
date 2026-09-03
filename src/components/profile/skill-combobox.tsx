"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { useEffect, useRef, useState } from "react";

export type SkillOption = {
  id: string;
  name: string;
  slug: string;
  categoryName: string | null;
};

const OTHER_ID = "__other__";

const OTHER_ITEM: SkillOption = {
  id: OTHER_ID,
  name: "Other",
  slug: OTHER_ID,
  categoryName: null,
};

function isOther(item: SkillOption): boolean {
  return item.id === OTHER_ID;
}

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

function isExcluded(
  skill: SkillOption,
  excludeIds: ReadonlySet<string>,
  excludeNames: ReadonlySet<string>,
): boolean {
  if (skill.id && excludeIds.has(skill.id)) return true;
  return excludeNames.has(skill.name.toLowerCase());
}

/**
 * Typeahead over the canonical skill catalog, plus a curated empty-query list.
 *
 * Selection of catalog rows only — "Other" is a UI switch, not a skill.
 */
export function SkillCombobox({
  id,
  catalog,
  excludeIds,
  excludeNames,
  onSelect,
  onOther,
  placeholder = "Search for skills",
}: {
  id?: string;
  catalog: readonly SkillOption[];
  excludeIds: readonly string[];
  excludeNames: readonly string[];
  onSelect: (skill: SkillOption) => void;
  onOther: () => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillOption[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const queryRef = useRef("");

  const idSet = new Set(excludeIds.filter((x) => x.length > 0));
  const nameSet = new Set(excludeNames.map((n) => n.toLowerCase()));

  const q = query.trim().toLowerCase();
  const listed: SkillOption[] = (() => {
    if (q.length < 1) {
      return catalog.filter((s) => !isExcluded(s, idSet, nameSet));
    }
    const fromCatalog = catalog.filter(
      (s) =>
        !isExcluded(s, idSet, nameSet) &&
        s.name.toLowerCase().includes(q),
    );
    const fromApi = results.filter((s) => !isExcluded(s, idSet, nameSet));
    const out: SkillOption[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    for (const s of [...fromApi, ...fromCatalog]) {
      const nameKey = s.name.toLowerCase();
      if (s.id) {
        if (seenIds.has(s.id)) continue;
        seenIds.add(s.id);
      } else if (seenNames.has(nameKey)) {
        continue;
      }
      seenNames.add(nameKey);
      out.push(s);
    }
    // Prefer rows that already have a catalog id when both shapes exist.
    return out.sort((a, b) => {
      if (Boolean(a.id) !== Boolean(b.id)) return a.id ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  })();

  const visible = [...listed, OTHER_ITEM];

  useEffect(() => {
    queryRef.current = query;
    const q = query.trim();
    if (q.length < 1) {
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
    if (isOther(skill)) {
      onOther();
      setQuery("");
      setResults([]);
      return;
    }
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
        className="pw-skill-search"
      />
      <Autocomplete.Portal>
        <Autocomplete.Positioner
          className="isolate z-50"
          sideOffset={4}
          align="start"
        >
          <Autocomplete.Popup className="pw-skill-popup relative isolate z-50 w-(--anchor-width) min-w-36 origin-(--transform-origin)">
            {listed.length === 0 && query.trim() ? (
              <div className="pw-skill-empty">
                No matching skill in the catalog
              </div>
            ) : null}
            <Autocomplete.List>
              {(item: SkillOption) => (
                <Autocomplete.Item
                  key={item.id || item.name}
                  value={item}
                  className="pw-skill-option"
                  onClick={() => choose(item)}
                >
                  <span>{item.name}</span>
                  {item.categoryName && !isOther(item) ? (
                    <span className="pw-skill-option-cat">
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
