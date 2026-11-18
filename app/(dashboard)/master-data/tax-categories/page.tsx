import type { Metadata } from "next";

import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { saveTaxCategoryAction } from "@/app/(dashboard)/master-data/actions";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getTaxCategories } from "@/services/master-data/commercial";

export const metadata: Metadata = { title: "Tax categories" };
export const dynamic = "force-dynamic";

export default async function TaxCategoriesPage() {
  const { allowed, principal } = await guardMasterDataPage("master_data.tax_categories.view");
  if (!allowed) return <PermissionGuard permission="master_data.tax_categories.view" />;

  const categories = await getTaxCategories();
  const canManage = principal.permissions.has("master_data.tax_categories.manage");

  const fields = [
    { name: "code", label: "Code", required: true },
    { name: "name", label: "Name", required: true },
    { name: "country", label: "Country / jurisdiction" },
    { name: "taxType", label: "Tax type", hint: "e.g. VAT, withholding, excise — as named by the authority." },
    { name: "effectiveFrom", label: "Effective from", type: "date" as const },
    { name: "effectiveUntil", label: "Effective until", type: "date" as const },
    { name: "isActive", label: "Active", type: "checkbox" as const },
    { name: "description", label: "Description", type: "textarea" as const, wide: true },
  ];

  return (
    <div>
      <PageHeader
        title="Tax categories"
        description="Tax classifications used for reporting and configuration. No tax rate is stored or calculated in this phase: rates are a statutory fact that must come from the relevant authority, not from this system."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Tax categories" }]}
        actions={
          canManage ? (
            <RecordFormDialog
              title="New tax category"
              description="A classification only. Rates, exempt thresholds and filing rules are outside this phase."
              triggerLabel="New category"
              action={saveTaxCategoryAction}
              fields={fields}
              values={{ isActive: true }}
            />
          ) : null
        }
      />

      <Card className="mb-4 p-3">
        <p className="text-[0.6875rem] text-ink-muted">
          Deliberately no rate field: this phase does not calculate tax. A percentage entered here could be mistaken for an authoritative rate, which would be worse than having none.
        </p>
      </Card>

      <div className="erp-card overflow-hidden">
        {categories.length === 0 ? (
          <EmptyState title="No tax categories recorded" description="Add only the categories the business is actually registered under." />
        ) : (
          <TableWrapper>
            <Table className="min-w-[44rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Code</TH>
                  <TH>Name</TH>
                  <TH>Country</TH>
                  <TH>Tax type</TH>
                  <TH>Effective</TH>
                  <TH>Status</TH>
                  {canManage ? <TH className="text-right">Actions</TH> : null}
                </TR>
              </THead>
              <TBody>
                {categories.map((category) => (
                  <TR key={category.id}>
                    <TD className="font-mono text-xs font-semibold text-ink">{category.code}</TD>
                    <TD className="text-xs">{category.name}</TD>
                    <TD className="text-xs">{category.country ?? "—"}</TD>
                    <TD className="text-xs">{category.tax_type ?? "—"}</TD>
                    <TD className="text-xs">
                      {category.effective_from ?? "—"}
                      {category.effective_until ? ` → ${category.effective_until}` : ""}
                    </TD>
                    <TD>
                      <Badge tone={category.is_active ? "success" : "neutral"} dot>
                        {category.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    {canManage ? (
                      <TD className="text-right">
                        <RecordFormDialog
                          title={`Edit ${category.code}`}
                          description="Effective dates define when the classification applies; nothing is backdated automatically."
                          triggerLabel="Edit"
                          trigger="edit"
                          action={saveTaxCategoryAction}
                          hidden={{ id: category.id }}
                          fields={fields}
                          values={{
                            code: category.code,
                            name: category.name,
                            country: category.country ?? "",
                            taxType: category.tax_type ?? "",
                            effectiveFrom: category.effective_from ?? "",
                            effectiveUntil: category.effective_until ?? "",
                            isActive: category.is_active,
                            description: category.description ?? "",
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

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">{categories.length} tax categor(ies) recorded.</p>
    </div>
  );
}
