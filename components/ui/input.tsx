import * as React from "react";

import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-9.5 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink shadow-xs",
        "placeholder:text-ink-subtle",
        "focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20",
        "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle",
        "aria-invalid:border-danger-600 aria-invalid:ring-danger-600/20",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        "flex w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-ink shadow-xs",
        "placeholder:text-ink-subtle focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-9.5 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-ink shadow-xs",
        "focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn("text-sm font-medium text-ink", className)} {...props} />
  ),
);
Label.displayName = "Label";

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs font-medium text-danger-600">
      {message}
    </p>
  );
}

export function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink-subtle">{children}</p>;
}
