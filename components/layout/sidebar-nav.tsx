"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { NAV_ICONS } from "@/components/navigation/nav-icons";
import type { NavGroup } from "@/config/navigation.config";
import { cn } from "@/lib/utils";

export function SidebarNav({
  groups,
  collapsed,
  onNavigate,
}: {
  groups: NavGroup[];
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-2 py-3">
      {groups.map((group) => (
        <div key={group.label}>
          {!collapsed ? (
            <p className="px-2 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-subtle">
              {group.label}
            </p>
          ) : (
            <div className="mx-2 mb-1.5 border-t border-border" aria-hidden />
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              const active =
                pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-brand-50 font-semibold text-brand-800"
                        : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <Icon
                      className={cn("size-4 shrink-0", active ? "text-brand-700" : "text-ink-subtle")}
                      aria-hidden
                    />
                    {!collapsed ? (
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span className="truncate">{item.label}</span>
                        {item.status === "planned" ? (
                          <Badge tone="neutral" className="px-1.5 py-0 text-[0.625rem]">
                            Later
                          </Badge>
                        ) : null}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
