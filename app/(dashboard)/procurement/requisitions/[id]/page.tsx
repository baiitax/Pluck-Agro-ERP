import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton, ActionForm } from "@/components/procurement/action-form";
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
import {
  REQUISITION_EDITABLE_STATUSES,
  isEditable,
  labelForStatus,
  procurementStatusTone,
} from "@/lib/procurement/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getRequisitionDetail, requisitionDecisionPreview } from "@/services/procurement/requisitions";
import { decideRequisitionAction, submitRequisitionAction } from "../../actions";

export const metadata: Metadata = { title: "Requisition" };
export const dynamic = "force-dynamic";

const qty = (value: number) => new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(value);
const money = (currency: string, value: number | null) =>
  value === null
    ? "—"
    : `${currency} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

export default async function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.requisition.view")) {
    return <PermissionGuard permission="procurement.requisition.view" />;
  }

  const { id } = await params;
  let detail: Awaited<ReturnType<typeof getRequisitionDetail>>;
  try {
    detail = await getRequisitionDetail(id);
  } catch {
    notFound();
  }

  const { requisition, items, department, employee, supplier, warehouse, history, approvals, allocations, documents, fulfilment } =
    detail;

  const canApprove = principal.permissions.has("procurement.requisition.approve");
  const canReject = principal.permissions.has("procurement.requisition.reject");
  const canCancel = principal.permissions.has("procurement.requisition.cancel");
  const canSubmit = principal.permissions.has("procurement.requisition.submit");
  const canEdit = principal.permissions.has("procurement.requisition.update") && isEditable(requisition.status, REQUISITION_EDITABLE_STATUSES);
  const authorityCovers = canApprove
    ? await requisitionDecisionPreview(requisition.estimated_total, requisition.currency_code)
    : false;
  const isMine = requisition.created_by === principal.user.id;

  return (
    <div className="space-y-4">
      <PageHeader
        title={requisition.reference}
        description={requisition.purpose}
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Requisitions", href: "/procurement/requisitions" },
          { label: requisition.reference },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={procurementStatusTone(requisition.status)}>{labelForStatus(requisition.status)}</Badge>
            {canEdit ? (
              <Link
                href={`/procurement/requisitions/${requisition.id}/edit`}
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                Edit draft
              </Link>
            ) : null}
            {canSubmit && requisition.status === "draft" ? (
              <ActionButton
                action={submitRequisitionAction}
                fields={{ id: requisition.id }}
                label="Submit for approval"
                variant="primary"
                successMessage="Submitted for approval."
              />
            ) : null}
          </div>
        }
      />

      {requisition.status === "submitted" ? (
        <Alert tone="info" title="Awaiting review">
          An approver moves this to review before deciding. The approval needs both the permission and a configured
          approval authority covering {money(requisition.currency_code, requisition.estimated_total)}.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Lines</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrapper>
              <Table className="min-w-[44rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>#</TH>
                    <TH>Product</TH>
                    <TH>Description as requested</TH>
                    <TH className="text-right">Quantity</TH>
                    <TH>Unit</TH>
                    <TH className="text-right">Est. unit price</TH>
                    <TH className="text-right">Est. line value</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((item) => (
                    <TR key={item.id}>
                      <TD className="text-ink-muted">{item.line_number}</TD>
                      <TD>
                        <p className="font-medium text-ink">{item.product?.name ?? item.product_description}</p>
                        <p className="text-[0.6875rem] text-ink-subtle">{item.product?.code ?? "—"}</p>
                      </TD>
                      <TD className="text-ink-muted">{item.specification_notes ?? "—"}</TD>
                      <TD className="text-right tabular-nums">{qty(item.quantity)}</TD>
                      <TD>{item.unit?.code ?? "—"}</TD>
                      <TD className="text-right tabular-nums">{money(requisition.currency_code, item.estimated_unit_price)}</TD>
                      <TD className="text-right tabular-nums font-medium">
                        {item.estimated_unit_price === null ? "—" : money(requisition.currency_code, item.quantity * item.estimated_unit_price)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Request details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {[
              ["Department", department?.name ?? "—"],
              ["Requested by", employee ? `${employee.first_name} ${employee.last_name}` : "—"],
              ["Raised", formatDate(requisition.requisition_date)],
              ["Required by", formatDate(requisition.required_delivery_date)],
              ["Priority", labelForStatus(requisition.priority)],
              ["Currency", requisition.currency_code],
              ["Estimated total", money(requisition.currency_code, requisition.estimated_total)],
              ["Preferred supplier", supplier?.legal_name ?? "No preference"],
              ["Deliver to", warehouse?.name ?? "Not decided"],
              ["Submitted", requisition.submitted_at ? formatDateTime(requisition.submitted_at) : "Not yet"],
              ["Approved", requisition.approved_at ? formatDateTime(requisition.approved_at) : "Not yet"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3">
                <span className="text-ink-muted">{label}</span>
                <span className="text-right font-medium text-ink">{value}</span>
              </div>
            ))}
            {requisition.justification ? (
              <div className="border-t border-border pt-2">
                <p className="text-xs font-medium text-ink">Justification</p>
                <p className="mt-1 text-xs text-ink-muted">{requisition.justification}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {fulfilment ? (
        <Card>
          <CardHeader>
            <CardTitle>Fulfilment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-ink-muted">Requested</p>
              <p className="font-medium tabular-nums">{qty(fulfilment.requested_quantity)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Allocated to orders</p>
              <p className="font-medium tabular-nums">{qty(fulfilment.allocated_quantity)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Still to order</p>
              <p className="font-medium tabular-nums">{qty(fulfilment.outstanding_quantity)}</p>
            </div>
            <p className="text-[0.6875rem] text-ink-subtle sm:col-span-3">
              Allocation is what makes a split possible: one requisition may be ordered across several purchase orders,
              and each allocation is kept against the order line that consumed it.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {allocations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Allocations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrapper>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Allocated quantity</TH>
                    <TH>Purchase order</TH>
                    <TH>Order status</TH>
                  </TR>
                </THead>
                <TBody>
                  {allocations.map((allocation) => {
                    const order = (allocation as unknown as {
                      purchase_order_item: { purchase_order: { id: string; reference: string; status: string } | null } | null;
                    }).purchase_order_item?.purchase_order;
                    return (
                      <TR key={allocation.id}>
                        <TD className="tabular-nums">{qty(allocation.allocated_quantity)}</TD>
                        <TD>
                          {order ? (
                            <Link href={`/procurement/purchase-orders/${order.id}`} className="text-brand-700 hover:underline">
                              {order.reference}
                            </Link>
                          ) : (
                            "Not linked"
                          )}
                        </TD>
                        <TD>{order ? labelForStatus(order.status) : "—"}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrapper>
          </CardContent>
        </Card>
      ) : null}

      {(canApprove || canReject || canCancel) && ["submitted", "under_review", "approved"].includes(requisition.status) ? (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {canApprove && !authorityCovers ? (
              <Alert tone="warning" title="Your approval authority does not cover this amount">
                Approving this requisition needs an approval authority configured for procurement requisitions at{" "}
                {money(requisition.currency_code, requisition.estimated_total)}. No such authority covers you, so the
                approve button will be refused — ask an administrator to configure it rather than working around it.
              </Alert>
            ) : null}
            {isMine ? (
              <Alert tone="warning" title="You raised this request">
                You cannot approve a requisition you created. Another authorised user must decide it.
              </Alert>
            ) : null}
            <ActionForm
              action={decideRequisitionAction}
              submitLabel="Record decision"
              hidden={{ id: requisition.id, reference: requisition.reference }}
              successMessage="Decision recorded."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="decision">Decision</Label>
                  <select
                    id="decision"
                    name="decision"
                    className="h-9.5 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm"
                    defaultValue="approve"
                  >
                    {canApprove ? (
                      <>
                        <option value="approve">Approve</option>
                        <option value="reject">Reject</option>
                      </>
                    ) : null}
                    {canCancel ? <option value="cancel">Cancel</option> : null}
                  </select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="comment">Comment</Label>
                  <Textarea id="comment" name="comment" rows={2} placeholder="A reason is required when rejecting." />
                </div>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status trail</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-xs text-ink-muted">No status changes recorded — this document is still a draft.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {history.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-ink">
                      {entry.from_status ? `${labelForStatus(entry.from_status)} → ` : ""}
                      <span className="font-medium">{labelForStatus(entry.to_status)}</span>
                    </span>
                    <span className="text-xs text-ink-subtle">{formatDateTime(entry.created_at)}</span>
                    {entry.reason ? <p className="w-full text-xs text-ink-muted">{entry.reason}</p> : null}
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
              <p className="text-xs text-ink-muted">No decision has been recorded yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {approvals.map((approval) => (
                  <li key={approval.id}>
                    <p className="font-medium text-ink">
                      {labelForStatus(approval.decision)} by {approval.decided_by_name ?? "an unnamed user"}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {formatDateTime(approval.created_at)} · authority {approval.authority_id ? "recorded" : "not required"}
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
        entityType="purchase_requisition"
        entityId={requisition.id}
        entityReference={requisition.reference}
        documents={documents}
        canUpload={principal.permissions.has("procurement.document.upload")}
      />
    </div>
  );
}
