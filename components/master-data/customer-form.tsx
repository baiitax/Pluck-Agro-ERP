"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useServerForm } from "@/components/forms/use-server-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { createCustomerAction, updateCustomerAction } from "@/app/(dashboard)/master-data/actions";
import type { Option } from "@/services/master-data/reference-data";

export type CustomerFormValues = {
  id: string;
  legalName: string;
  tradingName: string | null;
  customerType: string;
  primaryCategoryId: string | null;
  registrationNumber: string | null;
  taxIdentificationNumber: string | null;
  registrationCountry: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  preferredCurrencyCode: string | null;
  notes: string | null;
};

export function CustomerForm({
  categories,
  currencies,
  customerTypes,
  reference,
  customer,
}: {
  categories: Option[];
  currencies: Option[];
  customerTypes: { value: string; label: string }[];
  reference: string;
  customer?: CustomerFormValues;
}) {
  const router = useRouter();
  const action = customer ? updateCustomerAction : createCustomerAction;
  const { state, isPending, run } = useServerForm(action, (result) => {
    if (result.ok) {
      toast.success(customer ? "Customer updated." : "Customer created as a lead.");
      router.push(`/master-data/customers/${result.data.id}`);
    } else {
      toast.error(result.error.message);
    }
  });
  const errors = state && !state.ok ? (state.error.details ?? {}) : {};

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        run(new FormData(event.currentTarget));
      }}
      className="space-y-4"
    >
      {customer ? <input type="hidden" name="id" value={customer.id} /> : null}

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Identity</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="reference">Reference</Label>
            <Input id="reference" value={reference} readOnly disabled className="font-mono" />
            <FieldHint>Assigned by the database using the configured prefix and numbering policy.</FieldHint>
          </div>
          <div>
            <Label htmlFor="legalName">Legal name<span className="text-danger-600"> *</span></Label>
            <Input id="legalName" name="legalName" defaultValue={customer?.legalName ?? ""} />
            <FieldError message={errors.legalName?.[0]} />
          </div>
          <div>
            <Label htmlFor="tradingName">Trading name</Label>
            <Input id="tradingName" name="tradingName" defaultValue={customer?.tradingName ?? ""} />
            <FieldError message={errors.tradingName?.[0]} />
          </div>
          <div>
            <Label htmlFor="customerType">Customer type</Label>
            <Select id="customerType" name="customerType" defaultValue={customer?.customerType ?? "direct_buyer"}>
              {customerTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
            <FieldError message={errors.customerType?.[0]} />
          </div>
          <div>
            <Label htmlFor="primaryCategoryId">Primary category</Label>
            <Select id="primaryCategoryId" name="primaryCategoryId" defaultValue={customer?.primaryCategoryId ?? ""}>
              <option value="">—</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </Select>
            <FieldHint>For reporting. A customer may also hold further categories; it is not limited to one market.</FieldHint>
            <FieldError message={errors.primaryCategoryId?.[0]} />
          </div>
          <div>
            <Label htmlFor="registrationCountry">Country of registration</Label>
            <Input
              id="registrationCountry"
              name="registrationCountry"
              maxLength={2}
              placeholder="ISO 3166-1 alpha-2"
              defaultValue={customer?.registrationCountry ?? ""}
            />
            <FieldError message={errors.registrationCountry?.[0]} />
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Registration &amp; tax</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="registrationNumber">Registration number</Label>
            <Input id="registrationNumber" name="registrationNumber" defaultValue={customer?.registrationNumber ?? ""} />
            <FieldError message={errors.registrationNumber?.[0]} />
          </div>
          <div>
            <Label htmlFor="taxIdentificationNumber">Tax identification number</Label>
            <Input
              id="taxIdentificationNumber"
              name="taxIdentificationNumber"
              defaultValue={customer?.taxIdentificationNumber ?? ""}
            />
            <FieldError message={errors.taxIdentificationNumber?.[0]} />
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Primary contact</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="contactName">Contact name</Label>
            <Input id="contactName" name="contactName" defaultValue={customer?.contactName ?? ""} />
            <FieldError message={errors.contactName?.[0]} />
          </div>
          <div>
            <Label htmlFor="contactEmail">Email</Label>
            <Input id="contactEmail" name="contactEmail" type="email" defaultValue={customer?.contactEmail ?? ""} />
            <FieldError message={errors.contactEmail?.[0]} />
          </div>
          <div>
            <Label htmlFor="contactPhone">Phone</Label>
            <Input id="contactPhone" name="contactPhone" defaultValue={customer?.contactPhone ?? ""} />
            <FieldError message={errors.contactPhone?.[0]} />
          </div>
          <div>
            <Label htmlFor="preferredCurrencyCode">Preferred currency</Label>
            <Select
              id="preferredCurrencyCode"
              name="preferredCurrencyCode"
              defaultValue={customer?.preferredCurrencyCode ?? ""}
            >
              <option value="">—</option>
              {currencies.map((currency) => (
                <option key={currency.id} value={currency.code}>
                  {currency.label}
                </option>
              ))}
            </Select>
            <FieldError message={errors.preferredCurrencyCode?.[0]} />
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Notes</h2>
        <Textarea id="notes" name="notes" rows={3} defaultValue={customer?.notes ?? ""} />
        <FieldError message={errors.notes?.[0]} />
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : customer ? "Save changes" : "Create customer"}
        </Button>
      </div>
    </form>
  );
}
