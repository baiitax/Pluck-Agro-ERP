"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, LogOut, UserRound } from "lucide-react";

import { getInitials } from "@/lib/utils";

export function UserMenu({
  displayName,
  email,
  roles,
  signOutAction,
}: {
  displayName: string;
  email: string;
  roles: string[];
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 hover:border-border hover:bg-surface-muted"
      >
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800"
        >
          {getInitials(displayName)}
        </span>
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-[11rem] truncate text-xs font-semibold text-ink">{displayName}</span>
          <span className="block max-w-[11rem] truncate text-[0.6875rem] text-ink-subtle">{roles[0] ?? "No role"}</span>
        </span>
        <ChevronDown className="size-3.5 text-ink-subtle" aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          <div className="border-b border-border px-3 py-2.5">
            <p className="truncate text-sm font-medium text-ink">{displayName}</p>
            <p className="truncate text-xs text-ink-subtle">{email}</p>
            {roles.length > 0 ? (
              <p className="mt-1 text-[0.6875rem] text-ink-muted">{roles.join(" · ")}</p>
            ) : null}
          </div>
          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            <UserRound className="size-4" aria-hidden /> My profile
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
