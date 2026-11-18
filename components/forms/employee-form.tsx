"use client";

import * as React from "react";

import { Loader2, Pencil, Plus, UserRoundX } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_LABELS } from "@/lib/constants/statuses";
import {
  EMPLOYEE_CATEGORIES,
  EMPLOYEE_CATEGORY_LABELS,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
} from "@/lib/validation/employee.schemas";
import type { EmployeeWithDepartment } from "@/services/employees/get-employees";
import {
  createEmployeeAction,
  deactivateEmployeeAction,
  updateEmployeeAction,
} from "@/app/(dashboard)/administration/employees/actions";
import { useServerForm } from "@/components/forms/use-server-form";

type Option = { id: string; label: string };

export function EmployeeFormDialog({
  departments,
  positions,
  supervisors,
  employee,
  trigger,
}: {
  departments: Option[];
  positions: Option[];
  supervisors: Option[];
  employee?: EmployeeWithDepartment;
  trigger: "create" | "edit";
}) {
  const [open, setOpen] = React.useState(false);
  const action = employee ? updateEmployeeAction : createEmployeeAction;
  const { state, isPending, run } = useServerForm(action, (result) => {
    if (result.ok) {
      toast.success(employee ? "Employee updated." : "Employee created.");
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
          <Plus aria-hidden /> New employee
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
        title={employee ? `Edit ${employee.first_name} ${employee.last_name}` : "New employee"}
        description={
          employee
            ? "Changes are recorded in the audit trail with the previous and new values."
            : "Employee records are separate from ERP logins. An ERP account is provisioned separately, with its own approval."
        }
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="employee-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {employee ? "Save changes" : "Create employee"}
            </Button>
          </>
        }
      >
        <form id="employee-form" action={run} className="space-y-3" noValidate>
          {employee ? <input type="hidden" name="id" value={employee.id} /> : null}

          {state && !state.ok ? (
            <Alert tone="danger" title="Could not save">
              {state.error.message}
            </Alert>
          ) : null}

          {!employee ? (
            <div className="space-y-1">
              <Label htmlFor="employeeNumber">Employee number</Label>
              <Input id="employeeNumber" name="employeeNumber" placeholder="Leave blank to allocate automatically" />
              <FieldHint>
                Blank allocates the next number from the central sequence (for example PA-EMP-000123).
              </FieldHint>
              <FieldError message={firstError("employeeNumber")} />
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="firstName">First name *</Label>
              <Input id="firstName" name="firstName" required defaultValue={employee?.first_name} />
              <FieldError message={firstError("firstName")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="middleName">Middle name</Label>
              <Input id="middleName" name="middleName" defaultValue={employee?.middle_name ?? ""} />
              <FieldError message={firstError("middleName")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lastName">Last name *</Label>
              <Input id="lastName" name="lastName" required defaultValue={employee?.last_name} />
              <FieldError message={firstError("lastName")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" name="email" type="email" defaultValue={employee?.email ?? ""} />
              <FieldError message={firstError("email")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" defaultValue={employee?.phone ?? ""} />
              <FieldError message={firstError("phone")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="departmentId">Department</Label>
              <Select id="departmentId" name="departmentId" defaultValue={employee?.department_id ?? ""}>
                <option value="">Unassigned</option>
                {departments.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <FieldError message={firstError("departmentId")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="positionId">Position</Label>
              <Select id="positionId" name="positionId" defaultValue={employee?.position_id ?? ""}>
                <option value="">Unassigned</option>
                {positions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <FieldError message={firstError("positionId")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="supervisorId">Supervisor</Label>
              <Select id="supervisorId" name="supervisorId" defaultValue={employee?.supervisor_employee_id ?? ""}>
                <option value="">No supervisor</option>
                {supervisors
                  .filter((option) => option.id !== employee?.id)
                  .map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
              </Select>
              <FieldError message={firstError("supervisorId")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="jobTitle">Job title</Label>
              <Input id="jobTitle" name="jobTitle" defaultValue={employee?.job_title ?? ""} />
              <FieldError message={firstError("jobTitle")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="employeeCategory">Employee category</Label>
              <Select id="employeeCategory" name="employeeCategory" defaultValue={employee?.employee_category ?? ""}>
                <option value="">Not set</option>
                {EMPLOYEE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {EMPLOYEE_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </Select>
              <FieldError message={firstError("employeeCategory")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="employmentType">Employment type</Label>
              <Select id="employmentType" name="employmentType" defaultValue={employee?.employment_type ?? "full_time"}>
                {EMPLOYMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {EMPLOYMENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
              <FieldError message={firstError("employmentType")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="employmentStatus">Employment status</Label>
              <Select
                id="employmentStatus"
                name="employmentStatus"
                defaultValue={employee?.employment_status ?? "active"}
              >
                {EMPLOYMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {EMPLOYMENT_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
              <FieldError message={firstError("employmentStatus")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="workLocation">Work location</Label>
              <Input id="workLocation" name="workLocation" defaultValue={employee?.work_location ?? ""} />
              <FieldError message={firstError("workLocation")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dateJoined">Date joined</Label>
              <Input id="dateJoined" name="dateJoined" type="date" defaultValue={employee?.date_joined ?? ""} />
              <FieldError message={firstError("dateJoined")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="employmentEndDate">Employment end date</Label>
              <Input
                id="employmentEndDate"
                name="employmentEndDate"
                type="date"
                defaultValue={employee?.employment_end_date ?? ""}
              />
              <FieldHint>Set when a fixed-term engagement is scheduled to end.</FieldHint>
              <FieldError message={firstError("employmentEndDate")} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={2} defaultValue={employee?.notes ?? ""} />
            <FieldError message={firstError("notes")} />
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function DeactivateEmployeeDialog({
  employeeId,
  employeeName,
  disabled,
}: {
  employeeId: string;
  employeeName: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(deactivateEmployeeAction, (result) => {
    if (result.ok) {
      toast.success("Employment ended. History and audit records were preserved.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });

  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)} disabled={disabled}>
        <UserRoundX aria-hidden /> End employment
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`End employment for ${employeeName}?`}
        description="The record is retained with its full history. Deactivation does not change the linked ERP account — that is a separate decision."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" type="submit" form="deactivate-employee-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              End employment
            </Button>
          </>
        }
      >
        <form id="deactivate-employee-form" action={run} className="space-y-3">
          <input type="hidden" name="id" value={employeeId} />
          {state && !state.ok ? (
            <Alert tone="danger" title="Could not deactivate">
              {state.error.message}
            </Alert>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="deactivate-reason">Reason *</Label>
            <Textarea id="deactivate-reason" name="reason" rows={2} required minLength={10} />
            <FieldHint>Recorded in the audit trail. Minimum 10 characters.</FieldHint>
          </div>
          <div className="space-y-1">
            <Label htmlFor="deactivate-end">Employment end date</Label>
            <Input id="deactivate-end" name="employmentEndDate" type="date" />
          </div>
        </form>
      </Dialog>
    </>
  );
}
