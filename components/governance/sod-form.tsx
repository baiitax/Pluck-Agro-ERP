"use client";

import * as React from "react";

import { Loader2, Pencil, Plus, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useServerForm } from "@/components/forms/use-server-form";
import {
  createSodRuleAction,
  grantSodOverrideAction,
  updateSodRuleAction,
} from "@/app/(dashboard)/governance/actions";

type Option = { id: string; label: string };

export type SodRuleValues = {
  id: string;
  name: string;
  code: string;
  module: string;
  transaction_type: string;
  first_action: string;
  conflicting_action: string;
  enforcement_level: string;
  description: string | null;
  is_active: boolean;
};

function RuleFields({ rule }: { rule?: SodRuleValues }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="sod-name">Rule name *</Label>
        <Input id="sod-name" name="name" required defaultValue={rule?.name} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sod-code">Code *</Label>
        <Input id="sod-code" name="code" required defaultValue={rule?.code} readOnly={Boolean(rule)} />
        <FieldHint>3–40 characters: uppercase letters, numbers, underscore or hyphen.</FieldHint>
      </div>
      <div className="space-y-1">
        <Label htmlFor="sod-module">Module *</Label>
        <Input id="sod-module" name="module" required defaultValue={rule?.module} placeholder="procurement" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sod-transaction">Transaction type *</Label>
        <Input
          id="sod-transaction"
          name="transactionType"
          required
          defaultValue={rule?.transaction_type}
          placeholder="purchase_order"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sod-first-action">First action *</Label>
        <Input id="sod-first-action" name="firstAction" required defaultValue={rule?.first_action} placeholder="create" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sod-conflicting-action">Conflicting action *</Label>
        <Input
          id="sod-conflicting-action"
          name="conflictingAction"
          required
          defaultValue={rule?.conflicting_action}
          placeholder="approve"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sod-enforcement">Enforcement *</Label>
        <Select id="sod-enforcement" name="enforcementLevel" defaultValue={rule?.enforcement_level ?? "WARN"}>
          <option value="WARN">Warn — allow, flag for review</option>
          <option value="REQUIRE_OVERRIDE">Require an approved override</option>
          <option value="BLOCK">Block outright</option>
        </Select>
        <FieldHint>Nothing is blocked until you configure a rule and choose an enforcement level.</FieldHint>
      </div>
      {rule ? (
        <div className="space-y-1">
          <Label htmlFor="sod-active">Status</Label>
          <Select id="sod-active" name="isActive" defaultValue={rule.is_active ? "true" : "false"}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        </div>
      ) : null}
    </div>
  );
}

export function SodRuleDialog({ rule }: { rule?: SodRuleValues }) {
  const [open, setOpen] = React.useState(false);
  const action = rule ? updateSodRuleAction : createSodRuleAction;
  const { state, isPending, run } = useServerForm(action, (result) => {
    if (result.ok) {
      toast.success(rule ? "Rule updated." : "Rule created.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });
  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};

  return (
    <>
      {rule ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Pencil aria-hidden /> Edit
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus aria-hidden /> New rule
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={rule ? `Edit ${rule.name}` : "New segregation-of-duties rule"}
        description="Rules are your organisation's policy. The system ships with none: every conflict you enforce is one your management has approved."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="sod-rule-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {rule ? "Save rule" : "Create rule"}
            </Button>
          </>
        }
      >
        <form id="sod-rule-form" action={run} className="space-y-3" noValidate>
          {rule ? <input type="hidden" name="id" value={rule.id} /> : null}
          {state && !state.ok ? <Alert tone="danger" title="Could not save">{state.error.message}</Alert> : null}
          <RuleFields rule={rule} />
          <div className="space-y-1">
            <Label htmlFor="sod-description">Description</Label>
            <Textarea id="sod-description" name="description" rows={2} defaultValue={rule?.description ?? ""} />
          </div>
          <FieldError message={fieldErrors.code?.[0] ?? fieldErrors.firstAction?.[0]} />
        </form>
      </Dialog>
    </>
  );
}

export function SodOverrideDialog({ rules, employees }: { rules: Option[]; employees: Option[] }) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(grantSodOverrideAction, (result) => {
    if (result.ok) {
      toast.success("Override granted and audited as a critical event.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });
  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={rules.length === 0}>
        <ShieldQuestion aria-hidden /> Grant override
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Grant a segregation-of-duties override"
        description="An override lets one person hold a normally conflicting combination. It is recorded as a critical audit event and should always have an expiry date."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="sod-override-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Grant override
            </Button>
          </>
        }
      >
        <form id="sod-override-form" action={run} className="space-y-3" noValidate>
          {state && !state.ok ? <Alert tone="danger" title="Could not grant">{state.error.message}</Alert> : null}
          <div className="space-y-1">
            <Label htmlFor="override-rule">Rule *</Label>
            <Select id="override-rule" name="ruleId" required defaultValue="">
              <option value="">Select a rule</option>
              {rules.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
            <FieldError message={fieldErrors.ruleId?.[0]} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="override-employee">Employee *</Label>
            <Select id="override-employee" name="employeeId" required defaultValue="">
              <option value="">Select an employee</option>
              {employees.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
            <FieldError message={fieldErrors.employeeId?.[0]} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="override-expiry">Expires on</Label>
            <Input id="override-expiry" name="expiresAt" type="date" />
            <FieldHint>Strongly recommended. An override with no expiry stays valid indefinitely.</FieldHint>
          </div>
          <div className="space-y-1">
            <Label htmlFor="override-justification">Justification *</Label>
            <Textarea id="override-justification" name="justification" rows={2} required minLength={10} />
            <FieldError message={fieldErrors.justification?.[0]} />
          </div>
        </form>
      </Dialog>
    </>
  );
}
