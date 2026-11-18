"use client";

import * as React from "react";

import { ActionButton, ActionForm } from "@/components/procurement/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import type { ActionResult } from "@/lib/errors";
import { formatDateTime } from "@/lib/formatting";
import { labelForStatus, procurementStatusTone } from "@/lib/procurement/statuses";
import { raiseAmendmentAction } from "@/app/(dashboard)/procurement/actions";

export type AmendmentOptions = {
  paymentTerms: { id: string; name: string }[];
  deliveryTerms: { id: string; name: string }[];
  warehouses: { id: string; name: string }[];
};

export type AmendmentRow = {
  id: string;
  reference: string;
  status: string;
  reason: string;
  base_version: number;
  resulting_version: number | null;
  previous_total: number | null;
  new_total: number | null;
  requested_at: string;
  applied_at: string | null;
  items: unknown[];
};

/**
 * Amendments against an issued order.
 *
 * The panel deliberately makes the operator state the change on a specific line rather than editing
 * the order: an amendment is a proposal with a reason, then an approval, then an application. Applying
 * one creates a new immutable version, and reducing a quantity below what has already arrived needs an
 * explicit confirmation because it changes the record of goods that physically exist.
 */
export function AmendmentPanel({
  orderId,
  orderReference,
  version,
  status,
  items,
  amendments,
  canAmend,
  canApprove,
  requiresApproval,
  options,
  openAmendment,
  actions,
}: {
  orderId: string;
  orderReference: string;
  version: number;
  status: string;
  items: { id: string; label: string }[];
  amendments: AmendmentRow[];
  canAmend: boolean;
  canApprove: boolean;
  requiresApproval: boolean;
  options: AmendmentOptions;
  openAmendment?: AmendmentRow;
  actions: {
    applyAmendmentAction: (previous: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;
    decideAmendmentAction: (previous: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;
  };
}) {
  const [showForm, setShowForm] = React.useState(false);
  const amendable = canAmend && ["issued", "partially_received", "fully_received"].includes(status) && !openAmendment;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Amendments</CardTitle>
        {amendable ? (
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            {showForm ? "Close" : "Raise an amendment"}
          </button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {openAmendment ? (
          <Alert tone="info" title={`${openAmendment.reference} is ${labelForStatus(openAmendment.status)}`}>
            An amendment is already open against this order. Finish it — approve and apply, or cancel it — before raising
            another.
          </Alert>
        ) : null}

        {showForm && amendable ? (
          <div className="rounded-lg border border-border p-3">
            <ActionForm
              action={raiseAmendmentAction}
              submitLabel="Submit amendment for approval"
              successMessage="Amendment raised."
              hidden={{ purchaseOrderId: orderId, orderReference }}
              className="grid gap-3 sm:grid-cols-2"
            >
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="reason">Reason for the change</Label>
                <Textarea
                  id="reason"
                  name="reason"
                  rows={2}
                  required
                  placeholder="Why the agreed terms need to change — not what the new numbers are."
                />
                <FieldHint>
                  {requiresApproval
                    ? "Policy requires this amendment to be approved before it can be applied."
                    : "Policy currently allows an amendment to be applied without a separate approval, but the reason is still recorded."}
                </FieldHint>
              </div>

              <div className="space-y-1 sm:col-span-2">
                <Label>Change</Label>
                <AmendmentLineFields items={items} version={version} options={options} />
              </div>
            </ActionForm>
          </div>
        ) : null}

        {amendments.length === 0 ? (
          <p className="text-xs text-ink-muted">
            No amendment has been raised against this order. Version {version} is the order as it stands.
          </p>
        ) : (
          <TableWrapper>
            <Table className="min-w-[52rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Reference</TH>
                  <TH>Status</TH>
                  <TH>Base version</TH>
                  <TH className="text-right">Before</TH>
                  <TH className="text-right">After</TH>
                  <TH>Raised</TH>
                  <TH>Applied</TH>
                  <TH>Action</TH>
                </TR>
              </THead>
              <TBody>
                {amendments.map((amendment) => (
                  <React.Fragment key={amendment.id}>
                    <TR>
                      <TD className="font-medium text-ink">{amendment.reference}</TD>
                      <TD>
                        <Badge tone={procurementStatusTone(amendment.status)}>{labelForStatus(amendment.status)}</Badge>
                      </TD>
                      <TD className="tabular-nums">{amendment.base_version}</TD>
                      <TD className="text-right tabular-nums">{amendment.previous_total ?? "—"}</TD>
                      <TD className="text-right tabular-nums">{amendment.new_total ?? "—"}</TD>
                      <TD>{formatDateTime(amendment.requested_at)}</TD>
                      <TD>{amendment.applied_at ? formatDateTime(amendment.applied_at) : "Not applied"}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1.5">
                          {canApprove && amendment.status === "submitted" ? (
                            <>
                              <ActionButton
                                action={actions.decideAmendmentAction}
                                fields={{ id: amendment.id, reference: amendment.reference, decision: "approve" }}
                                label="Approve"
                                successMessage="Amendment approved."
                              />
                              <ActionButton
                                action={actions.decideAmendmentAction}
                                fields={{ id: amendment.id, reference: amendment.reference, decision: "reject", comment: "Rejected" }}
                                label="Reject"
                                variant="secondary"
                                successMessage="Amendment rejected."
                              />
                            </>
                          ) : null}
                          {canAmend && amendment.status === "approved" ? (
                            <ActionButton
                              action={actions.applyAmendmentAction}
                              fields={{ id: amendment.id, reference: amendment.reference, confirmReceivedImpact: "on" }}
                              label="Apply to order"
                              confirmMessage="Applying creates a new order version. Confirm the received-quantity impact has been reviewed."
                              successMessage="Amendment applied."
                            />
                          ) : null}
                          {canAmend && ["draft", "submitted"].includes(amendment.status) ? (
                            <ActionButton
                              action={actions.decideAmendmentAction}
                              fields={{ id: amendment.id, reference: amendment.reference, decision: "cancel", comment: "Withdrawn" }}
                              label="Cancel"
                              variant="ghost"
                              successMessage="Amendment cancelled."
                            />
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                    <TR>
                      <TD colSpan={8} className="bg-surface-muted/60 text-xs text-ink-muted">
                        <p className="font-medium text-ink">Reason: {amendment.reason}</p>
                        <p className="mt-0.5">
                          {Array.isArray(amendment.items) ? amendment.items.length : 0} change line(s) recorded.
                          {amendment.resulting_version ? ` Resulting version ${amendment.resulting_version}.` : ""}
                        </p>
                      </TD>
                    </TR>
                  </React.Fragment>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The change line an amendment submits.
 *
 * One row per amendment in this interface: the common case is a single changed field, and the schema
 * supports more when a repair is needed. The fields are constrained to what the database understands,
 * so an amendment cannot claim a change the apply function will not make.
 */
function AmendmentLineFields({
  items,
  version,
  options,
}: {
  items: { id: string; label: string }[];
  version: number;
  options: AmendmentOptions;
}) {
  const [changeType, setChangeType] = React.useState("quantity");

  // A quantity or price change is free text because it is a number; a term or destination change is a
  // choice because the apply function needs a real record, not a value the operator guessed at.
  const freeText = changeType === "quantity" || changeType === "unit_price";
  const choice =
    changeType === "payment_terms"
      ? { name: "amendmentNewValue", list: options.paymentTerms, hint: "Payment terms the order should carry from the new version." }
      : changeType === "delivery_terms"
        ? { name: "amendmentNewValue", list: options.deliveryTerms, hint: "Delivery terms the order should carry from the new version." }
        : changeType === "destination"
          ? { name: "amendmentNewValue", list: options.warehouses, hint: "Warehouse the goods should be delivered to." }
          : null;

  return (
    <div id="amendment-line" className="grid gap-2 sm:grid-cols-2">
      <input type="hidden" name="baseVersion" value={version} />
      <div className="space-y-1">
        <Label htmlFor="line">Order line</Label>
        <Select id="line" name="amendmentLine" defaultValue={items[0]?.id ?? ""} disabled={!freeText}>
          <option value="">Whole order / header change</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
        <FieldHint>
          {freeText
            ? "The line the change applies to, or the whole order when the change is not line-specific."
            : "This change is recorded against the order header."}
        </FieldHint>
      </div>
      <div className="space-y-1">
        <Label htmlFor="changeType">What changes</Label>
        <Select
          id="changeType"
          name="amendmentChangeType"
          value={changeType}
          onChange={(event) => setChangeType(event.target.value)}
        >
          <option value="quantity">Ordered quantity</option>
          <option value="unit_price">Unit price</option>
          <option value="delivery_date">Delivery date</option>
          <option value="payment_terms">Payment terms</option>
          <option value="delivery_terms">Delivery terms</option>
          <option value="destination">Delivery destination</option>
        </Select>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="newValue">{changeType === "delivery_date" ? "New delivery date" : "New value"}</Label>
        {choice ? (
          <>
            <Select id="newValue" name={choice.name} required defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              {choice.list.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
            <FieldHint>{choice.hint}</FieldHint>
          </>
        ) : (
          <>
            <Input
              id="newValue"
              name="amendmentNewValue"
              required
              type={changeType === "delivery_date" ? "date" : "text"}
              inputMode={freeText ? "decimal" : undefined}
              placeholder={changeType === "delivery_date" ? undefined : "e.g. 12000"}
            />
            <FieldHint>
              The amendment is submitted as a single change line. Reducing a quantity below what has already been received
              requires an explicit confirmation when it is applied.
            </FieldHint>
          </>
        )}
      </div>
    </div>
  );
}
