import type { Metadata } from "next";
import Link from "next/link";
import { PackageCheck } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterField } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { GOODS_RECEIPT_STATUSES, labelForStatus, procurementStatusTone } from "@/lib/procurement/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getGoodsReceipts } from "@/services/procurement/goods-receipts";

export const metadata: Metadata = { title: "Goods receipts" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

const qty = (value: number) => new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(value);

type Row = {
  id: string;
  reference: string;
  status: string;
  receipt_date: string;
  supplier_delivery_note_number: string | null;
  inspection_status: string | null;
  purchase_order_reference: string;
  supplier_name: string;
  warehouse_name: string | null;
  location_name: string | null;
  posting_reference: string | null;
  posted_at: string | null;
  line_count: number;
  received_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  quarantined_quantity: number;
};

export default async function GoodsReceiptsPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.goods_receipt.view")) {
    return <PermissionGuard permission="procurement.goods_receipt.view" />;
  }

  const params = await searchParams;
  const page = Number(single(params.page) ?? "1") || 1;
  const filters = { search: single(params.q), status: single(params.status), page };
  const { rows, total, pageSize } = await getGoodsReceipts(filters);
  const canCreate = principal.permissions.has("procurement.goods_receipt.create");
  const register = rows as unknown as Row[];

  const filterFields: FilterField[] = [
    {
      type: "search",
      name: "q",
      label: "Search",
      placeholder: "GRN, delivery note, order or supplier…",
      defaultValue: filters.search,
    },
    {
      type: "select",
      name: "status",
      label: "Status",
      defaultValue: filters.status ?? "",
      options: [
        { value: "", label: "All statuses" },
        ...GOODS_RECEIPT_STATUSES.map((status) => ({ value: status, label: labelForStatus(status) })),
      ],
    },
  ];

  return (
    <div>
      <PageHeader
        title="Goods receipts"
        description="A goods receipt records what physically arrived against an order. It is evidence, not stock: the quantities become stock only when the receipt is posted, and a posted receipt cannot be edited."
        breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Goods receipts" }]}
        actions={
          canCreate ? (
            <Link href="/procurement/goods-receipts/new" className={cn(buttonVariants({ size: "sm" }))}>
              Record a receipt
            </Link>
          ) : null
        }
      />

      <div className="erp-card overflow-hidden">
        <FilterBar action="/procurement/goods-receipts" fields={filterFields} />

        {register.length === 0 ? (
          <EmptyState
            icon={PackageCheck}
            title={filters.search || filters.status ? "No receipts match these filters" : "Nothing has been received yet"}
            description={
              filters.search || filters.status
                ? "Filters run on the server, so an empty list is a real result. Widen or clear them to see more."
                : canCreate
                  ? "Record a receipt against an issued purchase order when goods arrive."
                  : "Receipts are recorded by the stores and procurement teams against an issued order."
            }
            action={
              canCreate && !filters.search && !filters.status ? (
                <Link href="/procurement/goods-receipts/new" className={cn(buttonVariants({ size: "sm" }))}>
                  Record a receipt
                </Link>
              ) : null
            }
          />
        ) : (
          <>
            <TableWrapper>
              <Table className="min-w-[62rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Reference</TH>
                    <TH>Purchase order</TH>
                    <TH>Supplier</TH>
                    <TH>Received</TH>
                    <TH>Delivery note</TH>
                    <TH className="text-right">Received</TH>
                    <TH className="text-right">Accepted</TH>
                    <TH className="text-right">Rejected</TH>
                    <TH className="text-right">Quarantined</TH>
                    <TH>Inspection</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {register.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link
                          href={`/procurement/goods-receipts/${row.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {row.reference}
                        </Link>
                        <p className="text-[0.6875rem] text-ink-subtle">
                          {row.line_count} line(s)
                          {row.posting_reference ? ` · posted ${formatDateTime(row.posted_at)}` : ""}
                        </p>
                      </TD>
                      <TD>{row.purchase_order_reference}</TD>
                      <TD>{row.supplier_name}</TD>
                      <TD>{formatDate(row.receipt_date)}</TD>
                      <TD>{row.supplier_delivery_note_number ?? "—"}</TD>
                      <TD className="text-right tabular-nums">{qty(row.received_quantity)}</TD>
                      <TD className="text-right tabular-nums">{qty(row.accepted_quantity)}</TD>
                      <TD className="text-right tabular-nums">
                        {row.rejected_quantity > 0 ? (
                          <span className="text-danger-700">{qty(row.rejected_quantity)}</span>
                        ) : (
                          qty(row.rejected_quantity)
                        )}
                      </TD>
                      <TD className="text-right tabular-nums">{qty(row.quarantined_quantity)}</TD>
                      <TD>
                        <span className="text-xs text-ink-muted">
                          {row.inspection_status ? labelForStatus(row.inspection_status) : "Not inspected"}
                        </span>
                        <p className="text-[0.6875rem] text-ink-subtle">
                          {row.warehouse_name ?? "No warehouse"}
                          {row.location_name ? ` · ${row.location_name}` : ""}
                        </p>
                      </TD>
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
              baseHref="/procurement/goods-receipts"
              params={{ q: filters.search, status: filters.status }}
            />
          </>
        )}
      </div>
    </div>
  );
}
