import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: "neutral" | "brand" | "pending" | "danger";
}) {
  const toneClasses = {
    neutral: "bg-surface-muted text-ink-muted",
    brand: "bg-brand-50 text-brand-700",
    pending: "bg-pending-50 text-pending-600",
    danger: "bg-danger-50 text-danger-600",
  } as const;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-muted">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">{value}</p>
          {hint ? <p className="mt-1 text-[0.6875rem] text-ink-subtle">{hint}</p> : null}
        </div>
        {Icon ? (
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", toneClasses[tone])}>
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
      </div>
    </Card>
  );
}
