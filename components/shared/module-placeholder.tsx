import Link from "next/link";
import { CircleDashed, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";

/**
 * Honest placeholder for modules scheduled for later phases.
 *
 * Phase 0 deliberately does not render fake dashboards, sample KPIs or inert buttons for
 * functionality that does not exist.
 */
export function ModulePlaceholder({
  title,
  description,
  scope,
  permission,
  plannedPhase,
}: {
  title: string;
  description: string;
  scope: string[];
  permission: string;
  plannedPhase: string;
}) {
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: title }]}
        badge={
          <Badge tone="pending" dot>
            Not implemented
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-subtle">
              <CircleDashed className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">This module arrives in {plannedPhase}</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-muted">
                Delivered so far: identity and governance, master data, procurement, inventory and production,
                and quality management. Business workflows are built on that foundation so that financial and
                inventory postings are transactional and auditable from day one.
              </p>
              <p className="mt-3 text-xs font-medium text-ink-subtle">Required permission: {permission}</p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink">Planned scope</h2>
          <ul className="mt-2 space-y-1.5 text-xs text-ink-muted">
            {scope.map((item) => (
              <li key={item} className="flex gap-2">
                <Lock className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-4 w-full")}
          >
            Back to dashboard
          </Link>
        </Card>
      </div>
    </div>
  );
}
