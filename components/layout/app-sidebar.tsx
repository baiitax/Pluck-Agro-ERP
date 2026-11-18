"use client";

import * as React from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import type { NavGroup } from "@/config/navigation.config";

export function AppSidebar({ groups, version }: { groups: NavGroup[]; version: string }) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <aside
      className="hidden shrink-0 border-r border-border bg-surface md:flex md:flex-col"
      style={{ width: collapsed ? 68 : 264 }}
      data-collapsed={collapsed}
    >
      <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-3">
        <BrandMark collapsed={collapsed} />
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="rounded-md p-1.5 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      <SidebarNav groups={groups} collapsed={collapsed} />

      <div className="border-t border-border px-3 py-2">
        {!collapsed ? (
          <p className="text-[0.6875rem] text-ink-subtle">v{version} · Phase 0 foundation</p>
        ) : (
          <p className="text-center text-[0.625rem] text-ink-subtle">v{version}</p>
        )}
      </div>
    </aside>
  );
}
