import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Truck } from "lucide-react";

import { ActionButton, ActionForm } from "@/components/shared/action-form";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDateTime } from "@/lib/formatting";
import { inventoryStatusTone, labelForInventoryStatus } from "@/lib/inventory/statuses";
import { cn } from "@/lib/utils";
import {
  decideTransferAction,
  dispatchTransferAction,
  receiveTransferAction,
  submitTransferAction,
} from "@/app/(dashboard)/inventory/actions";
import { requireActiveProfile } from "@/services/authorization";
import { getTransferDetail } from "@/services/inventory/transfers";

export const metadata: Metadata = { title: "Stock transfer" };
export const dynamic = "force-dynamic";

const number = (value: number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

/**
 * One transfer.
 *
 * The buttons offered match the lifecycle, and each one is guarded twice: the interface only renders a move
 * the caller's permission allows, and the database refuses a move the lifecycle does not allow. Dispatch is
 * the moment stock leaves the source warehouse, so it is the one button described in full before it is pressed.
 */
export default async function TransferDetailPage({ params }: { params: Promise<{ transferId: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.transfer.view")) {
    return <PermissionGuard permission="inventory.transfer.view" />;
  }

  const { transferId } = await params;
  const detail = await getTransferDetail(transferId).catch(() => null);
  if (!detail) notFound();

  const { transfer, items, inTransit, blockers } = detail;
  const canApprove = principal.permissions.has("inventory.transfer.approve");
  const canExecute = principal.permissions.has("inventory.transfer.execute");

  return (
    <div className="space-y-4">
      <PageHeader
        title={transfer.reference}
        description={`${transfer.fromWarehouseName ?? "—"} → ${transfer.toWarehouseName ?? "—"}`}
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Transfers", href: "/inventory/transfers" },
          { label: transfer.reference },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={inventoryStatusTone(transfer.status)} dot>
              {labelForInventoryStatus(transfer.status)}
            </Badge>
            <Link
              href="/inventory/transfers"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              <ArrowLeft aria-hidden /> All transfers
            </Link>
          </div>
        }
      />

      {transfer.status === "draft" && principal.permissions.has("inventory.transfer.create") ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-ink-muted">Submit this transfer so it can be approved.</p>
            <ActionButton
              action={submitTransferAction}
              fields={{ transferId: transfer.id }}
              label="Submit for approval"
              successMessage="Transfer submitted."
            />
          </CardContent>
        </Card>
      ) : null}

      {transfer.status === "submitted" && canApprove ? (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={decideTransferAction}
              submitLabel="Approve transfer"
              successMessage="Transfer approved."
            >
              <input type="hidden" name="transferId" value={transfer.id} />
              <input type="hidden" name="decision" value="approved" />
              {transfer.status_reason ? null : (
                <div className="space-y-1">
                  <Label htmlFor="reason">Note (optional when approving)</Label>
                  <Input id="reason" name="reason" className="h-8 text-xs" />
                </div>
              )}
            </ActionForm>
            <div className="mt-3 border-t border-border pt-3">
              <ActionForm
                action={decideTransferAction}
                submitLabel="Reject transfer"
                successMessage="Transfer rejected."
              >
                <input type="hidden" name="transferId" value={transfer.id} />
                <input type="hidden" name="decision" value="rejected" />
                <div className="space-y-1">
                  <Label htmlFor="reject-reason">Why is it rejected?</Label>
                  <Textarea id="reject-reason" name="reason" rows={2} className="text-xs" required />
                </div>
              </ActionForm>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {transfer.status === "approved" && canExecute ? (
        <Card>
          <CardHeader>
            <CardTitle>Dispatch</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink-muted">
              Dispatching posts one <span className="font-medium">transfer out</span> movement per line. The stock
              leaves the source warehouse immediately and appears as in transit until it is received. A line whose
              lot no longer has enough available quantity will refuse, and nothing will be posted for that
              transfer.
            </p>
            <ActionButton
              action={dispatchTransferAction}
              fields={{ transferId: transfer.id }}
              label="Dispatch transfer"
              pendingLabel="Dispatching…"
              successMessage="Dispatched. The stock is now in transit."
              confirmMessage="Post the transfer-out movements now?"
            />
          </CardContent>
        </Card>
      ) : null}

      {transfer.status === "dispatched" && canExecute ? (
        <Card>
          <CardHeader>
            <CardTitle>Receipt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink-muted">
              Receiving creates a new lot in the destination warehouse for each line, inheriting the supplier,
              expiry and grade of the source lot, and posts the matching transfer in. A short receipt leaves the
              difference in transit rather than closing the gap silently.
            </p>
            <ActionButton
              action={receiveTransferAction}
              fields={{ transferId: transfer.id }}
              label="Receive at destination"
              pendingLabel="Receiving…"
              successMessage="Received at the destination warehouse."
              confirmMessage="Create the destination lots and post the transfer-in movements?"
            />
          </CardContent>
        </Card>
      ) : null}

      {blockers.length > 0 && transfer.status !== "received" && transfer.status !== "cancelled" ? (
        <Alert tone="info" title="What is needed next">
          <ul className="list-disc space-y-0.5 pl-4 text-xs">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <EmptyState icon={Truck} title="No lines" description="This transfer has no lots on it." />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Line</TH>
                    <TH>Product</TH>
                    <TH>Source lot</TH>
                    <TH className="text-right">Quantity</TH>
                    <TH className="text-right">Received</TH>
                    <TH>Destination lot</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((item) => (
                    <TR key={item.id}>
                      <TD className="tabular-nums">{item.line_number}</TD>
                      <TD>
                        <span className="font-mono text-xs text-ink-subtle">{item.productCode}</span>
                        <span className="ml-2">{item.productName}</span>
                      </TD>
                      <TD className="font-mono text-xs">{item.lotReference}</TD>
                      <TD className="text-right tabular-nums">
                        {number(item.quantity)} {item.unitCode}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {item.quantity_received === null ? "—" : number(item.quantity_received)}
                      </TD>
                      <TD className="font-mono text-xs">
                        {item.destination_lot_id ? (
                          <Link
                            href={`/inventory/lots/${item.destination_lot_id}`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            Open lot
                          </Link>
                        ) : (
                          "Created on receipt"
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      {inTransit.length > 0 ? (
        <Alert tone="warning" title="This transfer is still partly in transit">
          <ul className="list-disc space-y-0.5 pl-4 text-xs">
            {inTransit.map((row) => (
              <li key={`${row.transfer_id}-${row.product_id}`}>
                {row.product_name}: {number(row.dispatched_quantity)} dispatched, {number(row.received_quantity)}{" "}
                received, {number(row.in_transit_quantity)} still out
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Trail</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div>Created {formatDateTime(transfer.created_at)}</div>
          <div>Approved {transfer.approved_at ? formatDateTime(transfer.approved_at) : "—"}</div>
          <div>Dispatched {transfer.dispatched_at ? formatDateTime(transfer.dispatched_at) : "—"}</div>
          <div>Received {transfer.received_at ? formatDateTime(transfer.received_at) : "—"}</div>
          {transfer.transfer_reason ? <div className="sm:col-span-2">Reason: {transfer.transfer_reason}</div> : null}
          {transfer.status_reason ? (
            <div className="sm:col-span-2 text-ink-muted">Status note: {transfer.status_reason}</div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
