import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { TRANSFER_STATUSES, inventoryStatusTone, labelForInventoryStatus } from "@/lib/inventory/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { listInTransit, listTransfers } from "@/services/inventory/transfers";

export const metadata: Metadata = { title: "Stock transfers" };
export const dynamic = "force-dynamic";

const number = (value: number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

/**
 * Transfers, and what is currently between warehouses.
 *
 * A dispatched transfer has already left the source ledger, so the stock is off the books at both ends until
 * it is received. That gap is not a rounding error to be hidden: the in-transit panel states it explicitly,
 * per transfer and product.
 */
export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.transfer.view")) {
    return <PermissionGuard permission="inventory.transfer.view" />;
  }

  const params = await searchParams;
  const [page, inTransit] = await Promise.all([
    listTransfers({ status: params.status, page: params.page ? Number(params.page) : 1 }),
    listInTransit(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock transfers"
        description="Moving stock between warehouses is two movements and a fresh lot: the source lot is issued out, the destination lot is created on receipt with the same provenance."
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Transfers" }]}
        actions={
          principal.permissions.has("inventory.transfer.create") ? (
            <Link href="/inventory/transfers/new" className={cn(buttonVariants({ size: "sm" }))}>
              New transfer
            </Link>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        <FilterBar
          action="/inventory/transfers"
          fields={[
            {
              type: "select",
              name: "status",
              label: "Status",
              options: [
                { value: "", label: "All statuses" },
                ...TRANSFER_STATUSES.map((status) => ({ value: status, label: labelForInventoryStatus(status) })),
              ],
              defaultValue: params.status,
            },
          ]}
        />

        {page.rows.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No transfers"
            description="Nothing matches this filter. A transfer starts as a draft, is submitted for approval, then dispatched and received."
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>From</TH>
                    <TH>To</TH>
                    <TH className="text-right">Lines</TH>
                    <TH>Status</TH>
                    <TH>Dispatched</TH>
                    <TH>Received</TH>
                    <TH>Created</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link
                          href={`/inventory/transfers/${row.id}`}
                          className="font-mono text-xs font-medium text-brand-700 hover:underline"
                        >
                          {row.reference}
                        </Link>
                      </TD>
                      <TD>{row.fromWarehouseName ?? "—"}</TD>
                      <TD>{row.toWarehouseName ?? "—"}</TD>
                      <TD className="text-right tabular-nums">{row.lineCount}</TD>
                      <TD>
                        <Badge tone={inventoryStatusTone(row.status)} dot>
                          {labelForInventoryStatus(row.status)}
                        </Badge>
                      </TD>
                      <TD className="text-xs">{row.dispatched_at ? formatDate(row.dispatched_at) : "—"}</TD>
                      <TD className="text-xs">{row.received_at ? formatDate(row.received_at) : "—"}</TD>
                      <TD className="text-xs">{formatDate(row.created_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              baseHref="/inventory/transfers"
              params={{ status: params.status }}
            />
          </>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>In transit</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {inTransit.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="Nothing in transit"
              description="Every dispatched transfer has either been received or has not been dispatched yet."
            />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Transfer</TH>
                    <TH>Route</TH>
                    <TH>Product</TH>
                    <TH className="text-right">Dispatched</TH>
                    <TH className="text-right">Received</TH>
                    <TH className="text-right">Still out</TH>
                    <TH>Dispatched at</TH>
                  </TR>
                </THead>
                <TBody>
                  {inTransit.map((row) => (
                    <TR key={`${row.transfer_id}-${row.product_id}`}>
                      <TD>
                        <Link
                          href={`/inventory/transfers/${row.transfer_id}`}
                          className="font-mono text-xs font-medium text-brand-700 hover:underline"
                        >
                          {row.reference}
                        </Link>
                      </TD>
                      <TD className="text-xs">
                        {row.from_warehouse_name} → {row.to_warehouse_name}
                      </TD>
                      <TD>
                        <span className="font-mono text-xs text-ink-subtle">{row.product_code}</span>
                        <span className="ml-2">{row.product_name}</span>
                      </TD>
                      <TD className="text-right tabular-nums">{number(row.dispatched_quantity)}</TD>
                      <TD className="text-right tabular-nums">{number(row.received_quantity)}</TD>
                      <TD className="text-right font-medium tabular-nums">
                        {number(row.in_transit_quantity)} {row.unit_code}
                      </TD>
                      <TD className="text-xs">{row.dispatched_at ? formatDate(row.dispatched_at) : "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
