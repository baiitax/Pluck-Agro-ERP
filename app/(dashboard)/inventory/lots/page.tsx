import type { Metadata } from "next";
import Link from "next/link";
import { Boxes } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { INVENTORY_LOT_STATUSES, inventoryStatusTone, labelForInventoryStatus } from "@/lib/inventory/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { listLots, listWarehouses } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "Lots" };
export const dynamic = "force-dynamic";

const number = (value: number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

/**
 * The lot register.
 *
 * A lot is the identity of a quantity: the same product from two suppliers, or two production runs, are
 * different lots and stay different all the way to dispatch. That is why every movement names a lot, and why
 * this page exists before any loyalty to a single balance.
 */
export default async function LotsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; warehouse?: string; page?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.stock.view")) {
    return <PermissionGuard permission="inventory.stock.view" />;
  }

  const params = await searchParams;
  const [page, warehouses] = await Promise.all([
    listLots({
      search: params.search,
      status: params.status,
      warehouseId: params.warehouse,
      page: params.page ? Number(params.page) : 1,
    }),
    listWarehouses(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Lots"
        description="Every quantity has an identity: where it came from, which warehouse holds it, and what it is worth in traceability terms. Balances are derived from the movements that name these lots."
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Lots" }]}
        actions={
          principal.permissions.has("inventory.lot.create") ? (
            <Link href="/inventory/lots/new" className={cn(buttonVariants({ size: "sm" }))}>
              Register a lot
            </Link>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        <FilterBar
          action="/inventory/lots"
          fields={[
            { type: "search", name: "search", label: "Search", placeholder: "Lot, product or code" },
            {
              type: "select",
              name: "status",
              label: "Status",
              options: [
                { value: "", label: "All statuses" },
                ...INVENTORY_LOT_STATUSES.map((status) => ({ value: status, label: labelForInventoryStatus(status) })),
              ],
              defaultValue: params.status,
            },
            {
              type: "select",
              name: "warehouse",
              label: "Warehouse",
              options: [{ value: "", label: "All warehouses" }, ...warehouses.map((row) => ({ value: row.id, label: row.name }))],
              defaultValue: params.warehouse,
            },
          ]}
        />

        {page.rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No lots"
            description="Lots are created by the goods receipt handoff, by a transfer receipt, or by production output. An opening balance can be recorded when a lot is registered."
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Lot</TH>
                    <TH>Product</TH>
                    <TH>Warehouse</TH>
                    <TH>Status</TH>
                    <TH className="text-right">On hand</TH>
                    <TH className="text-right">Available</TH>
                    <TH>Expiry</TH>
                    <TH>Grade</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.rows.map((row) => (
                    <TR key={row.lot_id}>
                      <TD>
                        <Link
                          href={`/inventory/lots/${row.lot_id}`}
                          className="font-mono text-xs font-medium text-brand-700 hover:underline"
                        >
                          {row.lot_reference}
                        </Link>
                      </TD>
                      <TD>
                        <span className="font-mono text-xs text-ink-subtle">{row.product_code}</span>
                        <span className="ml-2">{row.product_name}</span>
                      </TD>
                      <TD>{row.warehouse_name}</TD>
                      <TD>
                        <Badge tone={inventoryStatusTone(row.lot_status)} dot>
                          {labelForInventoryStatus(row.lot_status)}
                        </Badge>
                      </TD>
                      <TD className="text-right tabular-nums">
                        {number(row.on_hand_quantity)} {row.unit_code}
                      </TD>
                      <TD className="text-right font-medium tabular-nums">
                        {number(row.available_quantity)}
                        {Number(row.active_restriction_count) > 0 || Number(row.active_reservation_count) > 0 ? (
                          <span className="ml-1 text-xs font-normal text-ink-subtle">
                            ({number(row.restricted_quantity)} held, {number(row.reserved_quantity)} reserved)
                          </span>
                        ) : null}
                      </TD>
                      <TD>{row.expiry_date ? formatDate(row.expiry_date) : "—"}</TD>
                      <TD>{row.grade ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              baseHref="/inventory/lots"
              params={{ search: params.search, status: params.status, warehouse: params.warehouse }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
