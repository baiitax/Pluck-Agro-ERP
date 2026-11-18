import type { Metadata } from "next";
import Link from "next/link";
import { FileEdit } from "lucide-react";

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
import { STOCK_ADJUSTMENT_STATUSES, inventoryStatusTone, labelForInventoryStatus } from "@/lib/inventory/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { listAdjustments } from "@/services/inventory/counts";

export const metadata: Metadata = { title: "Stock adjustments" };
export const dynamic = "force-dynamic";

/**
 * Adjustments.
 *
 * Separate from counts because the claim is different: a count reports what was found, an adjustment states a
 * known reason. Both need a reason and both need approval before they reach the ledger.
 */
export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.adjustment.view")) {
    return <PermissionGuard permission="inventory.adjustment.view" />;
  }

  const params = await searchParams;
  const page = await listAdjustments({ status: params.status, page: params.page ? Number(params.page) : 1 });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock adjustments"
        description="A deliberate correction with a stated reason. An adjustment is the only document other than a count that can change a lot's quantity without goods moving."
        breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "Adjustments" }]}
        actions={
          principal.permissions.has("inventory.adjustment.create") ? (
            <Link href="/inventory/adjustments/new" className={cn(buttonVariants({ size: "sm" }))}>
              New adjustment
            </Link>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        <FilterBar
          action="/inventory/adjustments"
          fields={[
            {
              type: "select",
              name: "status",
              label: "Status",
              options: [
                { value: "", label: "All statuses" },
                ...STOCK_ADJUSTMENT_STATUSES.map((status) => ({ value: status, label: labelForInventoryStatus(status) })),
              ],
              defaultValue: params.status,
            },
          ]}
        />

        {page.rows.length === 0 ? (
          <EmptyState
            icon={FileEdit}
            title="No adjustments"
            description="Nothing matches this filter. An adjustment needs a reason of at least ten characters and, by default, approval before it posts."
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Date</TH>
                    <TH>Reason code</TH>
                    <TH>Reason</TH>
                    <TH className="text-right">Lines</TH>
                    <TH>Status</TH>
                    <TH>Posted</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link
                          href={`/inventory/adjustments/${row.id}`}
                          className="font-mono text-xs font-medium text-brand-700 hover:underline"
                        >
                          {row.reference}
                        </Link>
                      </TD>
                      <TD>{formatDate(row.adjustment_date)}</TD>
                      <TD className="font-mono text-xs">{row.reason_code}</TD>
                      <TD className="max-w-[22rem] truncate text-xs text-ink-muted">{row.reason}</TD>
                      <TD className="text-right tabular-nums">{row.lineCount}</TD>
                      <TD>
                        <Badge tone={inventoryStatusTone(row.status)} dot>
                          {labelForInventoryStatus(row.status)}
                        </Badge>
                      </TD>
                      <TD className="text-xs">{row.posted_at ? formatDate(row.posted_at) : "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              baseHref="/inventory/adjustments"
              params={{ status: params.status }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
