import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ClipboardCheck, FileText, PackageSearch } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { MetricCard } from "@/components/shared/metric-card";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { formatMovementQuantity, labelForInventoryStatus, inventoryStatusTone } from "@/lib/inventory/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getInventoryDashboard } from "@/services/inventory/dashboard";

export const metadata: Metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

const number = (value: number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(value);

/**
 * Inventory overview.
 *
 * Every figure is a count or a sum the database produced from posted movements. There is no valuation on
 * this page, and no chart of history that does not exist: the recorded cost of stock is shown where a source
 * document stated one, and nowhere is it turned into a stock value.
 */
export default async function InventoryOverviewPage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("inventory.dashboard.view")) {
    return <PermissionGuard permission="inventory.dashboard.view" />;
  }

  const dashboard = await getInventoryDashboard();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        description="Stock is a ledger, not a number in a form. Every figure here is derived from posted movements: quantity changes only when a movement is written, and a movement is never edited."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Inventory" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/inventory/reports" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              <FileText aria-hidden /> Reports
            </Link>
            {principal.permissions.has("inventory.transfer.create") ? (
              <Link href="/inventory/transfers/new" className={cn(buttonVariants({ size: "sm" }))}>
                New transfer
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {dashboard.metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            hint={metric.hint}
            tone={metric.tone === "danger" ? "danger" : metric.tone === "warning" ? "pending" : "neutral"}
          />
        ))}
      </div>

      {!dashboard.attention.ledgerClean ? (
        <Alert tone="danger" title="The ledger check found a problem">
          <p>
            One or more integrity indicators are non-zero. Stock figures should not be trusted until this is
            investigated; open the reports page for the detail. Nothing in the system writes a corrective
            number silently, so this needs a person.
          </p>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>What is held back</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-ink-muted">
              On hand is what the ledger says; available is what may be issued. The difference is stock that
              exists but is not free to use.
            </p>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-ink-muted">Restricted</dt>
                <dd className="text-lg font-semibold text-ink">{number(dashboard.attention.restrictedQuantity)}</dd>
                <p className="text-xs text-ink-subtle">
                  {dashboard.attention.activeRestrictions} active restriction
                  {dashboard.attention.activeRestrictions === 1 ? "" : "s"}, including holds and pending
                  inspection
                </p>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">In transit</dt>
                <dd className="text-lg font-semibold text-ink">{number(dashboard.attention.inTransitQuantity)}</dd>
                <p className="text-xs text-ink-subtle">Dispatched but not yet received at the destination</p>
              </div>
            </dl>
            {dashboard.attention.pendingHandoffs > 0 ? (
              <Alert tone="warning" title="Receipts waiting to become stock">
                <p>
                  {dashboard.attention.pendingHandoffs} posted goods receipt
                  {dashboard.attention.pendingHandoffs === 1 ? " has" : "s have"} not been consumed into stock
                  yet. Posting a receipt records that goods arrived; the handoff is what creates the lots. Run
                  it from the receipts list, or let the next posting sweep pick it up.
                </p>
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Link
                href="/inventory/restrictions"
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                Restrictions
              </Link>
              <Link
                href="/inventory/reservations"
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                Reservations
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expiry exposure</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboard.attention.expiringLots.length === 0 ? (
              <EmptyState
                icon={AlertTriangle}
                title="Nothing expiring"
                description="No lot with stock carries an expiry date inside the next 90 days. Lots without a stated expiry are not assumed to last for ever — they simply have no expiry recorded."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Lot</TH>
                      <TH>Product</TH>
                      <TH className="text-right">Available</TH>
                      <TH>Expiry</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {dashboard.attention.expiringLots.map((lot) => (
                      <TR key={lot.lotReference}>
                        <TD className="font-mono text-xs">{lot.lotReference}</TD>
                        <TD>{lot.productName}</TD>
                        <TD className="text-right tabular-nums">{number(lot.quantity)}</TD>
                        <TD>
                          <div className="flex items-center gap-2">
                            <span>{formatDate(lot.expiryDate)}</span>
                            <Badge tone={lot.band === "expired" ? "danger" : "warning"}>
                              {lot.band === "expired"
                                ? "Expired"
                                : lot.band === "within_30_days"
                                  ? "Within 30 days"
                                  : "Within 90 days"}
                            </Badge>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent movements</CardTitle>
          <Link href="/inventory/movements" className="text-xs font-medium text-brand-700 hover:underline">
            Open the register <ArrowRight className="inline size-3" aria-hidden />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {dashboard.recentMovements.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={PackageSearch}
                title="No movements yet"
                description="Nothing has been posted to the ledger. Stock enters through a goods receipt handoff, an opening balance on a lot, a transfer receipt or a production output — not by typing a balance."
              />
            </div>
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Date</TH>
                    <TH>Type</TH>
                    <TH>Product</TH>
                    <TH>Lot</TH>
                    <TH>Warehouse</TH>
                    <TH className="text-right">Quantity</TH>
                  </TR>
                </THead>
                <TBody>
                  {dashboard.recentMovements.map((movement) => (
                    <TR key={movement.id}>
                      <TD className="font-mono text-xs">{movement.movementReference}</TD>
                      <TD>{formatDate(movement.movementDate)}</TD>
                      <TD>
                        <Badge tone={inventoryStatusTone(movement.movementType === "receipt_in" ? "received" : "posted")}>
                          {labelForInventoryStatus(movement.movementType)}
                        </Badge>
                      </TD>
                      <TD>{movement.productName}</TD>
                      <TD className="font-mono text-xs">{movement.lotReference}</TD>
                      <TD>{movement.warehouseName}</TD>
                      <TD className="text-right tabular-nums">
                        {formatMovementQuantity(movement.direction, number(movement.quantity))}
                      </TD>
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
          <CardTitle>Policy in force</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-start gap-2">
            <ClipboardCheck className="mt-0.5 size-4 text-ink-subtle" aria-hidden />
            <div>
              <p className="font-medium text-ink">Negative stock</p>
              <p className="text-xs text-ink-muted">
                {dashboard.settings.negativeStockAllowed
                  ? "Permitted by configuration. This is unusual and should be justified."
                  : "Refused. An issue that would take a lot below zero is declined."}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 text-ink-subtle" aria-hidden />
            <div>
              <p className="font-medium text-ink">Received stock</p>
              <p className="text-xs text-ink-muted">
                {dashboard.settings.receivedStockRequiresInspection
                  ? "Restricted pending inspection until Quality releases it."
                  : "Available immediately on receipt — inspection is not enforced by configuration."}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <ClipboardCheck className="mt-0.5 size-4 text-ink-subtle" aria-hidden />
            <div>
              <p className="font-medium text-ink">Approvals</p>
              <p className="text-xs text-ink-muted">
                Stock counts {dashboard.settings.stockCountRequiresApproval ? "require" : "do not require"}{" "}
                approval; adjustments {dashboard.settings.adjustmentRequiresApproval ? "require" : "do not require"}{" "}
                approval before posting.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
