import type { Metadata } from "next";
import Link from "next/link";
import { HandCoins } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterField } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { SUPPLIER_ADVANCE_STATUSES, labelForStatus, procurementStatusTone } from "@/lib/procurement/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getAdvanceRegister } from "@/services/procurement/supplier-accounts";

export const metadata: Metadata = { title: "Supplier advances" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

const money = (currency: string, value: number | null) =>
  value === null
    ? "—"
    : `${currency} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

type Row = {
  id: string;
  reference: string;
  supplier_name: string;
  transaction_date: string;
  amount: number;
  outstanding_amount: number;
  currency_code: string;
  payment_method: string;
  status: string;
  purchase_order_reference: string | null;
  treasury_confirmation_reference: string | null;
  treasury_confirmed_at: string | null;
  confirmed_applications: number;
  applied_amount: number;
};

export default async function SupplierAdvancesPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.supplier_advance.view")) {
    return <PermissionGuard permission="procurement.supplier_advance.view" />;
  }

  const params = await searchParams;
  const page = Number(single(params.page) ?? "1") || 1;
  const filters = { search: single(params.q), status: single(params.status), page };
  const { rows, total, pageSize } = await getAdvanceRegister(filters);
  const canCreate = principal.permissions.has("procurement.supplier_advance.create");
  const register = rows as unknown as Row[];

  const filterFields: FilterField[] = [
    { type: "search", name: "q", label: "Search", placeholder: "Advance reference or supplier…", defaultValue: filters.search },
    {
      type: "select",
      name: "status",
      label: "Status",
      defaultValue: filters.status ?? "",
      options: [
        { value: "", label: "All statuses" },
        ...SUPPLIER_ADVANCE_STATUSES.map((status) => ({ value: status, label: labelForStatus(status) })),
      ],
    },
  ];

  return (
    <div>
      <PageHeader
        title="Supplier advances"
        description="An advance is money paid before the goods or invoice exist. It is a receivable from the supplier until it is applied to something — the outstanding balance is derived from confirmed applications, never typed."
        breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Supplier advances" }]}
        actions={
          canCreate ? (
            <Link href="/procurement/supplier-advances/new" className={cn(buttonVariants({ size: "sm" }))}>
              Record an advance
            </Link>
          ) : null
        }
      />

      <div className="erp-card overflow-hidden">
        <FilterBar action="/procurement/supplier-advances" fields={filterFields} />

        {register.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title={filters.search || filters.status ? "No advances match these filters" : "No advances recorded"}
            description={
              filters.search || filters.status
                ? "Filters run on the server, so an empty list is a real result. Widen or clear them to see more."
                : canCreate
                  ? "Record an advance when cash leaves before the goods or invoice arrive."
                  : "Advances are recorded by procurement and confirmed by finance."
            }
            action={
              canCreate && !filters.search && !filters.status ? (
                <Link href="/procurement/supplier-advances/new" className={cn(buttonVariants({ size: "sm" }))}>
                  Record an advance
                </Link>
              ) : null
            }
          />
        ) : (
          <>
            <TableWrapper>
              <Table className="min-w-[60rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Reference</TH>
                    <TH>Supplier</TH>
                    <TH>Date</TH>
                    <TH>Method</TH>
                    <TH className="text-right">Amount</TH>
                    <TH className="text-right">Applied</TH>
                    <TH className="text-right">Outstanding</TH>
                    <TH>Treasury</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {register.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link
                          href={`/procurement/supplier-advances/${row.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {row.reference}
                        </Link>
                        <p className="text-[0.6875rem] text-ink-subtle">
                          {row.purchase_order_reference ? `Against ${row.purchase_order_reference}` : "Not tied to an order"}
                        </p>
                      </TD>
                      <TD>{row.supplier_name}</TD>
                      <TD>{formatDate(row.transaction_date)}</TD>
                      <TD className="text-xs text-ink-muted">{labelForStatus(row.payment_method)}</TD>
                      <TD className="text-right tabular-nums">{money(row.currency_code, Number(row.amount))}</TD>
                      <TD className="text-right tabular-nums">{money(row.currency_code, Number(row.applied_amount))}</TD>
                      <TD className="text-right tabular-nums font-medium">
                        {money(row.currency_code, Number(row.outstanding_amount))}
                      </TD>
                      <TD className="text-xs text-ink-muted">
                        {row.treasury_confirmation_reference ? (
                          <>
                            {row.treasury_confirmation_reference}
                            <p className="text-[0.6875rem] text-ink-subtle">{formatDate(row.treasury_confirmed_at)}</p>
                          </>
                        ) : (
                          "Not confirmed"
                        )}
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
              baseHref="/procurement/supplier-advances"
              params={{ q: filters.search, status: filters.status }}
            />
          </>
        )}
      </div>
    </div>
  );
}
