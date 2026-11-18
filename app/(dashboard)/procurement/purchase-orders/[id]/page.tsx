import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton, ActionForm } from "@/components/procurement/action-form";
import { AmendmentPanel } from "@/components/procurement/amendment-panel";
import { DocumentRegister } from "@/components/procurement/document-register";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { labelForStatus, procurementStatusTone } from "@/lib/procurement/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getPurchaseOrderDetail } from "@/services/procurement/purchase-orders";
import {
  applyAmendmentAction,
  decideAmendmentAction,
  decidePurchaseOrderAction,
  submitPurchaseOrderAction,
} from "../../actions";

export const metadata: Metadata = { title: "Purchase order" };
export const dynamic = "force-dynamic";

const qty = (value: number) => new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(value);
const money = (currency: string, value: number | null) =>
  value === null
    ? "—"
    : `${currency} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

/**
 * One purchase order.
 *
 * The page separates four things that are easy to conflate: the order's content, its approval, its
 * issue, and what has actually arrived. Received quantities come from posted receipts, never from a
 * field on this document.
 */
export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.purchase_order.view")) {
    return <PermissionGuard permission="procurement.purchase_order.view" />;
  }

  const { id } = await params;
  const detail = await getPurchaseOrderDetail(id).catch(() => null);
  if (!detail) notFound();

  const {
    order,
    items,
    supplier,
    department,
    officer,
    history,
    approvals,
    versions,
    amendments,
    receipts,
    quotation,
    requisitions,
    documents,
    receiptStatus,
    settings,
    authorityCovers,
    amendmentOptions,
  } = detail;

  const canSubmit = principal.permissions.has("procurement.purchase_order.submit");
  const canApprove = principal.permissions.has("procurement.purchase_order.approve");
  const canIssue = principal.permissions.has("procurement.purchase_order.issue");
  const canAmend = principal.permissions.has("procurement.purchase_order.amend");
  const canCancel = principal.permissions.has("procurement.purchase_order.cancel");
  const canClose = principal.permissions.has("procurement.purchase_order.close");
  const canReceive = principal.permissions.has("procurement.goods_receipt.create");
  const isMine = order.created_by === principal.user.id;

  const positionFor = (itemId: string) => receiptStatus.find((row) => row.purchase_order_item_id === itemId);
  const outstanding = receiptStatus.reduce(
    (total, row) => total + Number(row.outstanding_quantity),
    0,
  );
  const issued = ["issued", "partially_received", "fully_received"].includes(order.status);
  const openAmendment = amendments.find((amendment) => ["draft", "submitted", "approved"].includes(amendment.status));

  return (
    <div className="space-y-4">
      <PageHeader
        title={order.reference}
        description={`${order.supplier_name_snapshot} · version ${order.version}`}
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Purchase orders", href: "/procurement/purchase-orders" },
          { label: order.reference },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={procurementStatusTone(order.status)}>{labelForStatus(order.status)}</Badge>
            {canSubmit && order.status === "draft" ? (
              <ActionButton
                action={submitPurchaseOrderAction}
                fields={{ id: order.id }}
                label="Submit for approval"
                successMessage="Submitted for approval."
              />
            ) : null}
            {canReceive && (order.status === "issued" || order.status === "partially_received") ? (
              <Link
                href={`/procurement/goods-receipts/new?order=${order.id}`}
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                Record a delivery
              </Link>
            ) : null}
          </div>
        }
      />

      {issued ? (
        <Alert tone="warning" title="This order is issued and cannot be edited">
          What the supplier holds is fixed. Any change — quantity, price, dates, delivery point — must be raised as an
          amendment with a reason, approved, and then applied, which creates a new immutable version.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Order lines</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrapper>
              <Table className="min-w-[46rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>#</TH>
                    <TH>Product</TH>
                    <TH className="text-right">Ordered</TH>
                    <TH className="text-right">Received</TH>
                    <TH className="text-right">Accepted</TH>
                    <TH className="text-right">Outstanding</TH>
                    <TH className="text-right">Unit price</TH>
                    <TH className="text-right">Line total</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((item) => {
                    const position = positionFor(item.id);
                    return (
                      <TR key={item.id}>
                        <TD className="text-ink-muted">{item.line_number}</TD>
                        <TD>
                          <p className="font-medium text-ink">{item.product_description}</p>
                          <p className="text-[0.6875rem] text-ink-subtle">
                            {item.product_code_snapshot} · {item.unit_code_snapshot}
                          </p>
                        </TD>
                        <TD className="text-right tabular-nums">{qty(item.quantity)}</TD>
                        <TD className="text-right tabular-nums">{qty(position?.received_quantity ?? 0)}</TD>
                        <TD className="text-right tabular-nums">{qty(position?.accepted_quantity ?? 0)}</TD>
                        <TD className="text-right tabular-nums font-medium">{qty(position?.outstanding_quantity ?? item.quantity)}</TD>
                        <TD className="text-right tabular-nums">{money(order.currency_code, item.unit_price)}</TD>
                        <TD className="text-right tabular-nums font-medium">{money(order.currency_code, item.line_total)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrapper>
            <div className="grid gap-2 border-t border-border px-4 py-3 text-sm sm:grid-cols-2">
              {[
                ["Subtotal", money(order.currency_code, order.subtotal)],
                ["Discounts", money(order.currency_code, order.discount_total)],
                ["Charges", money(order.currency_code, order.charges_total)],
                ["Tax", money(order.currency_code, order.tax_total)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-ink-muted">{label}</span>
                  <span className="tabular-nums">{value}</span>
                </div>
              ))}
              <div className="flex justify-between sm:col-span-2 border-t border-border pt-2">
                <span className="font-medium text-ink">Order total</span>
                <span className="font-semibold tabular-nums text-ink">{money(order.currency_code, order.total_amount)}</span>
              </div>
              <p className="text-[0.6875rem] text-ink-subtle sm:col-span-2">
                This is a commitment, not a payable. A debt exists only when Finance records an invoice.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Order details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {[
              ["Supplier", supplier?.legal_name ?? order.supplier_name_snapshot],
              ["Supplier standing", supplier ? `${labelForStatus(supplier.status)} · ${labelForStatus(supplier.verification_status)}` : "—"],
              ["Department", department?.name ?? "—"],
              ["Procurement officer", officer ? `${officer.first_name} ${officer.last_name}` : "—"],
              ["Ordered", formatDate(order.order_date)],
              ["Expected", formatDate(order.expected_delivery_date)],
              ["Currency", order.currency_code],
              ["Exchange rate", order.exchange_rate === null ? "Base currency" : String(order.exchange_rate)],
              ["Payment terms", order.payment_terms_snapshot ?? "Not stated"],
              ["Delivery terms", order.delivery_terms_snapshot ?? "Not stated"],
              ["Version", String(order.version)],
              ["Issued", order.issued_at ? formatDateTime(order.issued_at) : "Not issued"],
              ["Outstanding quantity", qty(outstanding)],
              ["Source quotation", quotation?.reference ?? "None recorded"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3">
                <span className="text-ink-muted">{label}</span>
                <span className="text-right font-medium text-ink">{value}</span>
              </div>
            ))}
            {requisitions.filter((link) => link.requisition).length > 0 ? (
              <div className="border-t border-border pt-2">
                <p className="text-xs font-medium text-ink">Requisitions satisfied</p>
                <ul className="mt-1 space-y-0.5">
                  {requisitions.map((link) =>
                    link.requisition ? (
                      <li key={link.requisition.id}>
                        <Link
                          href={`/procurement/requisitions/${link.requisition.id}`}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          {link.requisition.reference}
                        </Link>
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {(canApprove || canIssue || canCancel || canClose) && !["closed", "cancelled"].includes(order.status) ? (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {canApprove && ["submitted", "under_review"].includes(order.status) && !authorityCovers ? (
              <Alert tone="warning" title="No approval authority covers this amount">
                Your configured authority does not extend to {money(order.currency_code, order.total_amount)} for purchase
                orders. The approval would be refused — an administrator has to configure the authority, not override the
                rule.
              </Alert>
            ) : null}
            {isMine ? (
              <Alert tone="warning" title="You created this order">
                You cannot approve or issue a document you created. Separation of duties is enforced in the database, not
                just in this interface.
              </Alert>
            ) : null}

            {canApprove && ["submitted", "under_review"].includes(order.status) ? (
              <ActionForm
                action={decidePurchaseOrderAction}
                submitLabel="Record decision"
                successMessage="Decision recorded."
                hidden={{ id: order.id, reference: order.reference }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="decision">Decision</Label>
                    <select
                      id="decision"
                      name="decision"
                      className="h-9.5 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm"
                    >
                      <option value="approve">Approve</option>
                      <option value="reject">Reject</option>
                    </select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="comment">Comment</Label>
                    <Textarea id="comment" name="comment" rows={2} />
                  </div>
                </div>
              </ActionForm>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {canIssue && order.status === "approved" ? (
                <ActionButton
                  action={decidePurchaseOrderAction}
                  fields={{ id: order.id, reference: order.reference, decision: "issue" }}
                  label="Issue to supplier"
                  confirmMessage="Issuing freezes this order and takes an immutable snapshot. Continue?"
                  successMessage="Order issued."
                />
              ) : null}
              {canClose && (order.status === "partially_received" || order.status === "issued") ? (
                <ActionButton
                  action={decidePurchaseOrderAction}
                  fields={{ id: order.id, reference: order.reference, decision: "close", comment: "Closed with quantities outstanding" }}
                  label="Close with balance outstanding"
                  variant="secondary"
                  confirmMessage="Closing stops further deliveries. Quantities still outstanding will remain undelivered. Continue?"
                  successMessage="Order closed."
                />
              ) : null}
              {canCancel && !issued ? (
                <ActionButton
                  action={decidePurchaseOrderAction}
                  fields={{ id: order.id, reference: order.reference, decision: "cancel", comment: "Cancelled before issue" }}
                  label="Cancel order"
                  variant="danger"
                  confirmMessage="Cancel this order?"
                  successMessage="Order cancelled."
                />
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <AmendmentPanel
        orderId={order.id}
        orderReference={order.reference}
        version={order.version}
        status={order.status}
        items={items.map((item) => ({
          id: item.id,
          label: `Line ${item.line_number} · ${item.product_description} · ${qty(item.quantity)} ${item.unit_code_snapshot} @ ${item.unit_price}`,
        }))}
        amendments={amendments}
        canAmend={canAmend}
        canApprove={canApprove}
        requiresApproval={settings.poAmendmentRequiresApproval}
        options={amendmentOptions}
        openAmendment={openAmendment}
        actions={{ applyAmendmentAction, decideAmendmentAction }}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Deliveries</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {receipts.length === 0 ? (
              <p className="px-4 pb-4 text-xs text-ink-muted">Nothing has been received against this order.</p>
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Receipt</TH>
                      <TH>Date</TH>
                      <TH>Status</TH>
                      <TH>Posting reference</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {receipts.map((receipt) => (
                      <TR key={receipt.id}>
                        <TD>
                          <Link
                            href={`/procurement/goods-receipts/${receipt.id}`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            {receipt.reference}
                          </Link>
                        </TD>
                        <TD>{formatDate(receipt.receipt_date)}</TD>
                        <TD>
                          <Badge tone={procurementStatusTone(receipt.status)}>{labelForStatus(receipt.status)}</Badge>
                        </TD>
                        <TD className="text-ink-muted">{receipt.posting_reference ?? "Not posted"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Version history</CardTitle>
          </CardHeader>
          <CardContent>
            {versions.length === 0 ? (
              <p className="text-xs text-ink-muted">
                No version exists yet: a snapshot is written when the order is issued.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {versions.map((version) => (
                  <li key={version.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-ink">
                      Version {version.version} · {money(version.currency_code, version.total_amount)}
                    </span>
                    <span className="text-xs text-ink-subtle">{formatDateTime(version.created_at)}</span>
                    <p className="w-full text-xs text-ink-muted">{version.reason ?? "—"}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status trail</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-xs text-ink-muted">No status changes recorded.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-ink">
                        {entry.from_status ? `${labelForStatus(entry.from_status)} → ` : ""}
                        <span className="font-medium">{labelForStatus(entry.to_status)}</span>
                      </span>
                      <span className="text-xs text-ink-subtle">{formatDateTime(entry.created_at)}</span>
                    </div>
                    {entry.reason ? <p className="text-xs text-ink-muted">{entry.reason}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approval decisions</CardTitle>
          </CardHeader>
          <CardContent>
            {approvals.length === 0 ? (
              <p className="text-xs text-ink-muted">No decision recorded yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {approvals.map((approval) => (
                  <li key={approval.id}>
                    <p className="font-medium text-ink">
                      {labelForStatus(approval.decision)} by {approval.decided_by_name ?? "an unnamed user"}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {formatDateTime(approval.created_at)}
                      {approval.amount_at_decision === null
                        ? ""
                        : ` · ${money(approval.currency_code ?? order.currency_code, approval.amount_at_decision)} at decision`}
                    </p>
                    {approval.comment ? <p className="text-xs text-ink-muted">{approval.comment}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <DocumentRegister
        entityType="purchase_order"
        entityId={order.id}
        entityReference={order.reference}
        documents={documents}
        canUpload={principal.permissions.has("procurement.document.upload")}
      />
    </div>
  );
}
