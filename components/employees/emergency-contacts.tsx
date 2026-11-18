"use client";

import * as React from "react";

import { Loader2, Phone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/input";
import { useServerForm } from "@/components/forms/use-server-form";
import {
  addEmergencyContactAction,
  removeEmergencyContactAction,
} from "@/app/(dashboard)/administration/employees/actions";

export function AddEmergencyContactDialog({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(addEmergencyContactAction, (result) => {
    if (result.ok) {
      toast.success("Emergency contact added.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });

  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Add contact
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add an emergency contact"
        description="Emergency contact details are personal data. The audit trail records that a contact was added, never the phone number."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="emergency-contact-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Add contact
            </Button>
          </>
        }
      >
        <form id="emergency-contact-form" action={run} className="space-y-3" noValidate>
          <input type="hidden" name="employeeId" value={employeeId} />
          {state && !state.ok ? (
            <Alert tone="danger" title="Could not add contact">
              {state.error.message}
            </Alert>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="contactName">Contact name *</Label>
            <Input id="contactName" name="contactName" required />
            <FieldError message={fieldErrors.contactName?.[0]} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="relationship">Relationship</Label>
            <Input id="relationship" name="relationship" placeholder="Spouse, sibling, parent…" />
            <FieldError message={fieldErrors.relationship?.[0]} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contactPhone">Phone *</Label>
            <Input id="contactPhone" name="phone" required />
            <FieldError message={fieldErrors.phone?.[0]} />
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function RemoveEmergencyContactButton({ id, employeeId }: { id: string; employeeId: string }) {
  const [confirming, setConfirming] = React.useState(false);
  const { isPending, run, state } = useServerForm(removeEmergencyContactAction, (result) => {
    if (result.ok) {
      toast.success("Emergency contact removed.");
      setConfirming(false);
    } else {
      toast.error(result.error.message);
    }
  });

  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} aria-label="Remove contact">
        <Trash2 aria-hidden />
      </Button>
    );
  }

  return (
    <form action={run} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="employeeId" value={employeeId} />
      <Button size="sm" variant="danger" type="submit" disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Phone aria-hidden />}
        Confirm
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setConfirming(false)} disabled={isPending}>
        Cancel
      </Button>
      {state && !state.ok ? <span className="text-[0.6875rem] text-danger-700">{state.error.message}</span> : null}
    </form>
  );
}
