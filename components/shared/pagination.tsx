import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * URL-driven pagination for server-rendered tables. Keeps filters intact and is
 * crawler-neutral (no client state).
 */
export function Pagination({
  page,
  pageSize,
  total,
  baseHref,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  baseHref: string;
  params: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const buildHref = (targetPage: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    if (targetPage > 1) search.set("page", String(targetPage));
    const query = search.toString();
    return query ? `${baseHref}?${query}` : baseHref;
  };

  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
      <p className="text-[0.6875rem] text-ink-subtle">
        Showing {firstRow}–{lastRow} of {total}
      </p>
      <nav className="flex items-center gap-1.5" aria-label="Pagination">
        {page > 1 ? (
          <Link href={buildHref(page - 1)} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <ChevronLeft aria-hidden /> Previous
          </Link>
        ) : (
          <span className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "pointer-events-none opacity-50")}>
            <ChevronLeft aria-hidden /> Previous
          </span>
        )}
        <span className="px-1 text-[0.6875rem] text-ink-muted">
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? (
          <Link href={buildHref(page + 1)} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Next <ChevronRight aria-hidden />
          </Link>
        ) : (
          <span className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "pointer-events-none opacity-50")}>
            Next <ChevronRight aria-hidden />
          </span>
        )}
      </nav>
    </div>
  );
}
