import Link from "next/link";

import { cn } from "@/lib/utils";

export type SectionTab = { key: string; label: string; count?: number };

/** URL-driven tabs. Each tab is a real link, so it survives refresh, sharing and no-JS. */
export function SectionTabs({ base, active, tabs }: { base: string; active: string; tabs: SectionTab[] }) {
  return (
    <div className="erp-card overflow-x-auto">
      <nav aria-label="Record sections" className="flex min-w-max gap-1 p-1.5">
        {tabs.map((tab) => {
          const href = tab.key === "overview" ? base : `${base}?tab=${tab.key}`;
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                isActive ? "bg-brand-50 text-brand-800" : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
              )}
            >
              {tab.label}
              {typeof tab.count === "number" ? (
                <span className="rounded bg-surface-sunken px-1 text-[0.625rem] text-ink-subtle">{tab.count}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
