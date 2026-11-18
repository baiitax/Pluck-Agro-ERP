import type { Metadata } from "next";
import Link from "next/link";
import { Scale } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterField } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { requireActiveProfile } from "@/services/authorization";
import { getSupplierPositions } from "@/services/procurement/supplier-accounts";

export const metadata: Metadata = { title: "Supplier accounts" };
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
  supplier_id: string;
  reference: string;
  legal_name: string;
  supplier_status: string;
  currency_code: string;
  ordered_amount: number | null;
  received_value: number | null;
  invoiced_amount: number | null;
  paid_amount: number | null;
  advance_balance: number | null;
  confirmed_payable: number | null;
  unreconciled_difference: number | null;
  payable_is_basis_known: boolean;
};

/**
 * Supplier positions.
 *
 * The distinction the table is built around: a purchase order is a commitment, not a debt. The payable
 * column is empty until Finance has recorded an invoice, because procurement cannot state a debt that
 * has not been raised. Presenting ordered value as "owed" would overstate liabilities by the whole
 * outstanding order book.
 */
export default async function SupplierAccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.reconciliation.view")) {
    return <PermissionGuard permission="procurement.reconciliation.view" />;
  }

  const params = await searchParams;
  const page = Number(single(params.page) ?? "1") || 1;
  const search = single(params.q);
  const { rows, total, pageSize } = await getSupplierPositions({ search, page });
  const positions = rows as unknown as Row[];

  const filterFields: FilterField[] = [
    { type: "search", name: "q", label: "Search", placeholder: "Supplier name or reference…", defaultValue: search },
  ];

  return (
    <div>
      <PageHeader
        title="Supplier accounts"
        description="What has been ordered, received and invoiced per supplier, with the advance balance beside it. Each figure comes from records of its own kind — nothing here is typed in."
        breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Supplier accounts" }]}
      />

      <Alert tone="info" title="A commitment is not a debt">
        Ordered value is what the company has committed to buy. The payable is what Finance has invoiced. The two are
        shown separately and are never added together.
      </Alert>

      <div className="erp-card mt-4 overflow-hidden">
        <FilterBar action="/procurement/suppliers" fields={filterFields} />

        {positions.length === 0 ? (
          <EmptyState
            icon={Scale}
            title={search ? "No supplier matches that search" : "No supplier positions yet"}
            description={
              search
                ? "Search runs on the server, so an empty result is real. Try the supplier reference instead of a trading name."
                : "Positions appear once suppliers have orders, receipts or advances recorded against them."
            }
          />
        ) : (
          <>
            <TableWrapper>
              <Table className="min-w-[66rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Supplier</TH>
                    <TH>Currency</TH>
                    <TH className="text-right">Ordered</TH>
                    <TH className="text-right">Received</TH>
                    <TH className="text-right">Invoiced</TH>
                    <TH className="text-right">Paid</TH>
                    <TH className="text-right">Advance balance</TH>
                    <TH className="text-right">Confirmed payable</TH>
                    <TH className="text-right">Unreconciled</TH>
                  </TR>
                </THead>
                <TBody>
                  {positions.map((row) => (
                    <TR key={`${row.supplier_id}-${row.currency_code}`}>
                      <TD>
                        <Link
                          href={`/procurement/suppliers/${row.supplier_id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {row.legal_name}
                        </Link>
                        <p className="text-[0.6875rem] text-ink-subtle">
                          {row.reference} · {row.supplier_status}
                        </p>
                      </TD>
                      <TD className="text-xs">{row.currency_code}</TD>
                      <TD className="text-right tabular-nums">{money(row.currency_code, row.ordered_amount)}</TD>
                      <TD className="text-right tabular-nums">{money(row.currency_code, row.received_value)}</TD>
                      <TD className="text-right tabular-nums">{money(row.currency_code, row.invoiced_amount)}</TD>
                      <TD className="text-right tabular-nums">{money(row.currency_code, row.paid_amount)}</TD>
                      <TD className="text-right tabular-nums">{money(row.currency_code, row.advance_balance)}</TD>
                      <TD className="text-right tabular-nums">
                        {row.payable_is_basis_known ? (
                          money(row.currency_code, row.confirmed_payable)
                        ) : (
                          <Badge tone="neutral">No invoice recorded</Badge>
                        )}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {row.unreconciled_difference && Number(row.unreconciled_difference) !== 0 ? (
                          <span className="text-warning-700">
                            {money(row.currency_code, row.unreconciled_difference)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>

            <Pagination page={page} pageSize={pageSize} total={total} baseHref="/procurement/suppliers" params={{ q: search }} />
          </>
        )}
      </div>
    </div>
  );
}
