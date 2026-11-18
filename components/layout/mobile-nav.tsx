"use client";

import * as React from "react";
import { Menu, X } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import type { NavGroup } from "@/config/navigation.config";

export function MobileNav({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="rounded-md p-2 text-ink-muted hover:bg-surface-sunken hover:text-ink"
      >
        <Menu className="size-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-brand-950/40" onClick={() => setOpen(false)} aria-hidden />
          <div className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col bg-surface shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-3">
              <BrandMark />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-1.5 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>
            <SidebarNav groups={groups} collapsed={false} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
