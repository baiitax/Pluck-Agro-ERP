"use client";

import * as React from "react";

import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useServerForm } from "@/components/forms/use-server-form";
import { createPositionAction, updatePositionAction } from "@/app/(dashboard)/administration/positions/actions";

type Option = { id: string; label: string };

export type PositionFormValues = {
  id: string;
  title: string;
  code: string;
  department_id: string | null;
  grade: string | null;
  description: string | null;
  is_active: boolean;
};

export function PositionFormDialog({
  departments,
  position,
  trigger,
}: {
  departments: Option[];
  position?: PositionFormValues;
  trigger: "create" | "edit";
}) {
  const [open, setOpen] = React.useState(false);
  const action = position ? updatePositionAction : createPositionAction;
  const { state, isPending, run } = useServerForm(action, (result) => {
    if (result.ok) {
      toast.success(position ? "Position updated." : "Position created.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });

  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};

  return (
    <>
      {trigger === "create" ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus aria-hidden /> New position
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Pencil aria-hidden /> Edit
        </Button>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={position ? `Edit ${position.title}` : "New position"}
        description="Positions describe the role a person fills. They are separate from ERP roles, which govern system access."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="position-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {position ? "Save changes" : "Create position"}
            </Button>
          </>
        }
      >
        <form id="position-form" action={run} className="space-y-3" noValidate>
          {position ? <input type="hidden" name="id" value={position.id} /> : null}
          {state && !state.ok ? (
            <Alert tone="danger" title="Could not save">
              {state.error.message}
            </Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="position-title">Title *</Label>
              <Input id="position-title" name="title" required defaultValue={position?.title} />
              <FieldError message={fieldErrors.title?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="position-code">Code *</Label>
              <Input id="position-code" name="code" required defaultValue={position?.code} />
              <FieldHint>Uppercase letters, numbers and hyphens.</FieldHint>
              <FieldError message={fieldErrors.code?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="position-department">Department</Label>
              <Select id="position-department" name="departmentId" defaultValue={position?.department_id ?? ""}>
                <option value="">Any department</option>
                {departments.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <FieldError message={fieldErrors.departmentId?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="position-grade">Grade</Label>
              <Input id="position-grade" name="grade" defaultValue={position?.grade ?? ""} />
              <FieldError message={fieldErrors.grade?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="position-active">Status</Label>
              <Select id="position-active" name="isActive" defaultValue={position?.is_active === false ? "false" : "true"}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="position-description">Description</Label>
            <Textarea id="position-description" name="description" rows={2} defaultValue={position?.description ?? ""} />
            <FieldError message={fieldErrors.description?.[0]} />
          </div>
        </form>
      </Dialog>
    </>
  );
}
