"use client";

import * as React from "react";

import { Loader2, Pencil, Plus, PowerOff } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useServerForm } from "@/components/forms/use-server-form";
import {
  createDepartmentAction,
  deactivateDepartmentAction,
  updateDepartmentAction,
} from "@/app/(dashboard)/administration/departments/actions";

type Option = { id: string; label: string };

export type DepartmentFormValues = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  parent_department_id: string | null;
  department_head_employee_id: string | null;
  cost_center_code: string | null;
  is_active: boolean;
};

export function DepartmentFormDialog({
  departments,
  employees,
  department,
  trigger,
}: {
  departments: Option[];
  employees: Option[];
  department?: DepartmentFormValues;
  trigger: "create" | "edit";
}) {
  const [open, setOpen] = React.useState(false);
  const action = department ? updateDepartmentAction : createDepartmentAction;
  const { state, isPending, run } = useServerForm(action, (result) => {
    if (result.ok) {
      toast.success(department ? "Department updated." : "Department created.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });

  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};
  const firstError = (name: string) => fieldErrors[name]?.[0];

  return (
    <>
      {trigger === "create" ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus aria-hidden /> New department
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Pencil aria-hidden /> Edit
        </Button>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={department ? `Edit ${department.name}` : "New department"}
        description="Departments form a hierarchy used for placement, department-scoped permissions and reporting. Cycles are rejected by the database."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="department-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {department ? "Save changes" : "Create department"}
            </Button>
          </>
        }
      >
        <form id="department-form" action={run} className="space-y-3" noValidate>
          {department ? <input type="hidden" name="id" value={department.id} /> : null}
          {state && !state.ok ? (
            <Alert tone="danger" title="Could not save">
              {state.error.message}
            </Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="department-name">Name *</Label>
              <Input id="department-name" name="name" required defaultValue={department?.name} />
              <FieldError message={firstError("name")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="department-code">Code *</Label>
              <Input id="department-code" name="code" required defaultValue={department?.code} />
              <FieldHint>Uppercase letters, numbers and hyphens.</FieldHint>
              <FieldError message={firstError("code")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="department-parent">Parent department</Label>
              <Select id="department-parent" name="parentDepartmentId" defaultValue={department?.parent_department_id ?? ""}>
                <option value="">Top level</option>
                {departments
                  .filter((option) => option.id !== department?.id)
                  .map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
              </Select>
              <FieldError message={firstError("parentDepartmentId")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="department-head">Department head</Label>
              <Select
                id="department-head"
                name="departmentHeadEmployeeId"
                defaultValue={department?.department_head_employee_id ?? ""}
              >
                <option value="">Not assigned</option>
                {employees.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <FieldError message={firstError("departmentHeadEmployeeId")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="department-cost-centre">Cost centre code</Label>
              <Input id="department-cost-centre" name="costCenterCode" defaultValue={department?.cost_center_code ?? ""} />
              <FieldHint>Optional. Finance uses this in a later phase.</FieldHint>
              <FieldError message={firstError("costCenterCode")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="department-active">Status</Label>
              <Select id="department-active" name="isActive" defaultValue={department?.is_active === false ? "false" : "true"}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="department-description">Description</Label>
            <Textarea id="department-description" name="description" rows={2} defaultValue={department?.description ?? ""} />
            <FieldError message={firstError("description")} />
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function DeactivateDepartmentButton({ departmentId, name }: { departmentId: string; name: string }) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(deactivateDepartmentAction, (result) => {
    if (result.ok) {
      toast.success("Department deactivated.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <PowerOff aria-hidden /> Deactivate
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Deactivate ${name}?`}
        description="Deactivation is refused while the department still has active employees or active sub-departments."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" type="submit" form="deactivate-department-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Deactivate
            </Button>
          </>
        }
      >
        <form id="deactivate-department-form" action={run} className="space-y-3">
          <input type="hidden" name="id" value={departmentId} />
          {state && !state.ok ? (
            <Alert tone="danger" title="Could not deactivate">
              {state.error.message}
            </Alert>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="dept-reason">Reason *</Label>
            <Textarea id="dept-reason" name="reason" rows={2} required minLength={10} />
          </div>
        </form>
      </Dialog>
    </>
  );
}
