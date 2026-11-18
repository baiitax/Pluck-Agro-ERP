import { Leaf } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Temporary text-based brand treatment.
 *
 * No official Pluck Agro logo asset was available in the repository, so Phase 0 ships a
 * clean placeholder mark that can be replaced by dropping `logo.svg` into
 * `public/branding/` and swapping this component. The mark is intentionally simple rather
 * than an invented logo.
 */
export function BrandMark({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-white shadow-sm"
      >
        <Leaf className="size-5" />
      </span>
      {!collapsed ? (
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold tracking-tight text-ink">Pluck Agro</span>
          <span className="block text-[0.6875rem] font-medium uppercase tracking-wider text-ink-subtle">
            ERP Platform
          </span>
        </span>
      ) : null}
    </div>
  );
}
