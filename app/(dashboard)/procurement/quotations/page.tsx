import type { Metadata } from "next";
import Link from "next/link";
import { FileSearch } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterField } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { QUOTATION_STATUSES, labelForStatus, procurementStatusTone } from "@/lib/procurement/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getQuotations } from "@/services/procurement/quotations";

export const metadata: Metadata = { title: "Supplier quotations" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : (value ?? undefined));
const money = (currency: string, value: number) =>
  `${currency} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

export default async function QuotationsPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.quotation.view")) {
    return <PermissionGuard permission="procurement.quotation.view" />;
  }

  const params = await searchParams;
  const page = Number(single(params.page) ?? "1") || 1;
  const filters = { search: single(params.q), status: single(params.status), page };
  const { rows, total, pageSize } = await getQuotations(filters);
  const canCreate = principal.permissions.has("procurement.quotation.create");

  const filterFields: FilterField[] = [
    { type: "search", name: "q", label: "Search", placeholder: "Reference or supplier reference…", defaultValue: filters.search },
    {
      type: "select",
      name: "status",
      label: "Status",
      defaultValue: filters.status ?? "",
      options: [
        { value: "", label: "All statuses" },
        ...QUOTATION_STATUSES.map((status) => ({ value: status, label: labelForStatus(status) })),
      ],
    },
  ];

  return (
    <div>
      <PageHeader
        title="Supplier quotations"
        description="Offers as the supplier stated them, with the terms and lead time that applied. Recording a quotation does not select it; selection is a separate, attributed decision."
        breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Quotations" }]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/procurement/quotations/comparisons"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              Comparisons
            </Link>
            {canCreate ? (
              <Link href="/procurement/quotations/new" className={cn(buttonVariants({ size: "sm" }))}>
                Record a quotation
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="erp-card overflow-hidden">
        <FilterBar action="/procurement/quotations" fields={filterFields} />

        {rows.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title={filters.search || filters.status ? "No quotations match these filters" : "No quotations recorded yet"}
            description={
              filters.search || filters.status
                ? "Filters are applied on the server; an empty list is a real result."
                : "Record what each supplier offered. Two or more offers for the same requirement can then be compared."
            }
            action={
              canCreate && !filters.search && !filters.status ? (
                <Link href="/procurement/quotations/new" className={cn(buttonVariants({ size: "sm" }))}>
                  Record a quotation
                </Link>
              ) : null
            }
          />
        ) : (
          <>
            <TableWrapper>
              <Table className="min-w-[56rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Reference</TH>
                    <TH>Supplier</TH>
                    <TH>Supplier reference</TH>
                    <TH>Quoted</TH>
                    <TH>Valid until</TH>
                    <TH className="text-right">Lines</TH>
                    <TH className="text-right">Total</TH>
                    <TH>Lead time</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((row) => {
                    const quotation = row as unknown as {
                      id: string;
                      reference: string;
                      supplier_quotation_reference: string | null;
                      quotation_date: string;
                      valid_until: string | null;
                      total_amount: number;
                      currency_code: string;
                      delivery_lead_time_days: number | null;
                      status: string;
                      line_count: number;
                      supplier: { legal_name: string } | null;
                    };
                    return (
                      <TR key={quotation.id}>
                        <TD>
                          <Link
                            href={`/procurement/quotations/${quotation.id}`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            {quotation.reference}
                          </Link>
                        </TD>
                        <TD>{quotation.supplier?.legal_name ?? "—"}</TD>
                        <TD className="text-ink-muted">{quotation.supplier_quotation_reference ?? "—"}</TD>
                        <TD>{formatDate(quotation.quotation_date)}</TD>
                        <TD>{formatDate(quotation.valid_until)}</TD>
                        <TD className="text-right tabular-nums">{quotation.line_count}</TD>
                        <TD className="text-right tabular-nums font-medium">
                          {money(quotation.currency_code, quotation.total_amount)}
                        </TD>
                        <TD>{quotation.delivery_lead_time_days === null ? "—" : `${quotation.delivery_lead_time_days} days`}</TD>
                        <TD>
                          <Badge tone={procurementStatusTone(quotation.status)}>{labelForStatus(quotation.status)}</Badge>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              baseHref="/procurement/quotations"
              params={{ q: filters.search, status: filters.status }}
            />
          </>
        )}
      </div>
    </div>
  );
}
