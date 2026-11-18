import type { Metadata } from "next";

import { ActionForm } from "@/components/procurement/action-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { requireActiveProfile } from "@/services/authorization";
import { getAdvanceFormOptions } from "@/services/procurement/supplier-accounts";
import { createAdvanceAction } from "../../actions";

export const metadata: Metadata = { title: "Record a supplier advance" };
export const dynamic = "force-dynamic";

const today = () => new Date().toISOString().slice(0, 10);

export default async function NewSupplierAdvancePage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.supplier_advance.create")) {
    return <PermissionGuard permission="procurement.supplier_advance.create" />;
  }

  const options = await getAdvanceFormOptions();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Record a supplier advance"
        description="An advance records money committed to a supplier before the goods or invoice. Recording it does not pay it: the payment is confirmed separately by finance, and only then does the balance become applicable."
        breadcrumbs={[
          { label: "Procurement", href: "/procurement" },
          { label: "Supplier advances", href: "/procurement/supplier-advances" },
          { label: "Record" },
        ]}
      />

      <Alert tone="info" title={`Next reference: ${options.nextReference}`}>
        The reference is issued by the database when the advance is saved, so two people recording at once cannot end up
        with the same number.
      </Alert>

      <ActionForm
        action={createAdvanceAction}
        submitLabel="Save advance"
        successMessage="Advance recorded as a draft."
        redirectTo="/procurement/supplier-advances"
      >
        <input type="hidden" name="transactionDate" value={today()} />

        <Card>
          <CardHeader>
            <CardTitle>Advance</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1 lg:col-span-2">
              <Label htmlFor="supplierId">Supplier</Label>
              <Select id="supplierId" name="supplierId" required defaultValue="">
                <option value="">Select the supplier…</option>
                {options.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.legal_name} · {supplier.reference}
                  </option>
                ))}
              </Select>
              <FieldHint>Only active suppliers are listed. The advance is recorded against the supplier, not a name.</FieldHint>
            </div>
            <div className="space-y-1">
              <Label htmlFor="currencyCode">Currency</Label>
              <Input id="currencyCode" name="currencyCode" required maxLength={3} defaultValue="NGN" className="uppercase" />
              <FieldHint>Three-letter code. It must match the currency actually paid.</FieldHint>
            </div>
            <div className="space-y-1">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" name="amount" required inputMode="decimal" placeholder="0.00" />
              <FieldHint>Two decimal places. The outstanding balance starts equal to this and is reduced only by confirmed applications.</FieldHint>
            </div>
            <div className="space-y-1">
              <Label htmlFor="paymentMethod">Payment method</Label>
              <Select id="paymentMethod" name="paymentMethod" defaultValue="bank_transfer">
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="mobile_money">Mobile money</option>
                <option value="offset">Offset against a payable</option>
                <option value="other">Other</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="advanceReference">External reference</Label>
              <Input id="advanceReference" name="advanceReference" placeholder="The supplier's or bank's own reference" />
              <FieldHint>Optional. This is the other party&apos;s number, not ours.</FieldHint>
            </div>
            <div className="space-y-1 lg:col-span-2">
              <Label htmlFor="purchaseOrderId">Against a purchase order</Label>
              <Select id="purchaseOrderId" name="purchaseOrderId" defaultValue="">
                <option value="">Not tied to an order</option>
                {options.purchaseOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.reference} · {order.currency_code}
                  </option>
                ))}
              </Select>
              <FieldHint>
                Tying the advance to an order keeps the cash and the commitment together. It does not reduce the order&apos;s
                value.
              </FieldHint>
            </div>
            <div className="space-y-1 lg:col-span-3">
              <Label htmlFor="purpose">Purpose</Label>
              <Textarea id="purpose" name="purpose" rows={2} placeholder="Why the advance is being paid, so an approver can judge it." />
            </div>
          </CardContent>
        </Card>
      </ActionForm>
    </div>
  );
}
