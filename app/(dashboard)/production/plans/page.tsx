import type { Metadata } from "next";
import Link from "next/link";
import { Factory } from "lucide-react";

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
import { PLAN_STATUSES, inventoryStatusTone, labelForInventoryStatus } from "@/lib/inventory/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { listPlans } from "@/services/production/plans";

export const metadata: Metadata = { title: "Production plans" };
export const dynamic = "force-dynamic";

const number = (value: number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(value);

/** Production plans and how far each has got. */
export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("production.plan.view")) {
    return <PermissionGuard permission="production.plan.view" />;
  }

  const params = await searchParams;
  const page = await listPlans({ status: params.status, page: params.page ? Number(params.page) : 1 });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Production plans"
        description="An approved intention to produce. The material requirement comes from the routing the factory declared; the system scales it and does not invent it."
        breadcrumbs={[{ label: "Production", href: "/production" }, { label: "Plans" }]}
        actions={
          principal.permissions.has("production.plan.create") ? (
            <Link href="/production/plans/new" className={cn(buttonVariants({ size: "sm" }))}>
              New plan
            </Link>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        <FilterBar
          action="/production/plans"
          fields={[
            {
              type: "select",
              name: "status",
              label: "Status",
              options: [
                { value: "", label: "All statuses" },
                ...PLAN_STATUSES.map((status) => ({ value: status, label: labelForInventoryStatus(status) })),
              ],
              defaultValue: params.status,
            },
          ]}
        />

        {page.rows.length === 0 ? (
          <EmptyState
            icon={Factory}
            title="No plans"
            description="Nothing matches this filter. A plan is approved before it can be executed, and material is reserved per lot by the storekeeper."
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Product</TH>
                    <TH>Planned date</TH>
                    <TH className="text-right">Planned</TH>
                    <TH className="text-right">Produced</TH>
                    <TH className="text-right">Outstanding</TH>
                    <TH className="text-right">Batches</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link
                          href={`/production/plans/${row.id}`}
                          className="font-mono text-xs font-medium text-brand-700 hover:underline"
                        >
                          {row.reference}
                        </Link>
                      </TD>
                      <TD>
                        <span className="font-mono text-xs text-ink-subtle">{row.product_code}</span>
                        <span className="ml-2">{row.product_name}</span>
                      </TD>
                      <TD>{formatDate(row.planned_date)}</TD>
                      <TD className="text-right tabular-nums">
                        {number(Number(row.planned_quantity))} {row.unit_code}
                      </TD>
                      <TD className="text-right tabular-nums">{number(Number(row.produced_quantity))}</TD>
                      <TD className="text-right tabular-nums">{number(Number(row.outstanding_quantity))}</TD>
                      <TD className="text-right tabular-nums">{row.batch_count}</TD>
                      <TD>
                        <Badge tone={inventoryStatusTone(row.status)} dot>
                          {labelForInventoryStatus(row.status)}
                        </Badge>
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
              baseHref="/production/plans"
              params={{ status: params.status }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
