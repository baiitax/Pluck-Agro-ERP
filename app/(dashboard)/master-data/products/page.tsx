import type { Metadata } from "next";
import Link from "next/link";
import { Package } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, type FilterField } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { MASTER_STATUS_LABELS, PRODUCT_STATUSES, PRODUCT_TYPES, labelFor, masterStatusTone } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { cn } from "@/lib/utils";
import { getProductCategories, getProducts } from "@/services/master-data/products";

export const metadata: Metadata = { title: "Product catalogue" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : (value ?? undefined));

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const { allowed, principal } = await guardMasterDataPage("master_data.products.view");
  if (!allowed) return <PermissionGuard permission="master_data.products.view" />;

  const params = await searchParams;
  const filters = {
    search: single(params.q),
    status: single(params.status),
    type: single(params.type),
    categoryId: single(params.category),
    page: Number(single(params.page) ?? "1") || 1,
    pageSize: 25,
    sort: (single(params.sort) as "recent" | "name" | "code" | "status" | undefined) ?? "recent",
  };

  const [{ rows, total, pageSize }, categories] = await Promise.all([getProducts(filters), getProductCategories()]);
  const canCreate = principal.permissions.has("master_data.products.create");
  const filtered = Boolean(filters.search || filters.status || filters.type || filters.categoryId);

  const filterFields: FilterField[] = [
    { type: "search", name: "q", label: "Search", placeholder: "Code, name, brand…", defaultValue: filters.search },
    {
      type: "select",
      name: "status",
      label: "Status",
      defaultValue: filters.status ?? "",
      options: [
        { value: "", label: "All statuses" },
        ...PRODUCT_STATUSES.map((status) => ({ value: status, label: MASTER_STATUS_LABELS[status] ?? status })),
      ],
    },
    {
      type: "select",
      name: "type",
      label: "Type",
      defaultValue: filters.type ?? "",
      options: [{ value: "", label: "All types" }, ...PRODUCT_TYPES.map((type) => ({ value: type, label: labelFor(type) }))],
    },
    {
      type: "select",
      name: "category",
      label: "Category",
      defaultValue: filters.categoryId ?? "",
      options: [
        { value: "", label: "All categories" },
        ...categories.map((category) => ({ value: category.id, label: `${category.name} (${category.code})` })),
      ],
    },
  ];

  return (
    <div>
      <PageHeader
        title="Product catalogue"
        description="Items Pluck Agro buys, processes, sells or stores. Volumes and weights are never assumed: each product has one base unit, and any other unit is reached through an explicit, effective-dated conversion."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Products" }]}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/master-data/products/categories" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              Categories
            </Link>
            {canCreate ? (
              <Link href="/master-data/products/new" className={cn(buttonVariants({ size: "sm" }))}>
                New product
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="erp-card overflow-hidden">
        <FilterBar action="/master-data/products" fields={filterFields} />
        {rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title={filtered ? "No products match these filters" : "No products recorded"}
            description={
              filtered
                ? "Filters are applied in the query; this is a real result."
                : canCreate
                  ? "Create the first product, or load the catalogue through the import centre. Reference data (categories and units) must exist first."
                  : "A user with master_data.products.create permission adds products."
            }
          />
        ) : (
          <TableWrapper>
            <Table className="min-w-[52rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Code</TH>
                  <TH>Product</TH>
                  <TH>Category</TH>
                  <TH>Type</TH>
                  <TH>Base unit</TH>
                  <TH>Variants</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="font-mono text-[0.6875rem] text-ink-muted">
                      <Link href={`/master-data/products/${row.id}`} className="hover:text-brand-700 hover:underline">
                        {row.code}
                      </Link>
                    </TD>
                    <TD>
                      <Link href={`/master-data/products/${row.id}`} className="text-xs font-semibold text-ink hover:text-brand-700">
                        {row.name}
                      </Link>
                      {row.brand ? <span className="block text-[0.6875rem] text-ink-subtle">{row.brand}</span> : null}
                    </TD>
                    <TD className="text-xs">{row.category?.name ?? "—"}</TD>
                    <TD className="text-xs">{labelFor(row.product_type)}</TD>
                    <TD className="text-xs">{row.base_unit ? `${row.base_unit.name} (${row.base_unit.code})` : "—"}</TD>
                    <TD className="text-xs">{row.variant_count}</TD>
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
            baseHref="/master-data/products"
            params={{ q: filters.search, status: filters.status, type: filters.type, category: filters.categoryId, sort: filters.sort }}
          />
        ) : null}
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {total} product(s) visible to you · discontinued products stay visible for history; archived products are hidden from selection lists.
      </p>
    </div>
  );
}
