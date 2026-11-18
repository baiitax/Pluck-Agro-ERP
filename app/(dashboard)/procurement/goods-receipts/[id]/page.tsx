import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton, ActionForm } from "@/components/procurement/action-form";
import { DocumentRegister, DocumentRegisterFallback } from "@/components/procurement/document-register";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { labelForStatus, procurementStatusTone } from "@/lib/procurement/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getGoodsReceiptDetail } from "@/services/procurement/goods-receipts";
import {
  decideGoodsReceiptAction,
  postGoodsReceiptAction,
  recordInspectionAction,
  submitGoodsReceiptAction,
} from "../../actions";

export const metadata: Metadata = { title: "Goods receipt" };
export const dynamic = "force-dynamic";

const qty = (value: number | null) => (value === null ? "—" : new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(value));

const money = (currency: string, value: number | null) =>
  value === null
    ? "—"
    : `${currency} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

/**
 * One goods receipt.
 *
 * The page keeps three facts apart: what the supplier delivered (the receipt), what the inspection
 * concluded, and what has been posted. Posting is the only step that produces stock, and it happens
 * once — the idempotency key below is fixed per receipt, so a retried click returns the original
 * posting rather than writing a second delivery.
 */
export default async function GoodsReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.goods_receipt.view")) {
    return <PermissionGuard permission="procurement.goods_receipt.view" />;
  }

  const { id } = await params;
  const detail = await getGoodsReceiptDetail(id).catch(() => null);
  if (!detail) notFound();

  const { receipt, order, supplier, warehouse, items, inspections, posting, history, approvals, documents, outbox, settings } =
    detail;

  const canReview = principal.permissions.has("procurement.goods_receipt.review");
  const canApprove = principal.permissions.has("procurement.goods_receipt.approve");
  const canPost = principal.permissions.has("procurement.goods_receipt.post");
  const canCreate = principal.permissions.has("procurement.goods_receipt.create");

  const posted = receipt.status === "posted";
  const idempotencyKey = `grn-posted:${receipt.id}`;

  const totals = items.reduce(
    (accumulator, item) => ({
      received: accumulator.received + Number(item.received_quantity),
      accepted: accumulator.accepted + Number(item.accepted_quantity),
      rejected: accumulator.rejected + Number(item.rejected_quantity),
      quarantined: accumulator.quarantined + Number(item.quarantined_quantity),
    }),
    { received: 0, accepted: 0, rejected: 0, quarantined: 0 },
  );

  const acceptedValue = items.reduce(
    (sum, item) => sum + Number(item.accepted_quantity) * Number(item.purchase_order_item?.unit_price ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Goods receipt ${receipt.reference}`}
        description={`Delivery against ${order?.reference ?? "an order"}. Accepted quantities become stock only when this receipt is posted.`}
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Goods receipts", href: "/procurement/goods-receipts" },
          { label: receipt.reference },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={procurementStatusTone(receipt.status)}>{labelForStatus(receipt.status)}</Badge>
            {canCreate && ["draft", "returned"].includes(receipt.status) ? (
              <ActionButton
                action={submitGoodsReceiptAction}
                fields={{ id: receipt.id }}
                label="Submit for review"
                successMessage="Receipt submitted."
              />
            ) : null}
            {canPost && receipt.status === "approved" ? (
              <ActionButton
                action={postGoodsReceiptAction}
                fields={{ receiptId: receipt.id, reference: receipt.reference, idempotencyKey }}
                label="Post this receipt"
                confirmMessage="Posting is one-time and creates the stock movement record. Continue?"
                successMessage="Receipt posted."
              />
            ) : null}
          </div>
        }
      />

      {posted ? (
        <Alert tone="success" title={`Posted as ${receipt.posting_reference}`}>
          Posted on {formatDateTime(receipt.posted_at)}. The receipt can no longer be edited; a correction is a separate
          record, not a change to this one. Accepted quantities are waiting on the inventory handoff.
        </Alert>
      ) : receipt.status === "approved" ? (
        <Alert tone="warning" title="Approved, not yet posted">
          Approval confirms the delivery was received as recorded. Posting is the separate act that turns accepted
          quantities into stock, and it happens once.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Delivery</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-ink-muted">Purchase order</p>
              <p className="text-ink">
                {order ? (
                  <Link href={`/procurement/purchase-orders/${order.id}`} className="text-brand-700 hover:underline">
                    {order.reference}
                  </Link>
                ) : (
                  "—"
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Supplier</p>
              <p className="text-ink">{supplier?.legal_name ?? order?.supplier_name_snapshot ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Receipt date</p>
              <p className="text-ink">{formatDate(receipt.receipt_date)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Supplier delivery note</p>
              <p className="text-ink">{receipt.supplier_delivery_note_number ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Delivery reference</p>
              <p className="text-ink">{receipt.delivery_reference ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Delivered to</p>
              <p className="text-ink">{warehouse?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Vehicle</p>
              <p className="text-ink">{receipt.vehicle_reference ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Transporter</p>
              <p className="text-ink">{receipt.transporter_name ?? "—"}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-ink-muted">Observations</p>
              <p className="text-ink">{receipt.observations ?? "—"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quantities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Received</span>
              <span className="tabular-nums text-ink">{qty(totals.received)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Accepted</span>
              <span className="tabular-nums text-ink">{qty(totals.accepted)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Rejected</span>
              <span className={cn("tabular-nums", totals.rejected > 0 ? "text-danger-700" : "text-ink")}>
                {qty(totals.rejected)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-muted">Quarantined</span>
              <span className="tabular-nums text-ink">{qty(totals.quarantined)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-ink-muted">Accepted value</span>
              <span className="tabular-nums text-ink">{money(order?.currency_code ?? "", acceptedValue)}</span>
            </div>
            <p className="pt-1 text-[0.6875rem] text-ink-subtle">
              Received must equal accepted + rejected + quarantined on every line. Only accepted quantity is stock.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Received lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TableWrapper>
            <Table className="min-w-[56rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Line</TH>
                  <TH>Product</TH>
                  <TH className="text-right">Ordered</TH>
                  <TH className="text-right">Received before</TH>
                  <TH className="text-right">Received now</TH>
                  <TH className="text-right">Accepted</TH>
                  <TH className="text-right">Rejected</TH>
                  <TH className="text-right">Quarantined</TH>
                  <TH>Reason</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((item) => (
                  <TR key={item.id}>
                    <TD className="text-ink-muted">{item.line_number}</TD>
                    <TD>
                      <p className="font-medium text-ink">{item.product_description}</p>
                      <p className="text-[0.6875rem] text-ink-subtle">{item.unit_code_snapshot}</p>
                    </TD>
                    <TD className="text-right tabular-nums">{qty(Number(item.ordered_quantity))}</TD>
                    <TD className="text-right tabular-nums">{qty(Number(item.previously_received_quantity))}</TD>
                    <TD className="text-right tabular-nums font-medium">{qty(Number(item.received_quantity))}</TD>
                    <TD className="text-right tabular-nums">{qty(Number(item.accepted_quantity))}</TD>
                    <TD className="text-right tabular-nums">
                      {Number(item.rejected_quantity) > 0 ? (
                        <span className="text-danger-700">{qty(Number(item.rejected_quantity))}</span>
                      ) : (
                        qty(Number(item.rejected_quantity))
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{qty(Number(item.quarantined_quantity))}</TD>
                    <TD className="max-w-[16rem] text-xs text-ink-muted">{item.rejection_reason ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Inspection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {inspections.length === 0 ? (
              <p className="text-xs text-ink-muted">No inspection has been recorded for this delivery.</p>
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Type</TH>
                      <TH>Result</TH>
                      <TH>Inspected</TH>
                      <TH>By</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {inspections.map((inspection) => (
                      <TR key={inspection.id}>
                        <TD className="text-xs">{labelForStatus(inspection.inspection_type)}</TD>
                        <TD>
                          <Badge
                            tone={
                              inspection.result === "passed"
                                ? "success"
                                : inspection.result === "failed"
                                  ? "danger"
                                  : inspection.result === "partial"
                                    ? "warning"
                                    : "neutral"
                            }
                          >
                            {labelForStatus(inspection.result)}
                          </Badge>
                        </TD>
                        <TD className="text-xs">{formatDateTime(inspection.inspected_at)}</TD>
                        <TD className="text-xs text-ink-muted">{inspection.inspected_by_name ?? "—"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}

            {canReview && !posted && receipt.status !== "cancelled" ? (
              <div className="rounded-lg border border-border p-3">
                <p className="pb-2 text-xs font-medium text-ink">Record an inspection</p>
                <ActionForm
                  action={recordInspectionAction}
                  submitLabel="Record inspection"
                  successMessage="Inspection recorded."
                  hidden={{ goodsReceiptId: receipt.id, reference: receipt.reference }}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <div className="space-y-1">
                    <Label htmlFor="inspectionType">Inspection type</Label>
                    <Select id="inspectionType" name="inspectionType" defaultValue="quantity_and_condition">
                      <option value="quantity_and_condition">Quantity and condition</option>
                      <option value="quality">Quality</option>
                      <option value="documentation">Documentation</option>
                      <option value="other">Other</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="result">Result</Label>
                    <Select id="result" name="result" defaultValue="passed">
                      <option value="pending">Pending</option>
                      <option value="passed">Passed</option>
                      <option value="partial">Partial</option>
                      <option value="failed">Failed</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="quantityInspected">Quantity inspected</Label>
                    <Input id="quantityInspected" name="quantityInspected" inputMode="decimal" placeholder="Optional" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="goodsReceiptItemId">Line</Label>
                    <Select id="goodsReceiptItemId" name="goodsReceiptItemId" defaultValue="">
                      <option value="">Whole delivery</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          Line {item.line_number} · {item.product_description}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="findings">Findings</Label>
                    <Textarea id="findings" name="findings" rows={2} required placeholder="What the inspection found." />
                    <FieldError message={undefined} />
                  </div>
                </ActionForm>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Posting</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {posting ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-ink-muted">Posting reference</span>
                  <span className="font-medium text-ink">{posting.posting_reference}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-muted">Posted at</span>
                  <span className="text-ink">{formatDateTime(posting.posted_at)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-muted">Posted by</span>
                  <span className="text-ink">{posting.posted_by ?? "—"}</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-ink-muted">
                Nothing is posted. Stock does not exist for this delivery until a receipt is posted.
              </p>
            )}

            <div className="border-t border-border pt-2">
              <p className="pb-1 text-xs font-medium text-ink">Inventory handoff</p>
              {outbox.length === 0 ? (
                <p className="text-xs text-ink-muted">
                  No handoff event yet. Posting writes one outbox event; nothing consumes it until inventory exists.
                </p>
              ) : (
                <ul className="space-y-1">
                  {outbox.map((event) => (
                    <li key={event.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-ink">{event.event_type}</span>
                      <Badge tone={event.status === "dispatched" ? "success" : "neutral"}>
                        {labelForStatus(event.status)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="pt-2 text-[0.6875rem] text-ink-subtle">
                The event carries the accepted quantities. Until an inventory module consumes it, this is a queued
                handoff, not stock.
              </p>
            </div>

            {canPost && receipt.status === "approved" ? (
              <div className="rounded-lg border border-border p-3">
                <ActionForm
                  action={postGoodsReceiptAction}
                  submitLabel="Post receipt"
                  successMessage="Receipt posted."
                  hidden={{ receiptId: receipt.id, reference: receipt.reference, idempotencyKey }}
                  className="space-y-2"
                >
                  <p className="text-xs text-ink-muted">
                    Posting is one-time. The key for this receipt is fixed, so retrying cannot post the same delivery
                    twice.
                  </p>
                  {canApprove ? (
                    <label className="flex items-start gap-2 text-xs text-ink">
                      <input type="checkbox" name="allowExcess" className="mt-0.5" />
                      <span>
                        Authorise this as an excess delivery. The tolerance in policy is{" "}
                        {settings.excessReceiptTolerancePercent}%, and anything beyond it is refused unless someone
                        holding procurement.goods_receipt.approve says otherwise — this tick is that statement.
                      </span>
                    </label>
                  ) : (
                    <p className="text-[0.6875rem] text-ink-subtle">
                      Quantities beyond the {settings.excessReceiptTolerancePercent}% tolerance can only be posted by
                      someone who may approve an excess delivery.
                    </p>
                  )}
                </ActionForm>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {(canReview || canApprove) && ["submitted", "under_review"].includes(receipt.status) ? (
        <Card>
          <CardHeader>
            <CardTitle>Review decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-ink-muted">
              Reviewing checks the delivery against the order. Approval is what allows the receipt to be posted — it does
              not post it.
            </p>
            <ActionForm
              action={decideGoodsReceiptAction}
              submitLabel="Record decision"
              successMessage="Decision recorded."
              hidden={{ id: receipt.id, reference: receipt.reference }}
              className="grid gap-2 sm:grid-cols-2"
            >
              <div className="space-y-1">
                <Label htmlFor="decision">Decision</Label>
                <Select id="decision" name="decision" defaultValue="approve">
                  <option value="approve">Approve the delivery</option>
                  <option value="return">Return for correction</option>
                  <option value="reject">Reject</option>
                  <option value="cancel">Cancel</option>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="comment">Comment</Label>
                <Textarea id="comment" name="comment" rows={2} placeholder="Required when rejecting, returning or cancelling." />
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {history.length === 0 ? (
              <p className="text-xs text-ink-muted">No status changes recorded.</p>
            ) : (
              <ol className="space-y-2">
                {history.map((entry) => (
                  <li key={entry.id} className="flex items-start justify-between gap-3 text-xs">
                    <div>
                      <p className="text-ink">
                        {entry.from_status ? `${labelForStatus(entry.from_status)} → ` : ""}
                        {labelForStatus(entry.to_status)}
                      </p>
                      <p className="text-ink-subtle">
                        {entry.actor_name ?? "System"} · {formatDateTime(entry.created_at)}
                      </p>
                      {entry.reason ? <p className="text-ink-muted">{entry.reason}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approvals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {approvals.length === 0 ? (
              <p className="text-xs text-ink-muted">No approval decisions recorded.</p>
            ) : (
              <ul className="space-y-2">
                {approvals.map((decision) => (
                  <li key={decision.id} className="text-xs">
                    <p className="text-ink">
                      {labelForStatus(decision.decision)}
                      {decision.stage ? ` · ${decision.stage}` : ""}
                    </p>
                    <p className="text-ink-subtle">
                      {decision.decided_by_name ?? "—"} · {formatDateTime(decision.created_at)}
                    </p>
                    {decision.comment ? <p className="text-ink-muted">{decision.comment}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {principal.permissions.has("procurement.document.view") ? (
        <DocumentRegister
          entityType="goods_receipt"
          entityId={receipt.id}
          entityReference={receipt.reference}
          documents={(documents ?? []).map((document) => ({
            id: document.id,
            title: document.title,
            document_type: document.document_type,
            file_name: document.file_name,
            file_size_bytes: document.file_size_bytes,
            uploaded_at: document.uploaded_at,
            storage_path: document.storage_path,
          }))}
          canUpload={principal.permissions.has("procurement.document.upload")}
        />
      ) : (
        <DocumentRegisterFallback reference={receipt.reference} />
      )}

      <div>
        <Link href="/procurement/goods-receipts" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
          Back to receipts
        </Link>
      </div>
    </div>
  );
}
