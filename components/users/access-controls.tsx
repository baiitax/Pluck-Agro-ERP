"use client";

import * as React from "react";

import { Loader2, KeyRound, MailPlus, ShieldPlus, ShieldX, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useServerForm } from "@/components/forms/use-server-form";
import {
  ACCOUNT_STATUS_LABELS,
  allowedAccountTransitions,
  type AccountStatusValue,
} from "@/lib/constants/statuses";
import type { Role } from "@/types/database.types";
import {
  assignRoleAction,
  provisionAccountAction,
  resendInvitationAction,
  revokeRoleAction,
  revokeSessionsAction,
  updateAccountStatusAction,
} from "@/app/(dashboard)/administration/users/actions";

type EmployeeOption = {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  email: string | null;
};

export function ProvisionAccountDialog({
  employees,
  roles,
  defaultEmployeeId,
}: {
  employees: EmployeeOption[];
  roles: Role[];
  defaultEmployeeId?: string;
}) {
  const [open, setOpen] = React.useState(Boolean(defaultEmployeeId));
  const { state, isPending, run } = useServerForm(provisionAccountAction, (result) => {
    if (result.ok) {
      toast.success("Invitation sent. The user sets their own password from the email link.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });

  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={employees.length === 0}>
        <ShieldPlus aria-hidden /> Provision account
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Provision an ERP account"
        description="An invitation email is sent by Supabase Auth. No password is created, displayed or stored by this application."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="provision-account-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Send invitation
            </Button>
          </>
        }
      >
        <form id="provision-account-form" action={run} className="space-y-3" noValidate>
          {state && !state.ok ? (
            <Alert tone="danger" title="Could not provision the account">
              {state.error.message}
            </Alert>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="provision-employee">Employee *</Label>
            <Select id="provision-employee" name="employeeId" defaultValue={defaultEmployeeId ?? ""} required>
              <option value="">Select an employee</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.first_name} {employee.last_name} · {employee.employee_number}
                  {employee.email ? "" : " (no email)"}
                </option>
              ))}
            </Select>
            <FieldHint>Only employees without an ERP account are listed.</FieldHint>
            <FieldError message={fieldErrors.employeeId?.[0]} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="provision-email">Email override</Label>
            <Input id="provision-email" name="email" type="email" placeholder="Optional — defaults to the employee email" />
            <FieldError message={fieldErrors.email?.[0]} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="provision-roles">Roles *</Label>
            <select
              id="provision-roles"
              name="roleIds"
              multiple
              required
              className="h-32 w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-xs"
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name} ({role.code})
                </option>
              ))}
            </select>
            <FieldHint>
              You can only grant roles whose permissions you hold yourself. Hold Ctrl/Cmd to select several.
            </FieldHint>
            <FieldError message={fieldErrors.roleIds?.[0]} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="provision-reason">Justification *</Label>
            <Textarea id="provision-reason" name="reason" rows={2} required minLength={10} />
            <FieldError message={fieldErrors.reason?.[0]} />
          </div>
        </form>
      </Dialog>
    </>
  );
}

const STATUS_ICON = {
  active: UserCheck,
  suspended: UserX,
  deactivated: UserX,
  locked: UserX,
  invited: MailPlus,
  pending_setup: MailPlus,
} as const;

export function AccountStatusActions({
  userId,
  currentStatus,
  allowed,
}: {
  userId: string;
  currentStatus: AccountStatusValue;
  /** Statuses the caller is permitted to set. */
  allowed: AccountStatusValue[];
}) {
  const transitions = allowedAccountTransitions(currentStatus).filter((status) => allowed.includes(status));
  const [target, setTarget] = React.useState<AccountStatusValue | null>(null);
  const { state, isPending, run } = useServerForm(updateAccountStatusAction, (result) => {
    if (result.ok) {
      toast.success("Account status updated.");
      setTarget(null);
    } else {
      toast.error(result.error.message);
    }
  });

  if (transitions.length === 0) {
    return (
      <p className="text-[0.6875rem] text-ink-subtle">
        No status change is available to you for this account.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {transitions.map((status) => {
          const Icon = STATUS_ICON[status] ?? KeyRound;
          const destructive = status === "deactivated" || status === "suspended" || status === "locked";
          return (
            <Button
              key={status}
              size="sm"
              variant={destructive ? "danger" : status === "active" ? "primary" : "secondary"}
              onClick={() => setTarget(status)}
            >
              <Icon aria-hidden /> {ACCOUNT_STATUS_LABELS[status]}
            </Button>
          );
        })}
      </div>

      <Dialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `Set account to ${ACCOUNT_STATUS_LABELS[target]}?` : "Change account status"}
        description={
          target === "deactivated"
            ? "The account keeps its history but can no longer sign in. This is recorded as a critical audit event."
            : target === "suspended"
              ? "The account cannot sign in until it is reinstated."
              : "The account lifecycle change is authorized on the server and written to the audit trail."
        }
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setTarget(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={target === "deactivated" || target === "suspended" ? "danger" : "primary"}
              type="submit"
              form="account-status-form"
              disabled={isPending}
            >
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Confirm
            </Button>
          </>
        }
      >
        <form id="account-status-form" action={run} className="space-y-3">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="status" value={target ?? ""} />
          {state && !state.ok ? (
            <Alert tone="danger" title="Could not change the status">
              {state.error.message}
            </Alert>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="status-reason">Reason *</Label>
            <Textarea id="status-reason" name="reason" rows={2} required minLength={3} />
            <FieldHint>Recorded in the audit trail and in the account activity log.</FieldHint>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function ResendInvitationButton({ userId }: { userId: string }) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(resendInvitationAction, (result) => {
    if (result.ok) {
      toast.success("Invitation re-sent.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <MailPlus aria-hidden /> Re-send invitation
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Re-send the invitation?"
        description="Supabase sends a fresh invitation link. The previous link keeps working until it expires."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="resend-invite-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Send invitation
            </Button>
          </>
        }
      >
        <form id="resend-invite-form" action={run} className="space-y-3">
          <input type="hidden" name="userId" value={userId} />
          {state && !state.ok ? <Alert tone="danger" title="Could not send">{state.error.message}</Alert> : null}
          <div className="space-y-1">
            <Label htmlFor="resend-reason">Reason *</Label>
            <Input id="resend-reason" name="reason" required minLength={3} />
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function RevokeSessionsButton({ userId }: { userId: string }) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(revokeSessionsAction, (result) => {
    if (result.ok) {
      toast.success("All sessions revoked. The user must sign in again.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <KeyRound aria-hidden /> Revoke sessions
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Revoke every active session?"
        description="Any session issued before now stops working on the next request. The user must sign in again."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" type="submit" form="revoke-sessions-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Revoke sessions
            </Button>
          </>
        }
      >
        <form id="revoke-sessions-form" action={run} className="space-y-3">
          <input type="hidden" name="userId" value={userId} />
          {state && !state.ok ? <Alert tone="danger" title="Could not revoke">{state.error.message}</Alert> : null}
          <div className="space-y-1">
            <Label htmlFor="revoke-reason">Reason *</Label>
            <Textarea id="revoke-reason" name="reason" rows={2} required minLength={10} />
            <FieldHint>Minimum 10 characters. Recorded as a critical audit event.</FieldHint>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function AssignRoleDialog({
  userId,
  roles,
  availableRoles,
}: {
  userId: string;
  roles: Role[];
  availableRoles: string[];
}) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(assignRoleAction, (result) => {
    if (result.ok) {
      toast.success("Role assigned.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });

  const selectable = roles.filter((role) => role.is_active && !availableRoles.includes(role.code));

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={selectable.length === 0}>
        <ShieldPlus aria-hidden /> Assign role
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Assign a role"
        description="Role assignment is authorized on the server, recorded in the audit trail and cannot be self-assigned."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="assign-role-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Assign role
            </Button>
          </>
        }
      >
        <form id="assign-role-form" action={run} className="space-y-3">
          <input type="hidden" name="userId" value={userId} />
          {state && !state.ok ? <Alert tone="danger" title="Could not assign">{state.error.message}</Alert> : null}

          <div className="space-y-1">
            <Label htmlFor="assign-role">Role *</Label>
            <Select id="assign-role" name="roleId" required defaultValue="">
              <option value="">Select a role</option>
              {selectable.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name} ({role.code})
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="assign-expiry">Expires on</Label>
            <Input id="assign-expiry" name="expiresAt" type="date" />
            <FieldHint>Leave blank for an open-ended assignment.</FieldHint>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function RevokeRoleButton({ assignmentId, roleName }: { assignmentId: string; roleName: string }) {
  const [confirming, setConfirming] = React.useState(false);
  const { state, isPending, run } = useServerForm(revokeRoleAction, (result) => {
    if (result.ok) {
      toast.success("Role revoked.");
      setConfirming(false);
    } else {
      toast.error(result.error.message);
    }
  });

  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        <ShieldX aria-hidden /> Revoke
      </Button>
    );
  }

  return (
    <form action={run} className="flex items-center gap-1">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <Button size="sm" variant="danger" type="submit" disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Confirm revoke {roleName}
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setConfirming(false)} disabled={isPending}>
        Cancel
      </Button>
      {state && !state.ok ? <span className="text-[0.6875rem] text-danger-700">{state.error.message}</span> : null}
    </form>
  );
}
