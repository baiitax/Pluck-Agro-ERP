"use client";

import * as React from "react";

import { Check, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useServerForm } from "@/components/forms/use-server-form";
import { formatDate } from "@/lib/formatting";
import {
  createDelegationAction,
  decideDelegationAction,
  revokeDelegationAction,
} from "@/app/(dashboard)/governance/actions";

type Option = { id: string; label: string };

export function CreateDelegationDialog({
  employees,
  departments,
}: {
  employees: Option[];
  departments: Option[];
}) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(createDelegationAction, (result) => {
    if (result.ok) {
      toast.success("Delegation requested. It grants nothing until it is approved.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });
  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> New delegation
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Request a delegation"
        description="A delegate can never receive more authority than the delegator holds, and delegations cannot form loops. The request must be approved by someone else before it takes effect."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="delegation-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Submit request
            </Button>
          </>
        }
      >
        <form id="delegation-form" action={run} className="space-y-3" noValidate>
          {state && !state.ok ? <Alert tone="danger" title="Could not create">{state.error.message}</Alert> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="delegation-from">Delegating employee *</Label>
              <Select id="delegation-from" name="delegatorEmployeeId" required defaultValue="">
                <option value="">Select the delegator</option>
                {employees.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <FieldError message={fieldErrors.delegatorEmployeeId?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="delegation-to">Delegate *</Label>
              <Select id="delegation-to" name="delegateEmployeeId" required defaultValue="">
                <option value="">Select the delegate</option>
                {employees.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <FieldError message={fieldErrors.delegateEmployeeId?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="delegation-module">Module *</Label>
              <Input id="delegation-module" name="module" placeholder="procurement" required />
              <FieldError message={fieldErrors.module?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="delegation-transaction">Transaction type *</Label>
              <Input id="delegation-transaction" name="transactionType" placeholder="purchase_order" required />
              <FieldError message={fieldErrors.transactionType?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="delegation-currency">Currency *</Label>
              <Input id="delegation-currency" name="currencyCode" defaultValue="NGN" maxLength={3} required />
              <FieldError message={fieldErrors.currencyCode?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="delegation-limit">Delegated limit *</Label>
              <Input id="delegation-limit" name="delegatedLimit" inputMode="decimal" required />
              <FieldHint>May not exceed the delegator&apos;s own configured maximum.</FieldHint>
              <FieldError message={fieldErrors.delegatedLimit?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="delegation-from-date">Effective from *</Label>
              <Input id="delegation-from-date" name="effectiveFrom" type="date" required />
              <FieldError message={fieldErrors.effectiveFrom?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="delegation-until">Effective until *</Label>
              <Input id="delegation-until" name="effectiveUntil" type="date" required />
              <FieldHint>Delegated authority ends automatically at this date.</FieldHint>
              <FieldError message={fieldErrors.effectiveUntil?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="delegation-department">Department</Label>
              <Select id="delegation-department" name="departmentId" defaultValue="">
                <option value="">All departments</option>
                {departments.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="delegation-reason">Reason *</Label>
            <Textarea id="delegation-reason" name="reason" rows={2} required minLength={10} />
            <FieldError message={fieldErrors.reason?.[0]} />
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function DelegationDecisionButtons({
  delegationId,
  delegatorName,
  delegateName,
  effectiveFrom,
  effectiveUntil,
  canApprove,
}: {
  delegationId: string;
  delegatorName: string;
  delegateName: string;
  effectiveFrom: string;
  effectiveUntil: string;
  canApprove: boolean;
}) {
  const [decision, setDecision] = React.useState<"approved" | "rejected" | null>(null);
  const { state, isPending, run } = useServerForm(decideDelegationAction, (result) => {
    if (result.ok) {
      toast.success("Decision recorded.");
      setDecision(null);
    } else {
      toast.error(result.error.message);
    }
  });

  if (!canApprove) {
    return <span className="text-[0.6875rem] text-ink-subtle">Awaiting approval</span>;
  }

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="secondary" onClick={() => setDecision("approved")}>
          <Check aria-hidden /> Approve
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDecision("rejected")}>
          <X aria-hidden /> Reject
        </Button>
      </div>

      <Dialog
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision === "approved" ? "Approve this delegation?" : "Reject this delegation?"}
        description={`${delegatorName} → ${delegateName}, ${formatDate(effectiveFrom)} to ${formatDate(effectiveUntil)}.`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDecision(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={decision === "approved" ? "primary" : "danger"}
              type="submit"
              form="delegation-decision-form"
              disabled={isPending}
            >
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {decision === "approved" ? "Approve" : "Reject"}
            </Button>
          </>
        }
      >
        <form id="delegation-decision-form" action={run} className="space-y-3">
          <input type="hidden" name="id" value={delegationId} />
          <input type="hidden" name="decision" value={decision ?? ""} />
          {state && !state.ok ? (
            <Alert tone="danger" title="Could not record the decision">
              {state.error.message}
            </Alert>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="delegation-decision-reason">Reason *</Label>
            <Textarea id="delegation-decision-reason" name="reason" rows={2} required minLength={3} />
            <FieldHint>You cannot decide a delegation you created yourself.</FieldHint>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function RevokeDelegationButton({ delegationId }: { delegationId: string }) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(revokeDelegationAction, (result) => {
    if (result.ok) {
      toast.success("Delegation revoked.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <X aria-hidden /> Revoke
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Revoke this delegation?"
        description="Revocation is immediate and permanent: the delegation record is kept for audit purposes."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" type="submit" form="revoke-delegation-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Revoke
            </Button>
          </>
        }
      >
        <form id="revoke-delegation-form" action={run} className="space-y-3">
          <input type="hidden" name="id" value={delegationId} />
          {state && !state.ok ? <Alert tone="danger" title="Could not revoke">{state.error.message}</Alert> : null}
          <div className="space-y-1">
            <Label htmlFor="revoke-delegation-reason">Reason *</Label>
            <Textarea id="revoke-delegation-reason" name="reason" rows={2} required minLength={10} />
          </div>
        </form>
      </Dialog>
    </>
  );
}
