import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/procurement/action-form";
import { LineItemsEditor } from "@/components/procurement/line-items-editor";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { requireActiveProfile } from "@/services/authorization";
import { getConvertibleSelections, getPurchaseOrderFormOptions } from "@/services/procurement/purchase-orders";
import { createPurchaseOrderAction } from "../../actions";

export const metadata: Metadata = { title: "New purchase order" };
export const dynamic = "force-dynamic";

const today = () => new Date().toISOString().slice(0, 10);

const money = (currency: string, value: number) =>
  `${currency} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.purchase_order.create")) {
    return <PermissionGuard permission="procurement.purchase_order.create" />;
  }

  const params = await searchParams;
  const selectionId = typeof params.selection === "string" ? params.selection : undefined;

  const [options, selections] = await Promise.all([
    getPurchaseOrderFormOptions(selectionId),
    getConvertibleSelections(),
  ]);

  const selection = options.selection;
  const quotation = selection?.quotation ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="New purchase order"
        description="An order records what was agreed with the supplier. Prices, units, supplier name and terms are snapshotted onto the document so a later correction to master data cannot restate what was sent."
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Purchase orders", href: "/procurement/purchase-orders" },
          { label: "New" },
        ]}
      />

      {selection && quotation ? (
        <Alert tone="success" title="Starting from a recorded selection">
          Supplier, currency and lines are prefilled from {quotation.reference}. The selection&apos;s justification stays
          attached to the order, so the reason for the choice is never separated from the commitment.
        </Alert>
      ) : selections.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Start from a selection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-ink-muted">
              These supplier selections have not produced an order yet. Starting from one keeps the sourcing decision and
              the commitment joined together.
            </p>
            <ul className="space-y-1.5">
              {selections.slice(0, 6).map((entry) => {
                const row = entry as unknown as {
                  id: string;
                  quotation: { reference: string; total_amount: number; currency_code: string } | null;
                  supplier: { legal_name: string } | null;
                };
                return (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                    <span className="text-xs text-ink">
                      {row.quotation?.reference ?? "Selection"} · {row.supplier?.legal_name ?? "—"} ·{" "}
                      {row.quotation ? money(row.quotation.currency_code, row.quotation.total_amount) : "—"}
                    </span>
                    <Link
                      href={`/procurement/purchase-orders/new?selection=${row.id}`}
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      Use this selection
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <ActionForm
        action={createPurchaseOrderAction}
        submitLabel="Save draft order"
        successMessage="Purchase order created as a draft."
        redirectTo="/procurement/purchase-orders"
      >
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Order header</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input type="hidden" name="orderDate" value={today()} />
              <input type="hidden" name="selectionId" value={selection?.id ?? ""} />
              <input type="hidden" name="selectedQuotationId" value={quotation?.id ?? ""} />
              <div className="space-y-1 lg:col-span-2">
                <Label htmlFor="supplierId">Supplier</Label>
                <Select id="supplierId" name="supplierId" required defaultValue={selection?.selected_supplier_id ?? ""}>
                  <option value="">Select a supplier…</option>
                  {options.suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.legal_name}
                      {supplier.verification_status === "verified" ? "" : " (not verified — needs an approved exception)"}
                    </option>
                  ))}
                </Select>
                <FieldHint>
                  Only an active, verified supplier can be ordered from. An unverified supplier needs a recorded
                  procurement exception, which is not something this form can create.
                </FieldHint>
              </div>
              <div className="space-y-1">
                <Label htmlFor="currencyCode">Currency</Label>
                <Input id="currencyCode" name="currencyCode" defaultValue={quotation?.currency_code ?? "NGN"} maxLength={3} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="expectedDeliveryDate">Expected delivery</Label>
                <Input id="expectedDeliveryDate" name="expectedDeliveryDate" type="date" defaultValue={today()} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="paymentTermsId">Payment terms</Label>
                <Select id="paymentTermsId" name="paymentTermsId" defaultValue={quotation?.payment_terms_id ?? ""}>
                  <option value="">Not stated</option>
                  {options.paymentTerms.map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="deliveryTermsId">Delivery terms</Label>
                <Select id="deliveryTermsId" name="deliveryTermsId" defaultValue={quotation?.delivery_terms_id ?? ""}>
                  <option value="">Not stated</option>
                  {options.deliveryTerms.map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="deliveryWarehouseId">Deliver to warehouse</Label>
                <Select id="deliveryWarehouseId" name="deliveryWarehouseId" defaultValue="">
                  <option value="">Decide later</option>
                  {options.warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="deliveryLocationId">Storage location</Label>
                <Select id="deliveryLocationId" name="deliveryLocationId" defaultValue="">
                  <option value="">Not specified</option>
                  {options.locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="departmentId">Department</Label>
                <Select id="departmentId" name="departmentId" defaultValue="">
                  <option value="">Not attributed</option>
                  {options.departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="procurementOfficerEmployeeId">Procurement officer</Label>
                <Select id="procurementOfficerEmployeeId" name="procurementOfficerEmployeeId" defaultValue="">
                  <option value="">Not assigned</option>
                  {options.employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.first_name} {employee.last_name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="exchangeRate">Exchange rate (if not base currency)</Label>
                <Input id="exchangeRate" name="exchangeRate" inputMode="decimal" placeholder="Leave blank for base currency" />
                <FieldHint>
                  Applied at the order date. Updating today&apos;s rate later never rewrites this order&apos;s basis.
                </FieldHint>
              </div>
              <div className="space-y-1 lg:col-span-3">
                <Label htmlFor="deliveryAddress">Delivery address</Label>
                <Input id="deliveryAddress" name="deliveryAddress" maxLength={500} />
              </div>
              <div className="space-y-1 lg:col-span-3">
                <Label htmlFor="supplierInstructions">Instructions to the supplier</Label>
                <Textarea id="supplierInstructions" name="supplierInstructions" rows={2} />
              </div>
              <div className="space-y-1 lg:col-span-3">
                <Label htmlFor="internalRemarks">Internal remarks</Label>
                <Textarea id="internalRemarks" name="internalRemarks" rows={2} />
                <FieldHint>Internal remarks are not shown on the supplier&apos;s copy in any future print output.</FieldHint>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Order lines</CardTitle>
            </CardHeader>
            <CardContent>
              {options.products.length === 0 ? (
                <Alert tone="warning" title="No products available">
                  Products come from master data. Add and activate one before raising an order.
                </Alert>
              ) : (
                <LineItemsEditor
                  mode="purchase_order"
                  products={options.products}
                  units={options.units}
                  currencyCode={quotation?.currency_code ?? "NGN"}
                  initial={quotation?.items.map((item) => ({
                    productId: item.product_id,
                    quantity: String(item.quantity),
                    unitId: item.unit_id,
                    unitPrice: String(item.unit_price),
                  }))}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </ActionForm>
    </div>
  );
}
