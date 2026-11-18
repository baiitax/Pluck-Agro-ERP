import type { Metadata } from "next";
import { History } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDateTime } from "@/lib/formatting";
import { MOVEMENT_TYPES, formatMovementQuantity, inventoryStatusTone, labelForInventoryStatus } from "@/lib/inventory/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { getLedgerIntegrity, listMovements } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "Stock movements" };
export const dynamic = "force-dynamic";

const number = (value: number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

/**
 * The movement register.
 *
 * This is the ledger, and it is the only place a quantity changes. Rows cannot be edited or deleted — the
 * database refuses at the trigger level, not in this page — so a correction always appears as a second row
 * that points at the first.
 */
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; type?: string; from?: string; to?: string; page?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.stock.view")) {
    return <PermissionGuard permission="inventory.stock.view" />;
  }

  const params = await searchParams;
  const [page, integrity] = await Promise.all([
    listMovements({
      search: params.search,
      movementType: params.type,
      from: params.from,
      to: params.to,
      page: params.page ? Number(params.page) : 1,
    }),
    getLedgerIntegrity(),
  ]);

  const problems = Object.entries(integrity).filter(([, value]) => Number(value) !== 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock movements"
        description="Every quantity change in the system, with the document that caused it and the person who posted it. Movements are append-only: a correction is a new reversal row, never an edit."
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Movements" }]}
      />

      {problems.length > 0 ? (
        <Alert tone="danger" title="Ledger integrity check failed">
          <ul className="list-disc space-y-0.5 pl-4 text-xs">
            {problems.map(([key, value]) => (
              <li key={key}>
                {key.replace(/_/g, " ")}: {number(value as number)}
              </li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="success" title="Ledger integrity check passed">
          <p>
            No movement without a lot, no negative balance, no reversal pointing the wrong way, no duplicate
            identifiers. The check is a view, so it is recomputed on every page load rather than trusted from a
            previous run.
          </p>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <FilterBar
          action="/inventory/movements"
          fields={[
            { type: "search", name: "search", label: "Search", placeholder: "Reference, lot, product or source" },
            {
              type: "select",
              name: "type",
              label: "Movement type",
              options: [
                { value: "", label: "All types" },
                ...MOVEMENT_TYPES.map((type) => ({ value: type, label: labelForInventoryStatus(type) })),
              ],
              defaultValue: params.type,
            },
          ]}
        />

        {page.rows.length === 0 ? (
          <EmptyState
            icon={History}
            title="No movements"
            description="Nothing matches this filter. The ledger fills up from goods receipt handoffs, transfers, counts, adjustments and production."
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Posted</TH>
                    <TH>Type</TH>
                    <TH>Product</TH>
                    <TH>Lot</TH>
                    <TH>Warehouse</TH>
                    <TH>Source document</TH>
                    <TH className="text-right">Quantity</TH>
                    <TH>Posted by</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.rows.map((row) => (
                    <TR key={row.id}>
                      <TD className="font-mono text-xs">{row.movement_reference}</TD>
                      <TD className="text-xs">{formatDateTime(row.posted_at)}</TD>
                      <TD>
                        <Badge tone={inventoryStatusTone(row.direction === "in" ? "received" : "dispatched")}>
                          {labelForInventoryStatus(row.movement_type)}
                        </Badge>
                      </TD>
                      <TD>
                        <span className="font-mono text-xs text-ink-subtle">{row.product_code}</span>
                        <span className="ml-2">{row.product_name}</span>
                      </TD>
                      <TD className="font-mono text-xs">{row.lot_reference}</TD>
                      <TD>{row.warehouse_name}</TD>
                      <TD className="text-xs text-ink-muted">
                        {row.source_reference ?? row.source_type}
                        {row.reverses_movement_id ? <span className="ml-1 text-danger-600">(reversal)</span> : null}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {formatMovementQuantity(row.direction, number(row.quantity))} {row.unit_code}
                      </TD>
                      <TD className="text-xs">{row.posted_by_name ?? "System"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              baseHref="/inventory/movements"
              params={{ search: params.search, type: params.type, from: params.from, to: params.to }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
