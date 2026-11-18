import type { Metadata } from "next";

import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { saveProductCategoryAction } from "@/app/(dashboard)/master-data/actions";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getProductCategories } from "@/services/master-data/products";

export const metadata: Metadata = { title: "Product categories" };
export const dynamic = "force-dynamic";

export default async function ProductCategoriesPage() {
  const { allowed, principal } = await guardMasterDataPage("master_data.product_categories.view");
  if (!allowed) return <PermissionGuard permission="master_data.product_categories.view" />;

  const categories = await getProductCategories();
  const canManage = principal.permissions.has("master_data.product_categories.manage");

  const byId = new Map(categories.map((category) => [category.id, category]));
  const depthOf = (id: string | null): number => {
    let depth = 0;
    let current = id;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const parent = byId.get(current)?.parent_category_id ?? null;
      if (!parent) break;
      depth += 1;
      current = parent;
    }
    return depth;
  };

  const ordered = [...categories].sort((left, right) => {
    if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
    return left.name.localeCompare(right.name);
  });

  const parentOptions = categories
    .filter((category) => category.is_active)
    .map((category) => ({ value: category.id, label: `${category.name} (${category.code})` }));

  return (
    <div>
      <PageHeader
        title="Product categories"
        description="A hierarchical classification of the catalogue. A category may have a parent, and the hierarchy is used for reporting; it does not restrict which suppliers or customers can be linked to a product."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Products", href: "/master-data/products" },
          { label: "Categories" },
        ]}
        actions={
          canManage ? (
            <RecordFormDialog
              title="New product category"
              description="Codes are stable identifiers used by imports. Changing a code later breaks those references, so choose carefully."
              triggerLabel="New category"
              action={saveProductCategoryAction}
              fields={[
                { name: "code", label: "Code", required: true },
                { name: "name", label: "Name", required: true },
                { name: "parentCategoryId", label: "Parent category", type: "select", options: parentOptions },
                { name: "sortOrder", label: "Sort order", type: "number" },
                { name: "description", label: "Description", type: "textarea", wide: true },
                { name: "isActive", label: "Active", type: "checkbox" },
              ]}
              values={{ isActive: true }}
            />
          ) : null
        }
      />

      <div className="erp-card overflow-hidden">
        {categories.length === 0 ? (
          <EmptyState
            title="No product categories"
            description={
              canManage
                ? "Create a top-level category first. Supplier and product records reference categories, so this is usually the first reference data to populate."
                : "A user with master_data.product_categories.manage permission creates categories."
            }
          />
        ) : (
          <TableWrapper>
            <Table className="min-w-[44rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Category</TH>
                  <TH>Code</TH>
                  <TH>Parent</TH>
                  <TH>Sort</TH>
                  <TH>Status</TH>
                  {canManage ? <TH className="text-right">Actions</TH> : null}
                </TR>
              </THead>
              <TBody>
                {ordered.map((category) => {
                  const depth = depthOf(category.id);
                  return (
                    <TR key={category.id}>
                      <TD>
                        <span style={{ paddingLeft: `${depth * 14}px` }} className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                          {depth > 0 ? <span aria-hidden className="text-ink-subtle">└</span> : null}
                          {category.name}
                        </span>
                        {category.description ? (
                          <span className="block text-[0.6875rem] text-ink-subtle">{category.description}</span>
                        ) : null}
                      </TD>
                      <TD className="font-mono text-[0.6875rem] text-ink-muted">{category.code}</TD>
                      <TD className="text-xs">{category.parent_category_id ? (byId.get(category.parent_category_id)?.name ?? "—") : "—"}</TD>
                      <TD className="text-xs">{category.sort_order}</TD>
                      <TD>
                        <Badge tone={category.is_active ? "success" : "neutral"} dot>
                          {category.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TD>
                      {canManage ? (
                        <TD className="text-right">
                          <RecordFormDialog
                            title={`Edit ${category.name}`}
                            description="Deactivating a category keeps existing references intact but removes it from selection lists."
                            triggerLabel="Edit"
                            trigger="edit"
                            action={saveProductCategoryAction}
                            hidden={{ id: category.id }}
                            fields={[
                              { name: "code", label: "Code", required: true },
                              { name: "name", label: "Name", required: true },
                              { name: "parentCategoryId", label: "Parent category", type: "select", options: parentOptions.filter((option) => option.value !== category.id) },
                              { name: "sortOrder", label: "Sort order", type: "number" },
                              { name: "description", label: "Description", type: "textarea", wide: true },
                              { name: "isActive", label: "Active", type: "checkbox" },
                            ]}
                            values={{
                              code: category.code,
                              name: category.name,
                              parentCategoryId: category.parent_category_id ?? "",
                              sortOrder: String(category.sort_order),
                              description: category.description ?? "",
                              isActive: category.is_active,
                            }}
                          />
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">{categories.length} categor(ies) · hierarchy depth is computed from parent links, and a parent cannot be its own descendant.</p>
    </div>
  );
}
