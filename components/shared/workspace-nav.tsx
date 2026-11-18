"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export type WorkspaceLink = { label: string; href: string };

/**
 * Secondary navigation for a workspace. Only links the caller may open are passed in, so the bar never
 * offers a section that will refuse to render.
 */
export function WorkspaceNav({ links, label = "Sections" }: { links: WorkspaceLink[]; label?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label={`${label} sections`} className="erp-card flex flex-wrap gap-1 p-1.5">
      {links.map((link) => {
        const active =
          pathname === link.href || (link.href !== "/procurement" && pathname.startsWith(`${link.href}/`));
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
