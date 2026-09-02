"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  HubSearchGroup,
  HubSearchItem,
} from "@/features/dashboard/hub-search-index";

const GROUPS: HubSearchGroup[] = [
  "Pages",
  "Continue",
  "Challenges",
  "Interviews",
  "Prep Kit",
  "Events",
  "FAQ",
];

type DashboardSearchProps = {
  items: HubSearchItem[];
};

function matchesItem(item: HubSearchItem, query: string): boolean {
  const hay = `${item.title} ${item.subtitle ?? ""} ${item.keywords}`.toLowerCase();
  return hay.includes(query);
}

function isExternalHref(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://");
}

export function DashboardSearch({ items }: DashboardSearchProps) {
  const router = useRouter();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const normalized = query.trim().toLowerCase();
  const showPanel = open && normalized.length > 0;

  const matches = useMemo(() => {
    if (!normalized) return [];
    return items.filter((item) => matchesItem(item, normalized));
  }, [items, normalized]);

  const grouped = useMemo(() => {
    let offset = 0;
    return GROUPS.flatMap((group) => {
      const groupItems = matches.filter((item) => item.group === group);
      if (groupItems.length === 0) return [];
      const start = offset;
      offset += groupItems.length;
      return [{ group, items: groupItems, start }];
    });
  }, [matches]);

  const flat = useMemo(
    () => grouped.flatMap((entry) => entry.items),
    [grouped],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [normalized]);

  useEffect(() => {
    if (!showPanel) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showPanel]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      if (href.startsWith("#")) {
        const el = document.getElementById(href.slice(1));
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        window.history.replaceState(null, "", href);
        return;
      }
      if (isExternalHref(href)) {
        window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      router.push(href);
    },
    [router],
  );

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!showPanel || flat.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = flat[activeIndex] ?? flat[0];
      if (target) go(target.href);
    }
  }

  return (
    <div ref={rootRef} className="relative hidden md:block">
      <div className="group relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[#8F8F8F] group-focus-within:text-[#E05226]"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search Dashboard"
          aria-label="Search Dashboard"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-activedescendant={
            showPanel && flat[activeIndex] ? `${listId}-${flat[activeIndex].id}` : undefined
          }
          autoComplete="off"
          className="h-9 w-[250px] appearance-none rounded-md border border-neutral-200 bg-transparent py-0 pr-3 pl-9 text-sm text-[#111111] outline-none placeholder:font-normal placeholder:text-[#8F8F8F] focus:border-[#E05226] focus:ring-0 group-focus-within:border-[#E05226] [&::-webkit-search-cancel-button]:hidden"
        />
      </div>

      {showPanel ? (
        <div
          id={listId}
          role="listbox"
          className="scrollbar-program-orange absolute right-0 z-50 mt-1.5 max-h-72 min-w-[320px] overflow-y-auto rounded-lg border border-neutral-200 bg-[#FBF9F7] py-1.5 shadow-md"
        >
          {flat.length === 0 ? (
            <p className="px-3.5 py-3 text-sm text-[#8F8F8F]">No matches</p>
          ) : (
            grouped.map((entry) => (
              <div key={entry.group}>
                <p className="px-3.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-[#8F8F8F] uppercase">
                  {entry.group}
                </p>
                {entry.items.map((item, index) => {
                  const flatIndex = entry.start + index;
                  const active = flatIndex === activeIndex;
                  return (
                    <button
                      key={item.id}
                      id={`${listId}-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(flatIndex)}
                      onClick={() => go(item.href)}
                      className={cn(
                        "flex w-full flex-col items-start px-3.5 py-2 text-left text-sm text-[#111111]",
                        active && "bg-[#e05226]/10 text-[#e05226]",
                      )}
                    >
                      <span className="line-clamp-1 font-medium">{item.title}</span>
                      {item.subtitle ? (
                        <span className="line-clamp-1 text-xs font-normal text-[#8F8F8F]">
                          {item.subtitle}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
