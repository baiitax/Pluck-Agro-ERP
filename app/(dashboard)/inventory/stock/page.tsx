import type { Metadata } from "next";
import Link from "next/link";
import { Boxes } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { requireActiveProfile } from "@/services/authorization";
import { listStockSummary, listWarehouses } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "Stock on hand" };
export const dynamic = "force-dynamic";

const number = (value: number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

/**
 * Stock on hand by product and warehouse.
 *
 * The four quantity columns are the whole story and they are different things: on hand is what the ledger
 * says, restricted is what Quality or a count has frozen, reserved is what another document has claimed, and
 * available is what is left. Any page that showed only "quantity" would be hiding the reason an issue was
 * refused.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; warehouse?: string; page?: string; all?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.stock.view")) {
    return <PermissionGuard permission="inventory.stock.view" />;
  }

  const params = await searchParams;
  const [page, warehouses] = await Promise.all([
    listStockSummary({
      search: params.search,
      warehouseId: params.warehouse,
      onlyWithStock: params.all !== "1",
      page: params.page ? Number(params.page) : 1,
    }),
    listWarehouses(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock on hand"
        description="Quantities derived from posted movements, per product and warehouse. Nothing here is stored as a balance."
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Stock" }]}
      />

      <Card className="overflow-hidden">
        <FilterBar
          action="/inventory/stock"
          fields={[
            { type: "search", name: "search", label: "Search", placeholder: "Product, code or warehouse" },
            {
              type: "select",
              name: "warehouse",
              label: "Warehouse",
              options: [{ value: "", label: "All warehouses" }, ...warehouses.map((row) => ({ value: row.id, label: row.name }))],
              defaultValue: params.warehouse,
            },
            {
              type: "select",
              name: "all",
              label: "Rows",
              options: [
                { value: "", label: "With stock only" },
                { value: "1", label: "Include empty" },
              ],
              defaultValue: params.all,
            },
          ]}
        />

        {page.rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No stock recorded"
            description="Nothing matches this filter. Stock appears here once a movement has been posted — through a goods receipt handoff, an opening balance, a transfer receipt or a production output."
          />
        ) : (
          <>
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
                  {page.rows.map((row) => (
                    <TR key={`${row.product_id}-${row.warehouse_id}`}>
                      <TD>
                        <span className="font-mono text-xs text-ink-subtle">{row.product_code}</span>
                        <span className="ml-2">{row.product_name}</span>
                      </TD>
                      <TD>{row.warehouse_name}</TD>
                      <TD className="text-right tabular-nums">{number(row.lot_count)}</TD>
                      <TD className="text-right tabular-nums">
                        {number(row.on_hand_quantity)} {row.unit_code}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {Number(row.restricted_quantity) > 0 ? number(row.restricted_quantity) : "—"}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {Number(row.reserved_quantity) > 0 ? number(row.reserved_quantity) : "—"}
                      </TD>
                      <TD className="text-right font-medium tabular-nums">{number(row.available_quantity)}</TD>
                      <TD>{row.earliest_expiry_date ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              baseHref="/inventory/stock"
              params={{ search: params.search, warehouse: params.warehouse, all: params.all }}
            />
          </>
        )}
      </Card>

      <p className="text-xs text-ink-subtle">
        There is no stock value on this page. The ledger records the cost each source document stated, but
        turning those into a valuation requires a costing method the company has not chosen, so none is
        presented.{" "}
        <Link href="/inventory/reports" className="font-medium text-brand-700 hover:underline">
          Open the reports
        </Link>{" "}
        to see recorded costs per movement.
      </p>
    </div>
  );
}
