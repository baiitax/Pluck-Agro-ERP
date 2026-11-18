"use client";

import * as React from "react";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useServerForm } from "@/components/forms/use-server-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";

/**
 * A form bound to a server action.
 *
 * Validation errors come back from the server already shaped (`details` keyed by field), so this
 * component shows them next to the field and as a summary. Nothing is validated only in the browser:
 * the same Zod schema runs again on the server, and the database checks the rules a third time.
 */
export function ActionForm<T = unknown>({
  action,
  children,
  submitLabel = "Save",
  successMessage,
  redirectTo,
  hidden,
  className,
  onSuccess,
  disabled,
  disabledHint,
}: {
  action: (previous: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
  children: React.ReactNode;
  submitLabel?: string;
  successMessage?: string;
  redirectTo?: string;
  hidden?: Record<string, string>;
  className?: string;
  onSuccess?: (data: T) => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const router = useRouter();
  const { state, isPending, run } = useServerForm(action, (result) => {
    if (result.ok) {
      toast.success(successMessage ?? "Saved.");
      onSuccess?.(result.data);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } else {
      toast.error(result.error.message);
    }
  });

  const details = state && !state.ok ? (state.error.details ?? {}) : {};
  const errorKeys = Object.keys(details);

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        run(new FormData(event.currentTarget));
      }}
    >
      {hidden
        ? Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)
        : null}

      {state && !state.ok ? (
        <div className="mb-3">
          <Alert tone="danger" title="That could not be saved">
            <p>{state.error.message}</p>
            {errorKeys.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                {errorKeys.map((key) => (
                  <li key={key}>
                    <span className="font-medium">{key}</span>: {details[key]?.join("; ")}
                  </li>
                ))}
              </ul>
            ) : null}
          </Alert>
        </div>
      ) : null}

      {children}

      <div className="mt-4 flex items-center justify-end gap-2">
        {disabled && disabledHint ? <p className="mr-auto text-xs text-ink-subtle">{disabledHint}</p> : null}
        <Button type="submit" disabled={isPending || disabled}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** A single-button action (submit, post, close) that posts one hidden field set. */
export function ActionButton<T = unknown>({
  action,
  fields,
  label,
  pendingLabel,
  variant = "primary",
  size = "sm",
  confirmMessage,
  successMessage,
}: {
  action: (previous: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  confirmMessage?: string;
  successMessage?: string;
}) {
  const router = useRouter();
  const { isPending, run } = useServerForm(action, (result) => {
    if (result.ok) {
      toast.success(successMessage ?? "Done.");
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  });

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      disabled={isPending}
      onClick={() => {
        if (confirmMessage && !window.confirm(confirmMessage)) return;
        const formData = new FormData();
        for (const [key, value] of Object.entries(fields)) formData.set(key, value);
        run(formData);
      }}
    >
      {isPending ? (pendingLabel ?? "Working…") : label}
    </Button>
  );
}
