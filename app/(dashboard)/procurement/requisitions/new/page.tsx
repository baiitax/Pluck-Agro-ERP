import type { Metadata } from "next";

import { ActionForm } from "@/components/procurement/action-form";
import { LineItemsEditor } from "@/components/procurement/line-items-editor";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { requireActiveProfile } from "@/services/authorization";
import { getRequisitionFormOptions } from "@/services/procurement/requisitions";
import { createRequisitionAction } from "../../actions";

export const metadata: Metadata = { title: "New requisition" };
export const dynamic = "force-dynamic";

const today = () => new Date().toISOString().slice(0, 10);

export default async function NewRequisitionPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.requisition.create")) {
    return <PermissionGuard permission="procurement.requisition.create" />;
  }

  const options = await getRequisitionFormOptions();
  const employee = principal.employee;

  return (
    <div className="space-y-4">
      <PageHeader
        title="New purchase requisition"
        description="State what is needed and why. The estimated value is the requester's view of the likely cost; it is not a price and it does not commit anything."
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Requisitions", href: "/procurement/requisitions" },
          { label: "New" },
        ]}
      />

      <Alert tone="info" title="What happens next">
        Saving creates a draft. Submitting it sends it for review, and an approver with configured authority
        decides. If no approval authority covers the estimated value, the request cannot be approved by anyone
        until an administrator configures it — the system has no built-in limit.
      </Alert>

      <ActionForm
        action={createRequisitionAction}
        submitLabel="Save draft"
        successMessage="Requisition created as a draft."
        redirectTo="/procurement/requisitions"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Request</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="requisitionDate" value={today()} />
              <div className="space-y-1">
                <Label htmlFor="departmentId">Department</Label>
                <Select id="departmentId" name="departmentId" required defaultValue={employee?.department_id ?? ""}>
                  <option value="">Select a department…</option>
                  {options.departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="requestingEmployeeId">Requested by</Label>
                <Select
                  id="requestingEmployeeId"
                  name="requestingEmployeeId"
                  required
                  defaultValue={employee?.id ?? ""}
                >
                  <option value="">Select the requester…</option>
                  {options.employees.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.first_name} {person.last_name} ({person.employee_number})
                    </option>
                  ))}
                </Select>
                <FieldHint>The person accountable for the request, not necessarily the person typing it.</FieldHint>
              </div>
              <div className="space-y-1">
                <Label htmlFor="requiredDeliveryDate">Required by</Label>
                <Input id="requiredDeliveryDate" name="requiredDeliveryDate" type="date" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="priority">Priority</Label>
                <Select id="priority" name="priority" defaultValue="normal">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </Select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="purpose">Purpose</Label>
                <Input id="purpose" name="purpose" required maxLength={500} placeholder="Maize for Q1 milling run" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="justification">Justification</Label>
                <Textarea
                  id="justification"
                  name="justification"
                  rows={3}
                  placeholder="Why this is needed now, and what happens if it is not bought."
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="currencyCode">Currency</Label>
                <Input id="currencyCode" name="currencyCode" defaultValue="NGN" maxLength={3} required />
                <FieldHint>Three-letter code. No symbol is assumed anywhere in the calculation.</FieldHint>
              </div>
              <div className="space-y-1">
                <Label htmlFor="preferredSupplierId">Preferred supplier</Label>
                <Select id="preferredSupplierId" name="preferredSupplierId" defaultValue="">
                  <option value="">No preference</option>
                  {options.suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.legal_name}
                    </option>
                  ))}
                </Select>
                <FieldHint>A preference, not an award: quotations are still recorded and compared.</FieldHint>
              </div>
              <div className="space-y-1">
                <Label htmlFor="suggestedWarehouseId">Deliver to</Label>
                <Select id="suggestedWarehouseId" name="suggestedWarehouseId" defaultValue="">
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
                <Textarea id="notes" name="notes" rows={2} />
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Lines</CardTitle>
            </CardHeader>
            <CardContent>
              {options.products.length === 0 ? (
                <Alert tone="warning" title="No products are available to request">
                  Products come from master data. Add and activate a product first, then return to this page.
                </Alert>
              ) : (
                <LineItemsEditor
                  mode="requisition"
                  products={options.products}
                  units={options.units}
                  currencyCode="NGN"
                />
              )}
            </CardContent>
          </Card>
        </div>
      </ActionForm>
    </div>
  );
}
