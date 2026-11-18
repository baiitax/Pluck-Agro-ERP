import type { Metadata } from "next";
import Link from "next/link";
import { Factory } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { BATCH_STATUSES, inventoryStatusTone, labelForInventoryStatus } from "@/lib/inventory/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { listBatches } from "@/services/production/batches";

export const metadata: Metadata = { title: "Production batches" };
export const dynamic = "force-dynamic";

const number = (value: number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

/**
 * Production batches.
 *
 * The issued / output / waste columns are maintained from the movements the batch posted, not typed into it.
 * A batch with `mixed_units` shows no yield percentage, because dividing grammes by litres produces a number
 * that looks precise and means nothing.
 */
export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("production.batch.view")) {
    return <PermissionGuard permission="production.batch.view" />;
  }

  const params = await searchParams;
  const page = await listBatches({ status: params.status, page: params.page ? Number(params.page) : 1 });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Production batches"
        description="The only production object that moves stock. Material is issued out of lots and output is received into a new lot, each as a ledger movement."
        breadcrumbs={[{ label: "Production", href: "/production" }, { label: "Batches" }]}
      />

      <Card className="overflow-hidden">
        <FilterBar
          action="/production/batches"
          fields={[
            {
              type: "select",
              name: "status",
              label: "Status",
              options: [
                { value: "", label: "All statuses" },
                ...BATCH_STATUSES.map((status) => ({ value: status, label: labelForInventoryStatus(status) })),
              ],
              defaultValue: params.status,
            },
          ]}
        />

        {page.rows.length === 0 ? (
          <EmptyState
            icon={Factory}
            title="No batches"
            description="Nothing matches this filter. A batch starts from an approved plan, or standalone with a product and quantity."
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Product</TH>
                    <TH>Date</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Issued</TH>
                    <TH className="text-right">Output</TH>
                    <TH className="text-right">Waste</TH>
                    <TH className="text-right">Yield</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link
                          href={`/production/batches/${row.id}`}
                          className="font-mono text-xs font-medium text-brand-700 hover:underline"
                        >
                          {row.reference}
                        </Link>
                      </TD>
                      <TD>
                        <span className="font-mono text-xs text-ink-subtle">{row.product_code}</span>
                        <span className="ml-2">{row.product_name}</span>
                      </TD>
                      <TD>{formatDate(row.batch_date)}</TD>
                      <TD>
                        <Badge tone={inventoryStatusTone(row.status)} dot>
                          {labelForInventoryStatus(row.status)}
                        </Badge>
                      </TD>
                      <TD className="text-right tabular-nums">
                        {number(Number(row.issued_quantity))} {row.unit_code}
                      </TD>
                      <TD className="text-right tabular-nums">{number(Number(row.output_quantity))}</TD>
                      <TD className="text-right tabular-nums">{number(Number(row.waste_quantity))}</TD>
                      <TD className="text-right tabular-nums">
                        {row.recorded_yield_percent === null
                          ? row.recorded_yield_basis === "mixed_units"
                            ? "Not comparable"
                            : "—"
                          : `${number(Number(row.recorded_yield_percent))}%`}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              baseHref="/production/batches"
              params={{ status: params.status }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
