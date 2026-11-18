import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Upload } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterField } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { MASTER_STATUS_LABELS, SUPPLIER_STATUSES, labelFor, masterStatusTone } from "@/lib/master-data/statuses";
import { cn } from "@/lib/utils";
import { getSupplierCategories } from "@/services/master-data/categories";
import { getSuppliers } from "@/services/master-data/suppliers";

export const metadata: Metadata = { title: "Suppliers" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

export default async function SuppliersPage({ searchParams }: { searchParams: SearchParams }) {
  const { allowed, principal } = await guardMasterDataPage("master_data.suppliers.view");
  if (!allowed) return <PermissionGuard permission="master_data.suppliers.view" />;

  const params = await searchParams;
  const page = Number(single(params.page) ?? "1") || 1;
  const filters = {
    search: single(params.q),
    status: single(params.status),
    verificationStatus: single(params.verification),
    categoryId: single(params.category),
    page,
    pageSize: 25,
    sort: (single(params.sort) as "recent" | "name" | "reference" | "status" | undefined) ?? "recent",
  };

  const [{ rows, total, pageSize }, categories] = await Promise.all([getSuppliers(filters), getSupplierCategories()]);

  const canCreate = principal.permissions.has("master_data.suppliers.create");

  const filterFields: FilterField[] = [
    { type: "search", name: "q", label: "Search", placeholder: "Legal name, reference, registration no…", defaultValue: filters.search },
    {
      type: "select",
      name: "status",
      label: "Status",
      defaultValue: filters.status ?? "",
      options: [{ value: "", label: "All statuses" }, ...SUPPLIER_STATUSES.map((status) => ({ value: status, label: MASTER_STATUS_LABELS[status] ?? status }))],
    },
    {
      type: "select",
      name: "verification",
      label: "Verification",
      defaultValue: filters.verificationStatus ?? "",
      options: [
        { value: "", label: "Any" },
        { value: "unverified", label: "Unverified" },
        { value: "pending", label: "Pending" },
        { value: "verified", label: "Verified" },
        { value: "failed", label: "Failed" },
      ],
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
        title="Suppliers"
        description="Business partners who supply goods and services. A supplier is not limited to one commodity category: the primary category drives reporting, while approved product categories record what it may actually supply. Verification is a separate human decision from activation."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Suppliers" }]}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/master-data/supplier-categories" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              Categories
            </Link>
            <Link href="/master-data/imports" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              <Upload aria-hidden /> Import
            </Link>
            {canCreate ? (
              <Link href="/master-data/suppliers/new" className={cn(buttonVariants({ size: "sm" }))}>
                New supplier
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="erp-card overflow-hidden">
        <FilterBar action="/master-data/suppliers" fields={filterFields} />

        {rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={filters.search || filters.status || filters.categoryId ? "No suppliers match these filters" : "No suppliers recorded"}
            description={
              filters.search || filters.status || filters.categoryId
                ? "Clear or widen the filters to see more. Filters are applied on the server, so an empty list here is a real result."
                : canCreate
                  ? "Add the first supplier, or stage a CSV import to load an existing register."
                  : "A user with master_data.suppliers.create permission adds suppliers, or imports them through the import centre."
            }
            action={
              canCreate && !filters.search && !filters.status ? (
                <Link href="/master-data/suppliers/new" className={cn(buttonVariants({ size: "sm" }))}>
                  New supplier
                </Link>
              ) : null
            }
          />
        ) : (
          <TableWrapper>
            <Table className="min-w-[52rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Reference</TH>
                  <TH>Supplier</TH>
                  <TH>Category</TH>
                  <TH>Country</TH>
                  <TH>Contacts</TH>
                  <TH>Verification</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="font-mono text-[0.6875rem] text-ink-muted">
                      <Link href={`/master-data/suppliers/${row.id}`} className="hover:text-brand-700 hover:underline">
                        {row.reference}
                      </Link>
                    </TD>
                    <TD>
                      <Link href={`/master-data/suppliers/${row.id}`} className="text-xs font-semibold text-ink hover:text-brand-700">
                        {row.legal_name}
                      </Link>
                      {row.trading_name ? <span className="block text-[0.6875rem] text-ink-subtle">{row.trading_name}</span> : null}
                    </TD>
                    <TD className="text-xs">{row.category?.name ?? "—"}</TD>
                    <TD className="text-xs">{row.registration_country ?? "—"}</TD>
                    <TD className="text-xs">{row.contact_count}</TD>
                    <TD>
                      <Badge tone={row.verification_status === "verified" ? "success" : row.verification_status === "failed" ? "danger" : "neutral"}>
                        {labelFor(row.verification_status)}
                      </Badge>
                    </TD>
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
            baseHref="/master-data/suppliers"
            params={{ q: filters.search, status: filters.status, verification: filters.verificationStatus, category: filters.categoryId, sort: filters.sort }}
          />
        ) : null}
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {total} supplier(s) visible to you · statuses follow a configured lifecycle; a blocked supplier can still be edited but must not be used for new procurement.
      </p>
    </div>
  );
}
