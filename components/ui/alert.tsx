import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";

const toneMap = {
  info: { wrapper: "border-info-600/20 bg-info-50 text-info-600", Icon: Info },
  success: { wrapper: "border-success-600/20 bg-success-50 text-success-700", Icon: CheckCircle2 },
  warning: { wrapper: "border-warning-600/25 bg-warning-50 text-warning-600", Icon: AlertTriangle },
  danger: { wrapper: "border-danger-600/20 bg-danger-50 text-danger-700", Icon: ShieldAlert },
} as const;

export type AlertTone = keyof typeof toneMap;

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { wrapper, Icon } = toneMap[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", wrapper, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-ink-muted">{children}</div> : null}
      </div>
    </div>
  );
}
