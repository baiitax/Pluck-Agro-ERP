"use client";

import * as React from "react";

import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useServerForm } from "@/components/forms/use-server-form";
import { PERMISSION_SCOPES } from "@/lib/permissions/definitions";
import { createAuthorityAction } from "@/app/(dashboard)/governance/actions";

type Option = { id: string; label: string };

export function CreateAuthorityDialog({
  employees,
  departments,
  roles,
}: {
  employees: Option[];
  departments: Option[];
  roles: Option[];
}) {
  const [open, setOpen] = React.useState(false);
  const [principalType, setPrincipalType] = React.useState<"employee" | "role">("employee");
  const { state, isPending, run } = useServerForm(createAuthorityAction, (result) => {
    if (result.ok) {
      toast.success("Approval authority recorded.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });
  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Configure authority
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Configure an approval authority"
        description="Everything here is entered by you. The system does not propose default limits, and no approval workflow runs in Phase 1."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="authority-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Save authority
            </Button>
          </>
        }
      >
        <form id="authority-form" action={run} className="space-y-3" noValidate>
          {state && !state.ok ? <Alert tone="danger" title="Could not save">{state.error.message}</Alert> : null}

          <div className="space-y-1">
            <Label htmlFor="authority-principal-type">Held by</Label>
            <Select
              id="authority-principal-type"
              name="principalType"
              value={principalType}
              onChange={(event) => setPrincipalType(event.target.value as "employee" | "role")}
            >
              <option value="employee">A named employee</option>
              <option value="role">Everyone holding a role</option>
            </Select>
            <FieldHint>An authority belongs to exactly one principal — never both.</FieldHint>
          </div>

          {principalType === "employee" ? (
            <div className="space-y-1">
              <Label htmlFor="authority-employee">Employee *</Label>
              <Select id="authority-employee" name="employeeId" required defaultValue="">
                <option value="">Select an employee</option>
                {employees.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <FieldError message={fieldErrors.employeeId?.[0]} />
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="authority-role">Role *</Label>
              <Select id="authority-role" name="roleId" required defaultValue="">
                <option value="">Select a role</option>
                {roles.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <FieldError message={fieldErrors.roleId?.[0]} />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="authority-module">Module *</Label>
              <Input id="authority-module" name="module" placeholder="procurement" required />
              <FieldError message={fieldErrors.module?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="authority-transaction">Transaction type *</Label>
              <Input id="authority-transaction" name="transactionType" placeholder="purchase_order" required />
              <FieldError message={fieldErrors.transactionType?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="authority-currency">Currency *</Label>
              <Input id="authority-currency" name="currencyCode" defaultValue="NGN" maxLength={3} required />
              <FieldError message={fieldErrors.currencyCode?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="authority-level">Authority level</Label>
              <Input id="authority-level" name="authorityLevel" type="number" min={1} max={10} defaultValue={1} />
              <FieldHint>Your own convention for approval tiers.</FieldHint>
            </div>
            <div className="space-y-1">
              <Label htmlFor="authority-min">Minimum amount *</Label>
              <Input id="authority-min" name="minimumAmount" inputMode="decimal" defaultValue="0" required />
              <FieldError message={fieldErrors.minimumAmount?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="authority-max">Maximum amount *</Label>
              <Input id="authority-max" name="maximumAmount" inputMode="decimal" required />
              <FieldError message={fieldErrors.maximumAmount?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="authority-scope">Scope</Label>
              <Select id="authority-scope" name="scopeType" defaultValue="GLOBAL">
                {PERMISSION_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {scope.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="authority-department">Department</Label>
              <Select id="authority-department" name="departmentId" defaultValue="">
                <option value="">All departments</option>
                {departments.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="authority-from">Effective from *</Label>
              <Input id="authority-from" name="effectiveFrom" type="date" required />
              <FieldError message={fieldErrors.effectiveFrom?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="authority-until">Effective until</Label>
              <Input id="authority-until" name="effectiveUntil" type="date" />
              <FieldError message={fieldErrors.effectiveUntil?.[0]} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="authority-justification">Justification *</Label>
            <Textarea id="authority-justification" name="justification" rows={2} required minLength={10} />
            <FieldHint>Recorded in the audit trail with this configuration.</FieldHint>
            <FieldError message={fieldErrors.justification?.[0]} />
          </div>
        </form>
      </Dialog>
    </>
  );
}
