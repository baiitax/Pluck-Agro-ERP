"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export type WorkspaceLink = { label: string; href: string };

/** Secondary navigation for the master-data workspace. Only links the caller may open are passed in. */
export function MasterDataNav({ links }: { links: WorkspaceLink[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Master data sections" className="erp-card flex flex-wrap gap-1 p-1.5">
      {links.map((link) => {
        const active = pathname === link.href || (link.href !== "/master-data" && pathname.startsWith(`${link.href}/`));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-brand-50 text-brand-800" : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
