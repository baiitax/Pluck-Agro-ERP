"use client";

import * as React from "react";

import { ClipboardCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useServerForm } from "@/components/forms/use-server-form";
import { saveAccessReviewAction } from "@/app/(dashboard)/governance/actions";

type Option = { id: string; label: string };

export function RecordReviewDialog({
  accounts,
  reviewPeriod,
}: {
  accounts: Option[];
  reviewPeriod: string;
}) {
  const [open, setOpen] = React.useState(false);
  const { state, isPending, run } = useServerForm(saveAccessReviewAction, (result) => {
    if (result.ok) {
      toast.success("Access review recorded.");
      setOpen(false);
    } else {
      toast.error(result.error.message);
    }
  });
  const fieldErrors = state && !state.ok ? (state.error.details ?? {}) : {};

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={accounts.length === 0}>
        <ClipboardCheck aria-hidden /> Record review
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Record an access review"
        description="Reviews are governance evidence. A decision of 'revoke' records the reviewer's conclusion — it does not revoke access by itself; do that through the account lifecycle."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="access-review-form" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Save review
            </Button>
          </>
        }
      >
        <form id="access-review-form" action={run} className="space-y-3" noValidate>
          {state && !state.ok ? <Alert tone="danger" title="Could not save">{state.error.message}</Alert> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="review-period">Review period *</Label>
              <Input id="review-period" name="reviewPeriod" defaultValue={reviewPeriod} required />
              <FieldHint>Format YYYY-Qn (quarters) or YYYY-MM (months).</FieldHint>
              <FieldError message={fieldErrors.reviewPeriod?.[0]} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="review-status">Status *</Label>
              <Select id="review-status" name="reviewStatus" defaultValue="pending">
                <option value="pending">Pending</option>
                <option value="in_review">In review</option>
                <option value="completed">Completed</option>
                <option value="flagged">Flagged</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="review-account">Account *</Label>
            <Select id="review-account" name="userId" required defaultValue="">
              <option value="">Select an account</option>
              {accounts.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
            <FieldError message={fieldErrors.userId?.[0]} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="review-decision">Decision</Label>
            <Select id="review-decision" name="decision" defaultValue="">
              <option value="">No decision yet</option>
              <option value="retain">Retain access</option>
              <option value="amend">Amend access</option>
              <option value="revoke">Revoke access</option>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="review-findings">Findings</Label>
            <Textarea
              id="review-findings"
              name="findings"
              rows={3}
              placeholder="What did you find? Is the access still required for the role?"
            />
            <FieldError message={fieldErrors.findings?.[0]} />
          </div>
        </form>
      </Dialog>
    </>
  );
}
