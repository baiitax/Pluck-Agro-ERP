import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/procurement/action-form";
import { LineItemsEditor } from "@/components/procurement/line-items-editor";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { REQUISITION_EDITABLE_STATUSES, isEditable } from "@/lib/procurement/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { getRequisitionDetail, getRequisitionFormOptions } from "@/services/procurement/requisitions";
import { updateRequisitionAction } from "../../../actions";

export const metadata: Metadata = { title: "Edit requisition" };
export const dynamic = "force-dynamic";

/**
 * Editing a requisition is only possible while it is a working copy.
 *
 * The page refuses to render the form for any other status rather than posting a change that the
 * database would reject — but the database is still the control, and the service checks again.
 */
export default async function EditRequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.requisition.update")) {
    return <PermissionGuard permission="procurement.requisition.update" />;
  }

  const { id } = await params;
  const [detail, options] = await Promise.all([getRequisitionDetail(id), getRequisitionFormOptions()]).catch(() => [null, null]);
  if (!detail || !options) notFound();

  const { requisition, items } = detail;
  const editable = isEditable(requisition.status, REQUISITION_EDITABLE_STATUSES);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Edit ${requisition.reference}`}
        description={requisition.purpose}
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Requisitions", href: "/procurement/requisitions" },
          { label: requisition.reference, href: `/procurement/requisitions/${requisition.id}` },
          { label: "Edit" },
        ]}
      />

      {!editable ? (
        <Alert tone="warning" title="This requisition is no longer a working copy">
          It is {requisition.status.replace(/_/g, " ")}. A submitted request is a record of what was asked for, so it
          cannot be rewritten: raise a new requisition instead.
        </Alert>
      ) : (
        <ActionForm
          action={updateRequisitionAction}
          submitLabel="Save changes"
          successMessage="Requisition updated."
          redirectTo={`/procurement/requisitions/${requisition.id}`}
          hidden={{ id: requisition.id }}
        >
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Request</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="departmentId" value={requisition.department_id} />
                <input type="hidden" name="requestingEmployeeId" value={requisition.requesting_employee_id} />
                <input type="hidden" name="requisitionDate" value={requisition.requisition_date} />
                <div className="space-y-1">
                  <Label htmlFor="requiredDeliveryDate">Required by</Label>
                  <Input
                    id="requiredDeliveryDate"
                    name="requiredDeliveryDate"
                    type="date"
                    defaultValue={requisition.required_delivery_date}
                    required
                  />
                  <FieldHint>The department and requester are fixed after the request is raised.</FieldHint>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="priority">Priority</Label>
                  <Select id="priority" name="priority" defaultValue={requisition.priority}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </Select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="purpose">Purpose</Label>
                  <Input id="purpose" name="purpose" defaultValue={requisition.purpose} required maxLength={500} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="justification">Justification</Label>
                  <Textarea id="justification" name="justification" rows={3} defaultValue={requisition.justification ?? ""} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="currencyCode">Currency</Label>
                  <Input id="currencyCode" name="currencyCode" defaultValue={requisition.currency_code} maxLength={3} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="preferredSupplierId">Preferred supplier</Label>
                  <Select id="preferredSupplierId" name="preferredSupplierId" defaultValue={requisition.preferred_supplier_id ?? ""}>
                    <option value="">No preference</option>
                    {options.suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.legal_name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="suggestedWarehouseId">Deliver to</Label>
                  <Select id="suggestedWarehouseId" name="suggestedWarehouseId" defaultValue={requisition.suggested_warehouse_id ?? ""}>
                    <option value="">Decide later</option>
                    {options.warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" name="notes" rows={2} defaultValue={requisition.notes ?? ""} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Lines</CardTitle>
              </CardHeader>
              <CardContent>
                <LineItemsEditor
                  mode="requisition"
                  products={options.products}
                  units={options.units}
                  currencyCode={requisition.currency_code}
                  initial={items.map((item) => ({
                    productId: item.product_id,
                    quantity: String(item.quantity),
                    unitId: item.unit_id,
                    unitPrice: item.estimated_unit_price === null ? "" : String(item.estimated_unit_price),
                    specificationNotes: item.specification_notes ?? "",
                  }))}
                />
              </CardContent>
            </Card>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
