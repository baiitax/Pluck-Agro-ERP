import type { Metadata } from "next";

import { ActionForm } from "@/components/procurement/action-form";
import { LineItemsEditor } from "@/components/procurement/line-items-editor";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { requireActiveProfile } from "@/services/authorization";
import { getQuotationFormOptions } from "@/services/procurement/quotations";
import { createQuotationAction } from "../../actions";

export const metadata: Metadata = { title: "Record a quotation" };
export const dynamic = "force-dynamic";

const today = () => new Date().toISOString().slice(0, 10);

export default async function NewQuotationPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.quotation.create")) {
    return <PermissionGuard permission="procurement.quotation.create" />;
  }

  const options = await getQuotationFormOptions();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Record a supplier quotation"
        description="Enter the offer exactly as the supplier stated it. Delivery charges and lead time are part of the offer, so record them — a comparison that ignores them is not a comparison."
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Quotations", href: "/procurement/quotations" },
          { label: "New" },
        ]}
      />

      <Alert tone="info" title="Recording is not selecting">
        Nothing here marks a supplier as chosen. Selection happens in the comparison workspace, where the reason has to
        be written down and the lowest price is shown for what it is: information, not an automatic award.
      </Alert>

      <ActionForm
        action={createQuotationAction}
        submitLabel="Record quotation"
        successMessage="Quotation recorded."
        redirectTo="/procurement/quotations"
      >
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Offer</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input type="hidden" name="quotationDate" value={today()} />
              <div className="space-y-1 lg:col-span-2">
                <Label htmlFor="supplierId">Supplier</Label>
                <Select id="supplierId" name="supplierId" required defaultValue="">
                  <option value="">Select a supplier…</option>
                  {options.suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.legal_name}
                      {supplier.verification_status === "verified" ? "" : " (not verified)"}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="supplierQuotationReference">Supplier&apos;s reference</Label>
                <Input id="supplierQuotationReference" name="supplierQuotationReference" maxLength={120} placeholder="QT-2026-118" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="requisitionId">Against requisition</Label>
                <Select id="requisitionId" name="requisitionId" defaultValue="">
                  <option value="">Not linked to a requisition</option>
                  {options.requisitions.map((requisition) => (
                    <option key={requisition.id} value={requisition.id}>
                      {requisition.reference}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="validUntil">Valid until</Label>
                <Input id="validUntil" name="validUntil" type="date" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="currencyCode">Currency</Label>
                <Input id="currencyCode" name="currencyCode" defaultValue="NGN" maxLength={3} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="paymentTermsId">Payment terms</Label>
                <Select id="paymentTermsId" name="paymentTermsId" defaultValue="">
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
                <Select id="deliveryTermsId" name="deliveryTermsId" defaultValue="">
                  <option value="">Not stated</option>
                  {options.deliveryTerms.map((term) => (
                    <option key={term.id} value={term.id}>
                      {term.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="deliveryLeadTimeDays">Lead time (days)</Label>
                <Input id="deliveryLeadTimeDays" name="deliveryLeadTimeDays" inputMode="numeric" placeholder="7" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="proposedDeliveryDate">Proposed delivery</Label>
                <Input id="proposedDeliveryDate" name="proposedDeliveryDate" type="date" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="deliveryCharges">Delivery charges</Label>
                <Input id="deliveryCharges" name="deliveryCharges" inputMode="decimal" placeholder="0.00" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="otherCharges">Other charges</Label>
                <Input id="otherCharges" name="otherCharges" inputMode="decimal" placeholder="0.00" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="discountAmount">Document discount</Label>
                <Input id="discountAmount" name="discountAmount" inputMode="decimal" placeholder="0.00" />
              </div>
              <div className="space-y-1 lg:col-span-3">
                <Label htmlFor="chargeNotes">Charge notes</Label>
                <Input id="chargeNotes" name="chargeNotes" maxLength={500} placeholder="What the other charges are for." />
                <FieldHint>Disclose charges here rather than folding them into the unit price.</FieldHint>
              </div>
              <div className="space-y-1 lg:col-span-3">
                <Label htmlFor="remarks">Remarks</Label>
                <Textarea id="remarks" name="remarks" rows={2} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quoted lines</CardTitle>
            </CardHeader>
            <CardContent>
              {options.products.length === 0 ? (
                <Alert tone="warning" title="No products available">
                  Products come from master data. Add and activate a product before recording a quotation.
                </Alert>
              ) : (
                <LineItemsEditor mode="quotation" products={options.products} units={options.units} currencyCode="NGN" />
              )}
            </CardContent>
          </Card>
        </div>
      </ActionForm>
    </div>
  );
}
