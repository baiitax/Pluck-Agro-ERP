import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-neutral-600/20 bg-neutral-50 text-neutral-600",
        success: "border-success-600/25 bg-success-50 text-success-700",
        pending: "border-pending-600/25 bg-pending-50 text-pending-700",
        warning: "border-warning-600/25 bg-warning-50 text-warning-600",
        danger: "border-danger-600/25 bg-danger-50 text-danger-700",
        info: "border-info-600/25 bg-info-50 text-info-600",
        brand: "border-brand-600/25 bg-brand-50 text-brand-800",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Non-colour indicator so status is never conveyed by colour alone. */
  dot?: boolean;
}

export function Badge({ className, tone, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
