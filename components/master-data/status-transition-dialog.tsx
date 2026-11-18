"use client";

import * as React from "react";

import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";

import { useServerForm } from "@/components/forms/use-server-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Label, Select, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/errors";

export type TransitionOption = { value: string; label: string; hint?: string };

/**
 * Status change dialog.
 *
 * The options come from the database transition table, not from a constant in the UI: if the
 * configured lifecycle does not allow a move (or the caller lacks the transition permission), the
 * server refuses it and the error is shown here.
 */
export function StatusTransitionDialog<T = undefined>({
  id,
  currentStatus,
  options,
  action,
  entityLabel,
  triggerLabel = "Change status",
}: {
  id: string;
  currentStatus: string;
  options: TransitionOption[];
  action: (previous: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
  entityLabel: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [next, setNext] = React.useState(options[0]?.value ?? "");
  const { state, isPending, run } = useServerForm(action, (result) => {
    if (result.ok) {
      toast.success(`${entityLabel} status updated.`);
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });

  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};
  const selected = options.find((option) => option.value === next);
  const needsReason = ["blocked", "archived", "rejected", "inactive", "discontinued"].includes(next);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={options.length === 0}>
        <ArrowRightLeft aria-hidden /> {triggerLabel}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Change ${entityLabel.toLowerCase()} status`}
        description={`Currently ${currentStatus}. Only transitions allowed by the master-data lifecycle are offered, and each one requires its own permission.`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form={`status-${id}`} disabled={isPending || options.length === 0}>
              {isPending ? "Applying…" : "Apply"}
            </Button>
          </>
        }
      >
        <form
          id={`status-${id}`}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            run(new FormData(event.currentTarget));
          }}
          className="space-y-3"
        >
          <input type="hidden" name="id" value={id} />
          <div>
            <Label htmlFor={`status-${id}-next`}>New status</Label>
            <Select
              id={`status-${id}-next`}
              name="status"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {selected?.hint ? <FieldHint>{selected.hint}</FieldHint> : null}
            <FieldError message={fieldErrors.status?.[0]} />
          </div>
          <div>
            <Label htmlFor={`status-${id}-reason`}>
              Reason{needsReason ? <span className="text-danger-600"> *</span> : null}
            </Label>
            <Textarea
              id={`status-${id}-reason`}
              name="reason"
              rows={2}
              placeholder="Recorded in the change history and the audit trail."
              required={needsReason}
            />
            <FieldHint>Every status change is written to master-data change history and the audit log.</FieldHint>
            <FieldError message={fieldErrors.reason?.[0]} />
          </div>
        </form>
      </Dialog>
    </>
  );
}
