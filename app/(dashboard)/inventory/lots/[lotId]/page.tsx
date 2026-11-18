import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History, Lock, PackageOpen } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { formatMovementQuantity, inventoryStatusTone, labelForInventoryStatus } from "@/lib/inventory/statuses";
import { cn } from "@/lib/utils";
import { ActionForm } from "@/components/shared/action-form";
import { applyRestrictionAction, releaseRestrictionAction, reserveStockAction } from "@/app/(dashboard)/inventory/actions";
import { requireActiveProfile } from "@/services/authorization";
import { getLotDetail } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "Lot" };
export const dynamic = "force-dynamic";

const number = (value: number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

/**
 * One lot, in full.
 *
 * The header states the four quantities and what produced them. Below it, three registers that a person can
 * check against each other: movements (what happened), restrictions (what is held and why) and reservations
 * (what is promised). The forms on this page are the only way to change availability, and both of them are
 * database functions with their own refusals.
 */
export default async function LotDetailPage({ params }: { params: Promise<{ lotId: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.stock.view")) {
    return <PermissionGuard permission="inventory.stock.view" />;
  }

  const { lotId } = await params;
  const detail = await getLotDetail(lotId).catch(() => null);
  if (!detail) notFound();

  const { lot, movements, restrictions, reservations, source } = detail;
  const activeRestrictions = restrictions.filter(
    (row) => row.status === "active" || row.status === "partially_released",
  );
  const activeReservations = reservations.filter(
    (row) => row.status === "active" || row.status === "partially_released",
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={lot.lot_reference}
        description={`${lot.product_code} · ${lot.product_name} · ${lot.warehouse_name}`}
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Lots", href: "/inventory/lots" },
          { label: lot.lot_reference },
        ]}
        actions={
          <Link href="/inventory/lots" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            <ArrowLeft aria-hidden /> All lots
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "On hand", value: number(lot.on_hand_quantity), hint: "Sum of posted movements" },
          { label: "Restricted", value: number(lot.restricted_quantity), hint: "Held by a restriction" },
          { label: "Reserved", value: number(lot.reserved_quantity), hint: "Claimed by another document" },
          { label: "Available", value: number(lot.available_quantity), hint: "What an issue may use" },
        ].map((metric) => (
          <Card key={metric.label} className="p-4">
            <p className="text-xs font-medium text-ink-muted">{metric.label}</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">{metric.value}</p>
            <p className="mt-1 text-[0.6875rem] text-ink-subtle">
              {metric.hint} · {lot.unit_code}
            </p>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Provenance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">Status</span>
              <Badge tone={inventoryStatusTone(lot.lot_status)} dot>
                {labelForInventoryStatus(lot.lot_status)}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">Received</span>
              <span>{lot.received_date ? formatDate(lot.received_date) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">Supplier</span>
              <span>{source.supplierName ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">Goods receipt</span>
              {source.goodsReceiptReference ? (
                <Link
                  href={`/procurement/goods-receipts/${lot.goods_receipt_id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  {source.goodsReceiptReference}
                </Link>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">Production batch</span>
              {source.productionBatchReference ? (
                <Link
                  href={`/production/batches/${lot.production_batch_id}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  {source.productionBatchReference}
                </Link>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">Manufactured</span>
              <span>{lot.manufacture_date ? formatDate(lot.manufacture_date) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">Expires</span>
              <span>{lot.expiry_date ? formatDate(lot.expiry_date) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">Grade</span>
              <span>{lot.grade ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Movements</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {movements.length === 0 ? (
              <EmptyState icon={History} title="No movements" description="This lot has no posted movement yet." />
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Reference</TH>
                      <TH>Date</TH>
                      <TH>Type</TH>
                      <TH>Source</TH>
                      <TH className="text-right">Quantity</TH>
                      <TH>Posted by</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {movements.map((movement) => (
                      <TR key={movement.id}>
                        <TD className="font-mono text-xs">{movement.movement_reference}</TD>
                        <TD>{formatDate(movement.movement_date)}</TD>
                        <TD>
                          <Badge tone="neutral">{labelForInventoryStatus(movement.movement_type)}</Badge>
                        </TD>
                        <TD className="text-xs text-ink-muted">
                          {movement.source_reference ?? movement.source_type}
                        </TD>
                        <TD className="text-right tabular-nums">
                          {formatMovementQuantity(movement.direction, number(movement.quantity))}
                        </TD>
                        <TD className="text-xs">{movement.posted_by_name ?? "System"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Restrictions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {restrictions.length === 0 ? (
              <EmptyState icon={Lock} title="No restrictions" description="Nothing is holding this lot back." />
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Reference</TH>
                      <TH>Type</TH>
                      <TH>Outstanding</TH>
                      <TH>Status</TH>
                      <TH>Reason</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {restrictions.map((row) => (
                      <TR key={row.id}>
                        <TD className="font-mono text-xs">{row.restriction_reference}</TD>
                        <TD>{labelForInventoryStatus(row.restriction_type)}</TD>
                        <TD className="tabular-nums">{number(row.outstanding_quantity)}</TD>
                        <TD>
                          <Badge tone={inventoryStatusTone(row.status)} dot>
                            {labelForInventoryStatus(row.status)}
                          </Badge>
                        </TD>
                        <TD className="max-w-[16rem] truncate text-xs text-ink-muted">{row.reason ?? "—"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}

            {activeRestrictions.length > 0 && principal.permissions.has("inventory.restriction.release") ? (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-medium text-ink">Release some of a restriction</p>
                <ActionForm action={releaseRestrictionAction} submitLabel="Release" successMessage="Restriction released.">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="release-restriction">Restriction</Label>
                      <select
                        id="release-restriction"
                        name="restrictionId"
                        className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs"
                        required
                      >
                        {activeRestrictions.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.restriction_reference} · {number(row.outstanding_quantity)} outstanding
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="release-quantity">Quantity</Label>
                      <Input id="release-quantity" name="quantity" inputMode="decimal" required className="h-8 text-xs" />
                    </div>
                  </div>
                  <div className="mt-2 space-y-1">
                    <Label htmlFor="release-reason">Why is it being released?</Label>
                    <Textarea id="release-reason" name="reason" required rows={2} className="text-xs" />
                  </div>
                </ActionForm>
              </div>
            ) : null}

            {principal.permissions.has("inventory.restriction.manage") ? (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-medium text-ink">Hold stock on this lot</p>
                <ActionForm action={applyRestrictionAction} submitLabel="Apply restriction" successMessage="Restriction recorded.">
                  <input type="hidden" name="lotId" value={lot.lot_id} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="restriction-type">Type</Label>
                      <select
                        id="restriction-type"
                        name="restrictionType"
                        className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs"
                        defaultValue="hold"
                      >
                        <option value="hold">Hold</option>
                        <option value="quarantine">Quarantine</option>
                        <option value="recall">Recall</option>
                        <option value="count_freeze">Count freeze</option>
                        <option value="pending_inspection">Pending inspection</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="restriction-quantity">Quantity</Label>
                      <Input id="restriction-quantity" name="quantity" inputMode="decimal" required className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="restriction-code">Reason code</Label>
                      <Input id="restriction-code" name="reasonCode" required className="h-8 text-xs" placeholder="e.g. quality_hold" />
                    </div>
                  </div>
                  <div className="mt-2 space-y-1">
                    <Label htmlFor="restriction-reason">Reason</Label>
                    <Textarea id="restriction-reason" name="reason" required rows={2} className="text-xs" />
                  </div>
                </ActionForm>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reservations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reservations.length === 0 ? (
              <EmptyState icon={PackageOpen} title="No reservations" description="Nothing has claimed this stock." />
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Reference</TH>
                      <TH>For</TH>
                      <TH>Outstanding</TH>
                      <TH>Status</TH>
                      <TH>Expires</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {reservations.map((row) => (
                      <TR key={row.id}>
                        <TD className="font-mono text-xs">{row.reference}</TD>
                        <TD className="text-xs">
                          {row.reserved_for_module}/{row.reserved_for_type}
                          {row.reserved_for_reference ? ` · ${row.reserved_for_reference}` : ""}
                        </TD>
                        <TD className="tabular-nums">{number(row.outstanding_quantity)}</TD>
                        <TD>
                          <Badge tone={inventoryStatusTone(row.status)} dot>
                            {labelForInventoryStatus(row.status)}
                          </Badge>
                        </TD>
                        <TD className="text-xs">{row.expires_at ? formatDateTime(row.expires_at) : "No expiry"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}

            {principal.permissions.has("inventory.reservation.manage") ? (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-medium text-ink">Reserve stock on this lot</p>
                <ActionForm action={reserveStockAction} submitLabel="Reserve" successMessage="Stock reserved.">
                  <input type="hidden" name="lotId" value={lot.lot_id} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="reserve-quantity">Quantity</Label>
                      <Input id="reserve-quantity" name="quantity" inputMode="decimal" required className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="reserve-module">For module</Label>
                      <Input id="reserve-module" name="reservedForModule" defaultValue="sales" required className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="reserve-type">For document</Label>
                      <Input id="reserve-type" name="reservedForType" defaultValue="sales_order" required className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="reserve-ref">Reference</Label>
                      <Input id="reserve-ref" name="reservedForReference" className="h-8 text-xs" />
                    </div>
                  </div>
                </ActionForm>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {activeReservations.length > 0 || activeRestrictions.length > 0 ? (
        <Alert tone="info" title="Why available is below on hand">
          <p>
            {number(lot.restricted_quantity)} is restricted and {number(lot.reserved_quantity)} is reserved.
            Restrictions are released by the people who own them — Quality for inspection holds, the
            storekeeper for count freezes. A reservation is released when its document no longer needs the
            stock, or expires.
          </p>
        </Alert>
      ) : null}
    </div>
  );
}
