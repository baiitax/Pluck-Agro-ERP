import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Boxes, History, Package, Ruler, SlidersHorizontal, Tags } from "lucide-react";

import { ConfirmActionButton } from "@/components/master-data/confirm-action-button";
import { DetailList } from "@/components/master-data/detail-list";
import { RecordFormDialog } from "@/components/master-data/record-form-dialog";
import { SectionTabs } from "@/components/master-data/section-tabs";
import { StatusTransitionDialog } from "@/components/master-data/status-transition-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import {
  changeProductStatusAction,
  removeProductPackagingAction,
  removeProductSpecificationAction,
  saveProductAttributeValueAction,
  saveProductPackagingAction,
  saveProductSpecificationAction,
  saveProductVariantAction,
} from "@/app/(dashboard)/master-data/actions";
import { MASTER_STATUS_LABELS, labelFor, masterStatusTone } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { cn } from "@/lib/utils";
import { getProduct } from "@/services/master-data/products";
import { getAvailableTransitions } from "@/services/master-data/status-transitions";
import { getConversions } from "@/services/master-data/units";

export const metadata: Metadata = { title: "Product" };
export const dynamic = "force-dynamic";

const TAB_KEYS = ["overview", "specifications", "variants", "packaging", "attributes", "conversions", "history"] as const;

export default async function ProductProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const requested = (Array.isArray(query.tab) ? query.tab[0] : query.tab) ?? "overview";
  const tab = (TAB_KEYS as readonly string[]).includes(requested) ? requested : "overview";

  const { allowed, principal } = await guardMasterDataPage("master_data.products.view");
  if (!allowed) return <PermissionGuard permission="master_data.products.view" />;

  const detail = await getProduct(id);
  if (!detail) notFound();
  const { product } = detail;

  const canUpdate = principal.permissions.has("master_data.products.update");
  const canSpecs = principal.permissions.has("master_data.product_specifications.manage");
  const canVariants = principal.permissions.has("master_data.product_variants.manage");
  const canPackaging = principal.permissions.has("master_data.product_packaging.manage");

  const [transitions, conversions] = await Promise.all([
    getAvailableTransitions("product", product.status),
    getConversions(product.id).catch(() => []),
  ]);

  const unitLabel = (unitId: string | null) => {
    if (!unitId) return "—";
    const unit = detail.units.find((entry) => entry.id === unitId);
    return unit ? `${unit.name} (${unit.code})` : "—";
  };

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "specifications", label: "Specifications", count: detail.specifications.length },
    { key: "variants", label: "Variants & grades", count: detail.variants.length },
    { key: "packaging", label: "Packaging", count: detail.packaging.length },
    { key: "attributes", label: "Attributes", count: detail.attributes.length },
    { key: "conversions", label: "Conversions", count: conversions.length },
    { key: "history", label: "History", count: detail.histories.length },
  ];

  return (
    <div>
      <PageHeader
        title={product.name}
        description={`Code ${product.code} · ${labelFor(product.product_type)} · base unit ${unitLabel(product.base_unit_id)}`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Products", href: "/master-data/products" },
          { label: product.code },
        ]}
        badge={
          <Badge tone={masterStatusTone(product.status)} dot>
            {MASTER_STATUS_LABELS[product.status] ?? product.status}
          </Badge>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canUpdate ? (
              <Link href={`/master-data/products/${product.id}/edit`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
                Edit
              </Link>
            ) : null}
            {transitions.length > 0 ? (
              <StatusTransitionDialog
                id={product.id}
                entityLabel="Product"
                currentStatus={MASTER_STATUS_LABELS[product.status] ?? product.status}
                options={transitions}
                action={changeProductStatusAction}
              />
            ) : null}
          </div>
        }
      />

      <SectionTabs base={`/master-data/products/${product.id}`} active={tab} tabs={tabs} />

      <div className="mt-4 space-y-4">
        {tab === "overview" ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-2">
              <h2 className="mb-3 text-sm font-semibold text-ink">Identification</h2>
              <DetailList
                items={[
                  { label: "Reference", value: <span className="font-mono">{product.reference}</span> },
                  { label: "Code", value: <span className="font-mono">{product.code}</span> },
                  { label: "Name", value: product.name },
                  { label: "Category", value: detail.category?.name ?? "—" },
                  { label: "Type", value: labelFor(product.product_type) },
                  { label: "Brand", value: product.brand ?? "—" },
                  { label: "Internal reference", value: product.internal_reference ?? "—" },
                  { label: "Barcode", value: product.barcode ?? "—" },
                  { label: "Origin", value: product.origin ?? "—" },
                  { label: "Processing method", value: product.processing_method ?? "—" },
                  { label: "Created", value: new Date(product.created_at).toLocaleString("en-GB") },
                  { label: "Last updated", value: new Date(product.updated_at).toLocaleString("en-GB") },
                ]}
              />
              {product.description || product.short_description ? (
                <div className="mt-4 rounded-lg bg-surface-muted p-3">
                  <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-subtle">Description</p>
                  <p className="mt-1 whitespace-pre-line text-xs text-ink">{product.description ?? product.short_description}</p>
                </div>
              ) : null}
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Ruler className="size-4 text-ink-subtle" aria-hidden /> Units
              </h2>
              <DetailList
                items={[
                  { label: "Base unit", value: unitLabel(product.base_unit_id) },
                  { label: "Purchase unit", value: unitLabel(product.purchase_unit_id) },
                  { label: "Storage unit", value: unitLabel(product.storage_unit_id) },
                  { label: "Sales unit", value: unitLabel(product.sales_unit_id) },
                  { label: "Production unit", value: unitLabel(product.production_unit_id) },
                ]}
              />
              <p className="mt-3 text-[0.6875rem] text-ink-subtle">
                {product.status === "draft"
                  ? "The base unit can still be changed while the product is a draft."
                  : "The base unit is locked: changing it would silently re-interpret historical quantities."}
              </p>
            </Card>
          </div>
        ) : null}

        {tab === "specifications" ? (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <SlidersHorizontal className="size-4 text-ink-subtle" aria-hidden /> Specifications
                </h2>
                <p className="text-[0.6875rem] text-ink-subtle">Recorded specification values. Nothing here is inferred or defaulted.</p>
              </div>
              {canSpecs ? (
                <RecordFormDialog
                  title="Add specification"
                  description="A critical specification is one that would cause rejection if not met. Grade names are only used where verified."
                  triggerLabel="Add specification"
                  action={saveProductSpecificationAction}
                  hidden={{ productId: product.id }}
                  fields={[
                    { name: "name", label: "Specification", required: true, placeholder: "e.g. Moisture content" },
                    {
                      name: "specificationType",
                      label: "Type",
                      type: "select",
                      required: true,
                      options: [
                        { value: "text", label: "Text" },
                        { value: "number", label: "Number" },
                        { value: "range", label: "Range" },
                        { value: "boolean", label: "Yes / no" },
                      ],
                    },
                    { name: "valueText", label: "Value" },
                    { name: "valueNumber", label: "Numeric value", step: "any" },
                    {
                      name: "unitId",
                      label: "Unit",
                      type: "select",
                      options: detail.units.map((unit) => ({ value: unit.id, label: `${unit.name} (${unit.code})` })),
                    },
                    { name: "isCritical", label: "Critical specification", type: "checkbox" },
                    { name: "notes", label: "Notes", type: "textarea", wide: true },
                  ]}
                />
              ) : null}
            </div>
            {detail.specifications.length === 0 ? (
              <EmptyState
                icon={SlidersHorizontal}
                title="No specifications recorded"
                description="Quality limits are commercial and technical facts. They are entered from verified documentation, never generated."
              />
            ) : (
              <TableWrapper>
                <Table className="min-w-[40rem]">
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Specification</TH>
                      <TH>Type</TH>
                      <TH>Value</TH>
                      <TH>Unit</TH>
                      <TH>Critical</TH>
                      {canSpecs ? <TH className="text-right">Actions</TH> : null}
                    </TR>
                  </THead>
                  <TBody>
                    {detail.specifications.map((specification) => (
                      <TR key={specification.id}>
                        <TD className="text-xs font-medium">{specification.name}</TD>
                        <TD className="text-xs text-ink-muted">{labelFor(specification.specification_type)}</TD>
                        <TD className="text-xs">
                          {specification.value_text ?? (specification.value_number ? String(specification.value_number) : "—")}
                        </TD>
                        <TD className="text-xs">{unitLabel(specification.unit_id)}</TD>
                        <TD>{specification.is_critical ? <Badge tone="warning">Critical</Badge> : "—"}</TD>
                        {canSpecs ? (
                          <TD className="text-right">
                            <ConfirmActionButton
                              action={removeProductSpecificationAction}
                              label="Remove"
                              title="Remove this specification?"
                              description="The specification is removed from the product. The change is recorded in the history."
                              confirmLabel="Remove"
                              hidden={{ id: specification.id, productId: product.id }}
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
        ) : null}

        {tab === "variants" ? (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Tags className="size-4 text-ink-subtle" aria-hidden /> Variants &amp; grades
                </h2>
                <p className="text-[0.6875rem] text-ink-subtle">One variant may be marked default; setting another clears the previous default.</p>
              </div>
              {canVariants ? (
                <RecordFormDialog
                  title="Add variant"
                  description="Use the business&rsquo;s own grade names. Do not invent quality grades."
                  triggerLabel="Add variant"
                  action={saveProductVariantAction}
                  hidden={{ productId: product.id }}
                  fields={[
                    { name: "code", label: "Variant code", required: true },
                    { name: "name", label: "Variant name", required: true },
                    { name: "grade", label: "Grade", hint: "Only where the grade is a verified business fact." },
                    { name: "isDefault", label: "Default variant", type: "checkbox" },
                    { name: "description", label: "Description", type: "textarea", wide: true },
                  ]}
                />
              ) : null}
            </div>
            {detail.variants.length === 0 ? (
              <EmptyState icon={Tags} title="No variants recorded" description="A product does not need variants. Add them only if the business distinguishes grades or pack sizes as separate items." />
            ) : (
              <TableWrapper>
                <Table className="min-w-[34rem]">
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Code</TH>
                      <TH>Name</TH>
                      <TH>Grade</TH>
                      <TH>Default</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {detail.variants.map((variant) => (
                      <TR key={variant.id}>
                        <TD className="font-mono text-[0.6875rem] text-ink-muted">{variant.code}</TD>
                        <TD className="text-xs font-medium">{variant.name}</TD>
                        <TD className="text-xs">{variant.grade ?? "—"}</TD>
                        <TD>{variant.is_default ? <Badge tone="info">Default</Badge> : "—"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </Card>
        ) : null}

        {tab === "packaging" ? (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Boxes className="size-4 text-ink-subtle" aria-hidden /> Packaging
                </h2>
                <p className="text-[0.6875rem] text-ink-subtle">
                  Net quantity and gross weight are stored as NUMERIC per configuration. No global bag weight is assumed.
                </p>
              </div>
              {canPackaging ? (
                <RecordFormDialog
                  title="Add packaging"
                  description="Record the actual net quantity and gross weight for this configuration."
                  triggerLabel="Add packaging"
                  action={saveProductPackagingAction}
                  hidden={{ productId: product.id }}
                  fields={[
                    { name: "packagingType", label: "Packaging type", required: true, placeholder: "e.g. bag, drum, carton" },
                    { name: "packagingMaterial", label: "Material" },
                    {
                      name: "packageUnitId",
                      label: "Package unit",
                      type: "select",
                      required: true,
                      options: detail.units.map((unit) => ({ value: unit.id, label: `${unit.name} (${unit.code})` })),
                    },
                    { name: "netQuantity", label: "Net quantity", step: "any" },
                    {
                      name: "quantityUnitId",
                      label: "Net quantity unit",
                      type: "select",
                      options: detail.units.map((unit) => ({ value: unit.id, label: `${unit.name} (${unit.code})` })),
                    },
                    { name: "grossWeight", label: "Gross weight", step: "any" },
                    { name: "isDefault", label: "Default packaging", type: "checkbox" },
                    { name: "description", label: "Description", type: "textarea", wide: true },
                  ]}
                />
              ) : null}
            </div>
            {detail.packaging.length === 0 ? (
              <EmptyState icon={Boxes} title="No packaging configurations" description="Add one only when the packaging is a known fact for this product." />
            ) : (
              <TableWrapper>
                <Table className="min-w-[38rem]">
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Type</TH>
                      <TH>Material</TH>
                      <TH>Net quantity</TH>
                      <TH>Gross weight</TH>
                      <TH>Default</TH>
                      {canPackaging ? <TH className="text-right">Actions</TH> : null}
                    </TR>
                  </THead>
                  <TBody>
                    {detail.packaging.map((pack) => (
                      <TR key={pack.id}>
                        <TD className="text-xs font-medium">{pack.packaging_type}</TD>
                        <TD className="text-xs text-ink-muted">{pack.packaging_material ?? "—"}</TD>
                        <TD className="text-xs">
                          {pack.net_quantity ? `${String(pack.net_quantity)} ${unitLabel(pack.quantity_unit_id)}` : "—"}
                        </TD>
                        <TD className="text-xs">{pack.gross_weight ? String(pack.gross_weight) : "—"}</TD>
                        <TD>{pack.is_default ? <Badge tone="info">Default</Badge> : "—"}</TD>
                        {canPackaging ? (
                          <TD className="text-right">
                            <ConfirmActionButton
                              action={removeProductPackagingAction}
                              label="Remove"
                              title="Remove this packaging configuration?"
                              description="Removing a configuration does not change any recorded quantity."
                              confirmLabel="Remove"
                              hidden={{ id: pack.id, productId: product.id }}
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
        ) : null}

        {tab === "attributes" ? (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Package className="size-4 text-ink-subtle" aria-hidden /> Attribute values
                </h2>
                <p className="text-[0.6875rem] text-ink-subtle">Attribute definitions are configuration; the values below are this product&rsquo;s own.</p>
              </div>
              {canSpecs && detail.attributeDefinitions.length > 0 ? (
                <RecordFormDialog
                  title="Set attribute value"
                  description="Saving the same attribute again updates it rather than creating a second row."
                  triggerLabel="Set value"
                  action={saveProductAttributeValueAction}
                  hidden={{ productId: product.id }}
                  fields={[
                    {
                      name: "attributeId",
                      label: "Attribute",
                      type: "select",
                      required: true,
                      options: detail.attributeDefinitions.map((definition) => ({
                        value: definition.id,
                        label: `${definition.name} (${definition.data_type})`,
                      })),
                    },
                    { name: "valueText", label: "Text value" },
                    { name: "valueNumber", label: "Numeric value", step: "any" },
                    { name: "valueDate", label: "Date value", type: "date" },
                  ]}
                />
              ) : null}
            </div>
            {detail.attributes.length === 0 ? (
              <EmptyState
                icon={Package}
                title="No attribute values"
                description={
                  detail.attributeDefinitions.length === 0
                    ? "No attribute definitions exist yet. Definitions are configuration and are added by an administrator."
                    : "No values recorded for this product."
                }
              />
            ) : (
              <TableWrapper>
                <Table className="min-w-[30rem]">
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Attribute</TH>
                      <TH>Type</TH>
                      <TH>Value</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {detail.attributes.map((attribute) => (
                      <TR key={attribute.id}>
                        <TD className="text-xs font-medium">{attribute.definition?.name ?? "—"}</TD>
                        <TD className="text-xs text-ink-muted">{labelFor(attribute.definition?.data_type ?? "")}</TD>
                        <TD className="text-xs">
                          {attribute.value_text ??
                            (attribute.value_number !== null && attribute.value_number !== undefined
                              ? String(attribute.value_number)
                              : attribute.value_date ?? (attribute.value_boolean === null ? "—" : attribute.value_boolean ? "Yes" : "No"))}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </Card>
        ) : null}

        {tab === "conversions" ? (
          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">Product-specific conversion rules</h2>
              <p className="text-[0.6875rem] text-ink-subtle">
                Rules scoped to this product. Standard category conversions live under Units &amp; conversions. Ambiguous paths are rejected rather than guessed.
              </p>
            </div>
            {conversions.length === 0 ? (
              <EmptyState title="No product-specific conversions" description="Standard conversions, if any, apply to this product. Add a product-specific rule only where the factor genuinely differs." />
            ) : (
              <TableWrapper>
                <Table className="min-w-[36rem]">
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>From</TH>
                      <TH>To</TH>
                      <TH>Factor</TH>
                      <TH>Method</TH>
                      <TH>Effective from</TH>
                      <TH>Effective until</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {conversions.map((conversion) => (
                      <TR key={conversion.id}>
                        <TD className="text-xs">{conversion.from_unit?.code ?? "—"}</TD>
                        <TD className="text-xs">{conversion.to_unit?.code ?? "—"}</TD>
                        <TD className="font-mono text-xs">{String(conversion.conversion_factor)}</TD>
                        <TD className="text-xs">{labelFor(conversion.conversion_method)}</TD>
                        <TD className="text-xs">{conversion.effective_from}</TD>
                        <TD className="text-xs">{conversion.effective_until ?? "Open"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </Card>
        ) : null}

        {tab === "history" ? (
          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <History className="size-4 text-ink-subtle" aria-hidden /> Change history
              </h2>
            </div>
            {detail.histories.length === 0 ? (
              <EmptyState title="No changes recorded" description="This product has not been modified since it was created." />
            ) : (
              <ul className="divide-y divide-border">
                {detail.histories.map((entry) => (
                  <li key={entry.id} className="px-4 py-2.5">
                    <p className="text-xs font-medium text-ink">
                      {labelFor(entry.change_type)}
                      {entry.changed_fields.length > 0 ? <span className="font-normal text-ink-muted"> · {entry.changed_fields.join(", ")}</span> : null}
                    </p>
                    <p className="text-[0.6875rem] text-ink-subtle">
                      {new Date(entry.created_at).toLocaleString("en-GB")} · {entry.actor?.display_name ?? "System"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
