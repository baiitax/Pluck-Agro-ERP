import type { Metadata } from "next";
import { Ruler } from "lucide-react";

import { ConversionPreviewPanel } from "@/app/(dashboard)/master-data/units/conversion-preview";
import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { saveUnitAction, saveUnitConversionAction } from "@/app/(dashboard)/master-data/actions";
import { UNIT_CATEGORIES, labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getProductOptions } from "@/services/master-data/reference-data";
import { getConversions, getUnits } from "@/services/master-data/units";

export const metadata: Metadata = { title: "Units & conversions" };
export const dynamic = "force-dynamic";

export default async function UnitsPage() {
  const { allowed, principal } = await guardMasterDataPage("master_data.units.view");
  if (!allowed) return <PermissionGuard permission="master_data.units.view" />;

  const [units, conversions, products] = await Promise.all([getUnits(), getConversions(), getProductOptions()]);
  const canManageUnits = principal.permissions.has("master_data.units.manage");
  const canManageConversions = principal.permissions.has("master_data.conversions.manage");

  const unitOptions = units.map((unit) => ({ value: unit.id, label: `${unit.name} (${unit.code}) · ${unit.category}` }));

  const grouped = UNIT_CATEGORIES.map((category) => ({
    category,
    units: units.filter((unit) => unit.category === category),
  })).filter((group) => group.units.length > 0);

  return (
    <div>
      <PageHeader
        title="Units &amp; conversions"
        description="Measurement is explicit in this system. Every product has one base unit, every other unit is reached through a declared conversion with an effective date, and no conversion is ever inferred — one bag is not assumed to equal one bag."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Units & conversions" },
        ]}
        actions={
          canManageUnits ? (
            <RecordFormDialog
              title="New unit of measure"
              description="Unit codes are short symbols such as kg or MT. A category constrains which conversions are legal: mass never converts to volume without a product-specific rule."
              triggerLabel="New unit"
              action={saveUnitAction}
              fields={[
                { name: "code", label: "Code", required: true },
                { name: "name", label: "Name", required: true },
                { name: "symbol", label: "Symbol" },
                { name: "category", label: "Category", type: "select", required: true, options: UNIT_CATEGORIES.map((category) => ({ value: category, label: category })) },
                { name: "precision", label: "Decimal precision", type: "number", hint: "0–6. Quantities are stored as NUMERIC and rounded explicitly." },
                { name: "isBaseUnit", label: "Base unit for its category", type: "checkbox" },
                { name: "isActive", label: "Active", type: "checkbox" },
                { name: "notes", label: "Notes", type: "textarea", wide: true },
              ]}
              values={{ category: "MASS", precision: "3", isActive: true }}
            />
          ) : null
        }
      />

      <div className="grid gap-4">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Ruler className="size-4 text-ink-subtle" aria-hidden /> Units of measure
            </h2>
            <span className="text-[0.6875rem] text-ink-subtle">{units.length} recorded</span>
          </div>
          {units.length === 0 ? (
            <EmptyState
              title="No units recorded"
              description="Units are prerequisite reference data: products cannot be created until at least one unit exists in the product's category."
            />
          ) : (
            <TableWrapper>
              <Table className="min-w-[44rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Unit</TH>
                    <TH>Code</TH>
                    <TH>Category</TH>
                    <TH>Precision</TH>
                    <TH>Base</TH>
                    <TH>Status</TH>
                    {canManageUnits ? <TH className="text-right">Actions</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {units.map((unit) => (
                    <TR key={unit.id}>
                      <TD className="text-xs font-semibold text-ink">
                        {unit.name}
                        {unit.symbol ? <span className="ml-1 font-normal text-ink-subtle">({unit.symbol})</span> : null}
                      </TD>
                      <TD className="font-mono text-[0.6875rem] text-ink-muted">{unit.code}</TD>
                      <TD className="text-xs">{unit.category}</TD>
                      <TD className="text-xs">{unit.precision}</TD>
                      <TD>{unit.is_base_unit ? <Badge tone="info">Base</Badge> : "—"}</TD>
                      <TD>
                        <Badge tone={unit.is_active ? "success" : "neutral"} dot>
                          {unit.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TD>
                      {canManageUnits ? (
                        <TD className="text-right">
                          <RecordFormDialog
                            title={`Edit ${unit.name}`}
                            description="Deactivating a unit removes it from selection lists but leaves historical conversions intact."
                            triggerLabel="Edit"
                            trigger="edit"
                            action={saveUnitAction}
                            hidden={{ id: unit.id }}
                            fields={[
                              { name: "code", label: "Code", required: true },
                              { name: "name", label: "Name", required: true },
                              { name: "symbol", label: "Symbol" },
                              { name: "category", label: "Category", type: "select", required: true, options: UNIT_CATEGORIES.map((category) => ({ value: category, label: category })) },
                              { name: "precision", label: "Decimal precision", type: "number" },
                              { name: "isBaseUnit", label: "Base unit for its category", type: "checkbox" },
                              { name: "isActive", label: "Active", type: "checkbox" },
                              { name: "notes", label: "Notes", type: "textarea", wide: true },
                            ]}
                            values={{
                              code: unit.code,
                              name: unit.name,
                              symbol: unit.symbol ?? "",
                              category: unit.category,
                              precision: String(unit.precision),
                              isBaseUnit: unit.is_base_unit,
                              isActive: unit.is_active,
                              notes: unit.notes ?? "",
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
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div>
              <h2 className="text-sm font-semibold text-ink">Conversion rules</h2>
              <p className="text-[0.6875rem] text-ink-subtle">
                Effective-dated and never rewritten. A historical quantity keeps the factor that applied on its date.
              </p>
            </div>
            {canManageConversions ? (
              <RecordFormDialog
                title="New conversion rule"
                description="A cross-category conversion (for example bags to kilograms) must be tied to a specific product, because the factor depends on what is in the bag."
                triggerLabel="New rule"
                action={saveUnitConversionAction}
                fields={[
                  { name: "fromUnitId", label: "From unit", type: "select", required: true, options: unitOptions },
                  { name: "toUnitId", label: "To unit", type: "select", required: true, options: unitOptions },
                  { name: "conversionFactor", label: "Factor", required: true, step: "any", hint: "Decimal, up to 12 places. Evaluated exactly, not in binary floating point." },
                  {
                    name: "conversionMethod",
                    label: "Method",
                    type: "select",
                    required: true,
                    options: [
                      { value: "multiply", label: "Multiply by the factor" },
                      { value: "divide", label: "Divide by the factor" },
                    ],
                  },
                  {
                    name: "productId",
                    label: "Product (required across categories)",
                    type: "select",
                    options: products.map((product) => ({ value: product.id, label: `${product.name} (${product.code})` })),
                  },
                  { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
                  { name: "effectiveUntil", label: "Effective until", type: "date", hint: "Leave blank for an open-ended rule." },
                  { name: "notes", label: "Notes", type: "textarea", wide: true },
                ]}
                values={{ conversionMethod: "multiply" }}
              />
            ) : null}
          </div>
          {conversions.length === 0 ? (
            <EmptyState
              title="No conversion rules"
              description="Without a rule, the system refuses to convert between units rather than assuming a factor. Add one only where the business has established it."
            />
          ) : (
            <TableWrapper>
              <Table className="min-w-[46rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>From</TH>
                    <TH>To</TH>
                    <TH>Factor</TH>
                    <TH>Method</TH>
                    <TH>Scope</TH>
                    <TH>Effective</TH>
                  </TR>
                </THead>
                <TBody>
                  {conversions.map((conversion) => (
                    <TR key={conversion.id}>
                      <TD className="text-xs">{conversion.from_unit ? `${conversion.from_unit.code}` : "—"}</TD>
                      <TD className="text-xs">{conversion.to_unit ? `${conversion.to_unit.code}` : "—"}</TD>
                      <TD className="font-mono text-xs">{String(conversion.conversion_factor)}</TD>
                      <TD className="text-xs">{labelFor(conversion.conversion_method)}</TD>
                      <TD className="text-xs">{conversion.product ? conversion.product.name : "Standard (category-wide)"}</TD>
                      <TD className="text-xs">
                        {conversion.effective_from} → {conversion.effective_until ?? "open"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink">Test a conversion</h2>
          <p className="mb-3 max-w-3xl text-[0.6875rem] text-ink-subtle">
            This uses the same server-side engine that procurement and inventory will call. It will refuse an incompatible category, an expired rule or an ambiguous pair rather than picking one.
          </p>
          <ConversionPreviewPanel
            units={units.filter((unit) => unit.is_active).map((unit) => ({ id: unit.id, label: `${unit.name} (${unit.code})` }))}
            products={products.map((product) => ({ id: product.id, label: `${product.name} (${product.code})` }))}
          />
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {grouped.map((group) => (
            <Card key={group.category} className="p-3">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-subtle">{group.category}</p>
              <p className="mt-1 text-xs text-ink">
                {group.units.map((unit) => unit.code).join(" · ")}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
