"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string };

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ProgramNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Program navigation"
      className="flex min-w-0 flex-1 items-center gap-0.5 md:gap-1"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors md:px-3 md:py-2 md:text-sm",
              active
                ? "bg-[#FFECE3] text-[#E05226]"
                : "text-[#4B4B4B] hover:bg-[#FBF9F7] hover:text-[#111111]",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
