import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterField } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { CUSTOMER_STATUSES, CUSTOMER_TYPES, MASTER_STATUS_LABELS, labelFor, masterStatusTone } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { cn } from "@/lib/utils";
import { getCustomerCategories } from "@/services/master-data/categories";
import { getCustomers } from "@/services/master-data/customers";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : (value ?? undefined));

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const { allowed, principal } = await guardMasterDataPage("master_data.customers.view");
  if (!allowed) return <PermissionGuard permission="master_data.customers.view" />;

  const params = await searchParams;
  const filters = {
    search: single(params.q),
    status: single(params.status),
    type: single(params.type),
    categoryId: single(params.category),
    page: Number(single(params.page) ?? "1") || 1,
    pageSize: 25,
    sort: (single(params.sort) as "recent" | "name" | "reference" | "status" | undefined) ?? "recent",
  };

  const [{ rows, total, pageSize }, categories] = await Promise.all([getCustomers(filters), getCustomerCategories()]);
  const canCreate = principal.permissions.has("master_data.customers.create");
  const filtered = Boolean(filters.search || filters.status || filters.type || filters.categoryId);

  const filterFields: FilterField[] = [
    { type: "search", name: "q", label: "Search", placeholder: "Legal name, reference, contact…", defaultValue: filters.search },
    {
      type: "select",
      name: "status",
      label: "Status",
      defaultValue: filters.status ?? "",
      options: [
        { value: "", label: "All statuses" },
        ...CUSTOMER_STATUSES.map((status) => ({ value: status, label: MASTER_STATUS_LABELS[status] ?? status })),
      ],
    },
    {
      type: "select",
      name: "type",
      label: "Type",
      defaultValue: filters.type ?? "",
      options: [{ value: "", label: "All types" }, ...CUSTOMER_TYPES.map((type) => ({ value: type, label: labelFor(type) }))],
    },
    {
      type: "select",
      name: "category",
      label: "Category",
      defaultValue: filters.categoryId ?? "",
      options: [{ value: "", label: "All categories" }, ...categories.map((category) => ({ value: category.id, label: category.name }))],
    },
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Buyers and prospective buyers. A customer record is not a market restriction: a customer may be an exporter, a distributor or a domestic buyer, and may hold several categories."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Customers" }]}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/master-data/customer-categories" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              Categories
            </Link>
            {canCreate ? (
              <Link href="/master-data/customers/new" className={cn(buttonVariants({ size: "sm" }))}>
                New customer
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="erp-card overflow-hidden">
        <FilterBar action="/master-data/customers" fields={filterFields} />
        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={filtered ? "No customers match these filters" : "No customers recorded"}
            description={
              filtered
                ? "Filters are applied in the query, so this is a real result rather than a failed load."
                : canCreate
                  ? "Add the first customer, or import an existing register through the import centre."
                  : "A user with master_data.customers.create permission adds customers."
            }
          />
        ) : (
          <TableWrapper>
            <Table className="min-w-[50rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Reference</TH>
                  <TH>Customer</TH>
                  <TH>Type</TH>
                  <TH>Category</TH>
                  <TH>Country</TH>
                  <TH>Contacts</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="font-mono text-[0.6875rem] text-ink-muted">
                      <Link href={`/master-data/customers/${row.id}`} className="hover:text-brand-700 hover:underline">
                        {row.reference}
                      </Link>
                    </TD>
                    <TD>
                      <Link href={`/master-data/customers/${row.id}`} className="text-xs font-semibold text-ink hover:text-brand-700">
                        {row.legal_name}
                      </Link>
                      {row.trading_name ? <span className="block text-[0.6875rem] text-ink-subtle">{row.trading_name}</span> : null}
                    </TD>
                    <TD className="text-xs">{labelFor(row.customer_type)}</TD>
                    <TD className="text-xs">{row.category?.name ?? "—"}</TD>
                    <TD className="text-xs">{row.registration_country ?? "—"}</TD>
                    <TD className="text-xs">{row.contact_count}</TD>
                    <TD>
                      <Badge tone={masterStatusTone(row.status)} dot>
                        {MASTER_STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
        {total > pageSize ? (
          <Pagination
            page={filters.page}
            pageSize={pageSize}
            total={total}
            baseHref="/master-data/customers"
            params={{ q: filters.search, status: filters.status, type: filters.type, category: filters.categoryId, sort: filters.sort }}
          />
        ) : null}
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">{total} customer(s) visible to you.</p>
    </div>
  );
}
