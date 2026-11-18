import type { Metadata } from "next";

import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { saveSupplierCategoryAction } from "@/app/(dashboard)/master-data/actions";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getSupplierCategories } from "@/services/master-data/categories";

export const metadata: Metadata = { title: "Supplier categories" };
export const dynamic = "force-dynamic";

export default async function SupplierCategoriesPage() {
  const { allowed, principal } = await guardMasterDataPage("master_data.supplier_categories.view");
  if (!allowed) return <PermissionGuard permission="master_data.supplier_categories.view" />;

  const categories = await getSupplierCategories();
  const canManage = principal.permissions.has("master_data.supplier_categories.manage");

  return (
    <div>
      <PageHeader
        title="Supplier categories"
        description="A flat classification of what suppliers provide. A supplier can hold several categories and is never restricted to one commodity; the primary category is for reporting."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Suppliers", href: "/master-data/suppliers" },
          { label: "Categories" },
        ]}
        actions={
          canManage ? (
            <RecordFormDialog
              title="New supplier category"
              description="Codes are stable identifiers reused by imports."
              triggerLabel="New category"
              action={saveSupplierCategoryAction}
              fields={[
                { name: "code", label: "Code", required: true },
                { name: "name", label: "Name", required: true },
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
          <EmptyState title="No supplier categories" description="Categories group suppliers for reporting and approval scope. Nothing is pre-created for you." />
        ) : (
          <TableWrapper>
            <Table className="min-w-[40rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Name</TH>
                  <TH>Code</TH>
                  <TH>Suppliers</TH>
                  <TH>Sort</TH>
                  <TH>Status</TH>
                  {canManage ? <TH className="text-right">Actions</TH> : null}
                </TR>
              </THead>
              <TBody>
                {categories.map((category) => (
                  <TR key={category.id}>
                    <TD className="text-xs font-semibold text-ink">
                      {category.name}
                      {category.description ? <span className="block text-[0.6875rem] font-normal text-ink-subtle">{category.description}</span> : null}
                    </TD>
                    <TD className="font-mono text-[0.6875rem] text-ink-muted">{category.code}</TD>
                    <TD className="text-xs">{category.usage_count}</TD>
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
                          description="Deactivating keeps existing supplier references but removes the category from selection lists."
                          triggerLabel="Edit"
                          trigger="edit"
                          action={saveSupplierCategoryAction}
                          hidden={{ id: category.id }}
                          fields={[
                            { name: "code", label: "Code", required: true },
                            { name: "name", label: "Name", required: true },
                            { name: "sortOrder", label: "Sort order", type: "number" },
                            { name: "description", label: "Description", type: "textarea", wide: true },
                            { name: "isActive", label: "Active", type: "checkbox" },
                          ]}
                          values={{
                            code: category.code,
                            name: category.name,
                            sortOrder: String(category.sort_order),
                            description: category.description ?? "",
                            isActive: category.is_active,
                          }}
                        />
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {categories.length} categor(ies) · the supplier count is the number of records whose primary category is this one.
      </p>
    </div>
  );
}
