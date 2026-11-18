import type { ReactNode } from "react";

import { Breadcrumbs, type Crumb } from "@/components/shared/breadcrumbs";

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  badge,
}: {
  title: string;
  description?: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="mb-5 border-b border-border pb-4">
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
            {badge}
          </div>
          {description ? <p className="mt-1 max-w-3xl text-sm text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
