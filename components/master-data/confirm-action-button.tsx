"use client";

import * as React from "react";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useServerForm } from "@/components/forms/use-server-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Label, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/errors";

/**
 * Destructive or reasoning action behind a confirmation.
 *
 * Master-data records are deactivated or de-linked rather than hard-deleted, so the confirmation
 * explains the consequence and, where the server demands it, collects a reason.
 */
export function ConfirmActionButton<T = undefined>({
  action,
  label,
  title,
  description,
  confirmLabel = "Confirm",
  hidden,
  reasonRequired = false,
  variant = "ghost",
}: {
  action: (previous: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
  label: string;
  title: string;
  description: string;
  confirmLabel?: string;
  hidden: Record<string, string>;
  reasonRequired?: boolean;
  variant?: "ghost" | "secondary" | "danger";
}) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(action, (result) => {
    if (result.ok) {
      toast.success("Done.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });
  const errors = state && !state.ok ? (state.error.details ?? {}) : {};
  const formId = React.useId();

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)} aria-label={label}>
        <Trash2 aria-hidden /> {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form={formId} disabled={isPending}>
              {isPending ? "Working…" : confirmLabel}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            run(new FormData(event.currentTarget));
          }}
          className="space-y-3"
        >
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {reasonRequired ? (
            <div>
              <Label htmlFor={`${formId}-reason`}>
                Reason<span className="text-danger-600"> *</span>
              </Label>
              <Textarea id={`${formId}-reason`} name="reason" rows={2} required />
              <FieldHint>Stored with the change and in the audit trail.</FieldHint>
              <FieldError message={errors.reason?.[0]} />
            </div>
          ) : null}
        </form>
      </Dialog>
    </>
  );
}
