"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";
import { signOutAction } from "@/app/actions/auth-actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RecruiterAccountSnapshot } from "@/features/hire/recruiter-account-types";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0] + parts[1]![0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

export function RecruiterAccountMenu({
  account,
}: {
  account: RecruiterAccountSnapshot;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label="Open recruiter menu"
        className={cn(
          "hire-account",
          "inline-flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 text-sm outline-none",
        )}
      >
        <Avatar className="hire-account__avatar size-8">
          <AvatarFallback>{initials(account.fullName)}</AvatarFallback>
        </Avatar>
        <span className="hire-account__who">
          <span className="max-w-[140px] truncate font-medium">
            {account.fullName}
          </span>
          <span className="hire-account__sub max-w-[160px] truncate text-xs">
            {account.company}
          </span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="hire-app hire-menu">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-foreground">
                {account.fullName}
              </span>
              <span className="truncate text-xs">
                {account.company}
              </span>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem
            render={<Link href="/hire/requests" />}
            className="cursor-pointer hire-menu__link"
          >
            {account.requestCount > 0
              ? `${account.requestCount} request${account.requestCount === 1 ? "" : "s"}`
              : "Open requests"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        <form action={signOutAction} className="p-1">
          <button
            type="submit"
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            Sign out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
