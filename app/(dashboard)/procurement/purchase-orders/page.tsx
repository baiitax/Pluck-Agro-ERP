import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterField } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { PURCHASE_ORDER_STATUSES, labelForStatus, procurementStatusTone } from "@/lib/procurement/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getPurchaseOrders } from "@/services/procurement/purchase-orders";

export const metadata: Metadata = { title: "Purchase orders" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : (value ?? undefined));
const qty = (value: number) => new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(value);
const money = (currency: string, value: number) =>
  `${currency} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.purchase_order.view")) {
    return <PermissionGuard permission="procurement.purchase_order.view" />;
  }

  const params = await searchParams;
  const page = Number(single(params.page) ?? "1") || 1;
  const filters = {
    search: single(params.q),
    status: single(params.status),
    overdueOnly: single(params.overdue) === "1",
    page,
  };
  const { rows, total, pageSize } = await getPurchaseOrders(filters);
  const canCreate = principal.permissions.has("procurement.purchase_order.create");
  const canExport = principal.permissions.has("procurement.purchase_order.export");

  const filterFields: FilterField[] = [
    { type: "search", name: "q", label: "Search", placeholder: "Reference or supplier…", defaultValue: filters.search },
    {
      type: "select",
      name: "status",
      label: "Status",
      defaultValue: filters.status ?? "",
      options: [
        { value: "", label: "All statuses" },
        ...PURCHASE_ORDER_STATUSES.map((status) => ({ value: status, label: labelForStatus(status) })),
      ],
    },
    {
      type: "select",
      name: "overdue",
      label: "Delivery",
      defaultValue: filters.overdueOnly ? "1" : "",
      options: [
        { value: "", label: "All orders" },
        { value: "1", label: "Overdue only" },
      ],
    },
  ];

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        description="Approved orders are commitments. An order is issued to the supplier as a separate act, and from that moment it is immutable — changes go through an amendment that keeps every version."
        breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Purchase orders" }]}
        actions={
          <div className="flex items-center gap-2">
            {canExport ? (
              <Link href="/procurement/reports?report=purchase-order-register" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
                Register report
              </Link>
            ) : null}
            {canCreate ? (
              <Link href="/procurement/purchase-orders/new" className={cn(buttonVariants({ size: "sm" }))}>
                New purchase order
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="erp-card overflow-hidden">
        <FilterBar action="/procurement/purchase-orders" fields={filterFields} />

        {rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={filters.search || filters.status || filters.overdueOnly ? "No orders match these filters" : "No purchase orders yet"}
            description={
              filters.search || filters.status || filters.overdueOnly
                ? "Filters run on the server, so an empty table is a real result."
                : "Orders normally start from a recorded supplier selection, so that the reason for the choice travels with the commitment."
            }
            action={
              canCreate && !filters.search && !filters.status ? (
                <Link href="/procurement/purchase-orders/new" className={cn(buttonVariants({ size: "sm" }))}>
                  New purchase order
                </Link>
              ) : null
            }
          />
        ) : (
          <>
            <TableWrapper>
              <Table className="min-w-[64rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Reference</TH>
                    <TH>Supplier</TH>
                    <TH>Ordered</TH>
                    <TH>Expected</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">Lines</TH>
                    <TH className="text-right">Ordered qty</TH>
                    <TH className="text-right">Received</TH>
                    <TH className="text-right">Outstanding</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <TR key={row.purchase_order_id}>
                      <TD>
                        <Link
                          href={`/procurement/purchase-orders/${row.purchase_order_id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {row.reference}
                        </Link>
                        {row.is_overdue ? (
                          <p className="text-[0.6875rem] font-medium text-danger-600">Past the expected date</p>
                        ) : null}
                      </TD>
                      <TD>{row.supplier_name_snapshot}</TD>
                      <TD>{formatDate(row.order_date)}</TD>
                      <TD>{formatDate(row.expected_delivery_date)}</TD>
                      <TD className="text-right tabular-nums font-medium">{money(row.currency_code, row.total_amount)}</TD>
                      <TD className="text-right tabular-nums">{row.line_count}</TD>
                      <TD className="text-right tabular-nums">{qty(row.ordered_quantity)}</TD>
                      <TD className="text-right tabular-nums">{qty(row.received_quantity)}</TD>
                      <TD className="text-right tabular-nums">{qty(row.outstanding_quantity)}</TD>
                      <TD>
                        <Badge tone={procurementStatusTone(row.status)}>{labelForStatus(row.status)}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              baseHref="/procurement/purchase-orders"
              params={{ q: filters.search, status: filters.status, overdue: filters.overdueOnly ? "1" : undefined }}
            />
          </>
        )}
      </div>
    </div>
  );
}
