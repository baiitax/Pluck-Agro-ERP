import type { Metadata } from "next";
import { FileText } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { labelForInventoryStatus } from "@/lib/inventory/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { getExpiryReport, getHoldReport, getMovementReport, getStockReport, getYieldReport } from "@/services/inventory/reports";

export const metadata: Metadata = { title: "Inventory reports" };
export const dynamic = "force-dynamic";

const number = (value: number | string | null) =>
  value === null ? "—" : new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value));

/**
 * Inventory reports.
 *
 * All quantities, no valuation. The ledger records the cost each source document stated; turning those into a
 * stock value needs a costing method the company has not chosen, so this page reports what is recorded and
 * says what it is not.
 */
export default async function InventoryReportsPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.reports.view")) {
    return <PermissionGuard permission="inventory.reports.view" />;
  }

  const [stock, movements, expiry, holds, yields] = await Promise.all([
    getStockReport(),
    getMovementReport(),
    getExpiryReport(),
    getHoldReport(),
    principal.permissions.has("production.reports.view")
      ? getYieldReport()
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory reports"
        description="Registers and derived quantities from posted documents. Every number is traceable to the movements that produced it."
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Reports" }]}
      />

      <Alert tone="info" title="No stock valuation is presented">
        <p>
          Movements carry the cost their source document stated, and the movement register below shows it per
          row with its currency. There is no weighted average, no FIFO, and no total stock value, because
          choosing a costing method is the company&apos;s decision and none has been made. Presenting a number
          without the method behind it would be inventing an accounting policy.
        </p>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Stock position</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {stock.rows.length === 0 ? (
            <EmptyState icon={FileText} title="No stock" description="No lot currently holds a balance." />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH>Warehouse</TH>
                    <TH className="text-right">Lots</TH>
                    <TH className="text-right">On hand</TH>
                    <TH className="text-right">Restricted</TH>
                    <TH className="text-right">Reserved</TH>
                    <TH className="text-right">Available</TH>
                    <TH>Earliest expiry</TH>
                  </TR>
                </THead>
                <TBody>
                  {stock.rows.map((row) => (
                    <TR key={`${row.productCode}-${row.warehouseName}`}>
                      <TD>
                        <span className="font-mono text-xs text-ink-subtle">{row.productCode}</span>
                        <span className="ml-2">{row.productName}</span>
                      </TD>
                      <TD>{row.warehouseName}</TD>
                      <TD className="text-right tabular-nums">{number(row.lotCount)}</TD>
                      <TD className="text-right tabular-nums">
                        {number(row.onHand)} {row.unitCode}
                      </TD>
                      <TD className="text-right tabular-nums">{number(row.restricted)}</TD>
                      <TD className="text-right tabular-nums">{number(row.reserved)}</TD>
                      <TD className="text-right font-medium tabular-nums">{number(row.available)}</TD>
                      <TD>{row.earliestExpiry ? formatDate(row.earliestExpiry) : "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Expiry exposure</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {expiry.length === 0 ? (
              <EmptyState icon={FileText} title="Nothing expiring" description="No lot with stock has an expiry date." />
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Lot</TH>
                      <TH>Product</TH>
                      <TH className="text-right">Available</TH>
                      <TH>Expiry</TH>
                      <TH className="text-right">Days</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {expiry.map((row) => (
                      <TR key={row.lotReference}>
                        <TD className="font-mono text-xs">{row.lotReference}</TD>
                        <TD>{row.productName}</TD>
                        <TD className="text-right tabular-nums">{number(row.available)}</TD>
                        <TD>{formatDate(row.expiryDate)}</TD>
                        <TD className="text-right tabular-nums">{row.daysToExpiry}</TD>
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
            <CardTitle>Holds in force</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {holds.length === 0 ? (
              <EmptyState icon={FileText} title="No holds" description="Nothing is restricted." />
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Reference</TH>
                      <TH>Lot</TH>
                      <TH>Type</TH>
                      <TH className="text-right">Outstanding</TH>
                      <TH>Source</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {holds.map((row) => (
                      <TR key={row.reference}>
                        <TD className="font-mono text-xs">{row.reference}</TD>
                        <TD className="font-mono text-xs">{row.lotReference}</TD>
                        <TD>{labelForInventoryStatus(row.type)}</TD>
                        <TD className="text-right tabular-nums">{number(row.outstanding)}</TD>
                        <TD className="text-xs">{row.sourceModule}</TD>
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
        <CardHeader>
          <CardTitle>Movement register</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {movements.rows.length === 0 ? (
            <EmptyState icon={FileText} title="No movements" description="The ledger is empty." />
          ) : (
            <>
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Reference</TH>
                      <TH>Date</TH>
                      <TH>Type</TH>
                      <TH>Product</TH>
                      <TH>Lot</TH>
                      <TH className="text-right">Quantity</TH>
                      <TH>Stated cost</TH>
                      <TH>Source</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {movements.rows.slice(0, 100).map((row) => (
                      <TR key={row.movementReference}>
                        <TD className="font-mono text-xs">{row.movementReference}</TD>
                        <TD>{formatDate(row.movementDate)}</TD>
                        <TD>{labelForInventoryStatus(row.movementType)}</TD>
                        <TD>{row.productName}</TD>
                        <TD className="font-mono text-xs">{row.lotReference}</TD>
                        <TD className="text-right tabular-nums">
                          {row.direction === "out" ? "−" : "+"}
                          {number(row.quantity)}
                        </TD>
                        <TD className="tabular-nums">{row.recordedCost ?? "Not stated"}</TD>
                        <TD className="text-xs text-ink-muted">{row.sourceReference ?? row.sourceType}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
              <p className="border-t border-border px-4 py-2 text-xs text-ink-subtle">
                Showing the 100 most recent of {movements.rows.length} movement(s).{" "}
                {movements.rowsWithoutStatedCost > 0
                  ? `${movements.rowsWithoutStatedCost} carry no stated cost — the source document did not state one, and none has been inferred.`
                  : "Every movement carries a cost stated by its source document."}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {yields.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recorded yield by product and month</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH>Month</TH>
                    <TH className="text-right">Closed batches</TH>
                    <TH className="text-right">Issued</TH>
                    <TH className="text-right">Output</TH>
                    <TH className="text-right">Average yield</TH>
                    <TH className="text-right">Outside band</TH>
                    <TH className="text-right">Not comparable</TH>
                  </TR>
                </THead>
                <TBody>
                  {yields.map((row) => (
                    <TR key={`${row.productCode}-${row.periodMonth}`}>
                      <TD>{row.productName}</TD>
                      <TD>{formatDateTime(row.periodMonth)}</TD>
                      <TD className="text-right tabular-nums">{row.closedBatches}</TD>
                      <TD className="text-right tabular-nums">{number(row.totalIssued)}</TD>
                      <TD className="text-right tabular-nums">{number(row.totalOutput)}</TD>
                      <TD className="text-right tabular-nums">
                        {row.averageYield === null ? "—" : `${number(row.averageYield)}%`}
                      </TD>
                      <TD className="text-right tabular-nums">{row.outsideBand}</TD>
                      <TD className="text-right tabular-nums">{row.incomparable}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <p className="border-t border-border px-4 py-2 text-xs text-ink-subtle">
              Yield is recorded output ÷ recorded input for the same batch, and only where both are in the same
              unit. Batches whose units differ are counted under &quot;not comparable&quot; rather than being
              averaged into a figure that means nothing.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
