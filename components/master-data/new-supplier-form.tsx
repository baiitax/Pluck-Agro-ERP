"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useServerForm } from "@/components/forms/use-server-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { createSupplierAction, updateSupplierAction } from "@/app/(dashboard)/master-data/actions";
import type { Option } from "@/services/master-data/reference-data";

export type SupplierFormValues = {
  id: string;
  legalName: string;
  tradingName: string | null;
  supplierType: string;
  primaryCategoryId: string | null;
  registrationCountry: string | null;
  registrationNumber: string | null;
  taxIdentificationNumber: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  preferredCurrencyCode: string | null;
  notes: string | null;
};

export function SupplierForm({
  categories,
  currencies,
  supplierTypes,
  reference,
  supplier,
}: {
  categories: Option[];
  currencies: Option[];
  supplierTypes: { value: string; label: string }[];
  reference: string;
  supplier?: SupplierFormValues;
}) {
  const router = useRouter();
  const action = supplier ? updateSupplierAction : createSupplierAction;
  const { state, isPending, run } = useServerForm(action, (result) => {
    if (result.ok) {
      toast.success(supplier ? "Supplier updated." : "Supplier created as a draft.");
      router.push(`/master-data/suppliers/${result.data.id}`);
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
      {supplier ? <input type="hidden" name="id" value={supplier.id} /> : null}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Identity</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="reference">Reference</Label>
            <Input id="reference" value={reference} readOnly disabled className="font-mono" />
            <FieldHint>Assigned by the database on save, using the configured prefix and numbering policy.</FieldHint>
          </div>
          <div>
            <Label htmlFor="legalName">Legal name<span className="text-danger-600"> *</span></Label>
            <Input id="legalName" name="legalName" placeholder="Registered company name" defaultValue={supplier?.legalName ?? ""} />
            <FieldError message={errors.legalName?.[0]} />
          </div>
          <div>
            <Label htmlFor="tradingName">Trading name</Label>
            <Input id="tradingName" name="tradingName" placeholder="If different from the legal name" defaultValue={supplier?.tradingName ?? ""} />
            <FieldError message={errors.tradingName?.[0]} />
          </div>
          <div>
            <Label htmlFor="supplierType">Supplier type</Label>
            <Select id="supplierType" name="supplierType" defaultValue={supplier?.supplierType ?? "company"}>
              {supplierTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
            <FieldError message={errors.supplierType?.[0]} />
          </div>
          <div>
            <Label htmlFor="primaryCategoryId">Primary category</Label>
            <Select id="primaryCategoryId" name="primaryCategoryId" defaultValue={supplier?.primaryCategoryId ?? ""}>
              <option value="">—</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </Select>
            <FieldHint>Used for reporting only. It does not restrict what the supplier may be approved to supply.</FieldHint>
            <FieldError message={errors.primaryCategoryId?.[0]} />
          </div>
          <div>
            <Label htmlFor="registrationCountry">Country of registration</Label>
            <Input id="registrationCountry" name="registrationCountry" placeholder="ISO 3166-1 alpha-2, e.g. NG" maxLength={2} defaultValue={supplier?.registrationCountry ?? ""} />
            <FieldError message={errors.registrationCountry?.[0]} />
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Registration &amp; tax identifiers</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="registrationNumber">Business registration number</Label>
            <Input id="registrationNumber" name="registrationNumber" defaultValue={supplier?.registrationNumber ?? ""} />
            <FieldError message={errors.registrationNumber?.[0]} />
          </div>
          <div>
            <Label htmlFor="taxIdentificationNumber">Tax identification number</Label>
            <Input id="taxIdentificationNumber" name="taxIdentificationNumber" defaultValue={supplier?.taxIdentificationNumber ?? ""} />
            <FieldHint>Recorded as supplied. No tax rate is derived or calculated from it.</FieldHint>
            <FieldError message={errors.taxIdentificationNumber?.[0]} />
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Contact details</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="contactPerson">Contact person</Label>
            <Input id="contactPerson" name="contactPerson" defaultValue={supplier?.contactPerson ?? ""} />
            <FieldError message={errors.contactPerson?.[0]} />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" defaultValue={supplier?.phone ?? ""} />
            <FieldError message={errors.phone?.[0]} />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={supplier?.email ?? ""} />
            <FieldError message={errors.email?.[0]} />
          </div>
          <div>
            <Label htmlFor="website">Website</Label>
            <Input id="website" name="website" placeholder="https://" defaultValue={supplier?.website ?? ""} />
            <FieldError message={errors.website?.[0]} />
          </div>
          <div>
            <Label htmlFor="preferredCurrencyCode">Preferred currency</Label>
            <Select id="preferredCurrencyCode" name="preferredCurrencyCode" defaultValue={supplier?.preferredCurrencyCode ?? ""}>
              <option value="">—</option>
              {currencies.map((currency) => (
                <option key={currency.id} value={currency.code}>
                  {currency.label}
                </option>
              ))}
            </Select>
            <FieldHint>Only a reference. No exchange rate is applied here.</FieldHint>
            <FieldError message={errors.preferredCurrencyCode?.[0]} />
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Notes</h2>
        <Textarea id="notes" name="notes" rows={3} defaultValue={supplier?.notes ?? ""} placeholder="Anything a reviewer should know. Avoid putting bank details here." />
        <FieldError message={errors.notes?.[0]} />
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : supplier ? "Save changes" : "Create draft supplier"}
        </Button>
      </div>
    </form>
  );
}
