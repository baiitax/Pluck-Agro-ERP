"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useServerForm } from "@/components/forms/use-server-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { createProductAction, updateProductAction } from "@/app/(dashboard)/master-data/actions";
import type { Option } from "@/services/master-data/reference-data";

export type ProductFormValues = {
  id: string;
  code: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  categoryId: string;
  productType: string;
  brand: string | null;
  internalReference: string | null;
  barcode: string | null;
  baseUnitId: string;
  purchaseUnitId: string | null;
  storageUnitId: string | null;
  salesUnitId: string | null;
  productionUnitId: string | null;
  origin: string | null;
  processingMethod: string | null;
  notes: string | null;
};

export function ProductForm({
  categories,
  units,
  productTypes,
  reference,
  product,
  baseUnitLocked,
}: {
  categories: Option[];
  units: Option[];
  productTypes: { value: string; label: string }[];
  reference: string;
  product?: ProductFormValues;
  baseUnitLocked: boolean;
}) {
  const router = useRouter();
  const action = product ? updateProductAction : createProductAction;
  const { state, isPending, run } = useServerForm(action, (result) => {
    if (result.ok) {
      toast.success(product ? "Product updated." : "Product created as a draft.");
      router.push(`/master-data/products/${result.data.id}`);
    } else {
      toast.error(result.error.message);
    }
  });
  const errors = state && !state.ok ? (state.error.details ?? {}) : {};

  const unitSelect = (name: string, label: string, defaultValue: string | null) => (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Select id={name} name={name} defaultValue={defaultValue ?? ""} disabled={baseUnitLocked && name === "baseUnitId"}>
        <option value="">—</option>
        {units.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.label}
          </option>
        ))}
      </Select>
      <FieldError message={errors[name]?.[0]} />
    </div>
  );

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        run(new FormData(event.currentTarget));
      }}
      className="space-y-4"
    >
      {product ? <input type="hidden" name="id" value={product.id} /> : null}

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Identification</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="productReference">Reference</Label>
            <Input id="productReference" value={reference} readOnly disabled className="font-mono" />
            <FieldHint>Assigned by the database on save.</FieldHint>
          </div>
          <div>
            <Label htmlFor="code">Product code<span className="text-danger-600"> *</span></Label>
            <Input id="code" name="code" defaultValue={product?.code ?? ""} placeholder="e.g. PKM-GR-I-50" />
            <FieldError message={errors.code?.[0]} />
          </div>
          <div>
            <Label htmlFor="name">Product name<span className="text-danger-600"> *</span></Label>
            <Input id="name" name="name" defaultValue={product?.name ?? ""} />
            <FieldError message={errors.name?.[0]} />
          </div>
          <div>
            <Label htmlFor="categoryId">Category<span className="text-danger-600"> *</span></Label>
            <Select id="categoryId" name="categoryId" defaultValue={product?.categoryId ?? ""}>
              <option value="">—</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </Select>
            <FieldError message={errors.categoryId?.[0]} />
          </div>
          <div>
            <Label htmlFor="productType">Product type<span className="text-danger-600"> *</span></Label>
            <Select id="productType" name="productType" defaultValue={product?.productType ?? "raw_material"}>
              {productTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
            <FieldError message={errors.productType?.[0]} />
          </div>
          <div>
            <Label htmlFor="brand">Brand</Label>
            <Input id="brand" name="brand" defaultValue={product?.brand ?? ""} />
            <FieldError message={errors.brand?.[0]} />
          </div>
          <div>
            <Label htmlFor="internalReference">Internal reference</Label>
            <Input id="internalReference" name="internalReference" defaultValue={product?.internalReference ?? ""} />
            <FieldError message={errors.internalReference?.[0]} />
          </div>
          <div>
            <Label htmlFor="barcode">Barcode</Label>
            <Input id="barcode" name="barcode" defaultValue={product?.barcode ?? ""} />
            <FieldError message={errors.barcode?.[0]} />
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-1 text-sm font-semibold text-ink">Units of measure</h2>
        <p className="mb-3 max-w-3xl text-[0.6875rem] text-ink-subtle">
          The base unit defines what a stored quantity means. It cannot be changed once the product leaves draft, because that would silently re-interpret every historical quantity and conversion.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {unitSelect("baseUnitId", "Base unit *", product?.baseUnitId ?? null)}
          {unitSelect("purchaseUnitId", "Purchase unit", product?.purchaseUnitId ?? null)}
          {unitSelect("storageUnitId", "Storage unit", product?.storageUnitId ?? null)}
          {unitSelect("salesUnitId", "Sales unit", product?.salesUnitId ?? null)}
          {unitSelect("productionUnitId", "Production unit", product?.productionUnitId ?? null)}
        </div>
        {baseUnitLocked ? (
          <div className="mt-3">
            <Label htmlFor="changeBaseUnitReason">Reason for a base-unit change</Label>
            <Input id="changeBaseUnitReason" name="changeBaseUnitReason" placeholder="Only used when the product is still a draft" />
            <FieldError message={errors.changeBaseUnitReason?.[0]} />
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Description</h2>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="shortDescription">Short description</Label>
            <Input id="shortDescription" name="shortDescription" defaultValue={product?.shortDescription ?? ""} />
            <FieldError message={errors.shortDescription?.[0]} />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" rows={3} defaultValue={product?.description ?? ""} />
            <FieldError message={errors.description?.[0]} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="origin">Origin</Label>
              <Input id="origin" name="origin" defaultValue={product?.origin ?? ""} />
              <FieldError message={errors.origin?.[0]} />
            </div>
            <div>
              <Label htmlFor="processingMethod">Processing method</Label>
              <Input id="processingMethod" name="processingMethod" defaultValue={product?.processingMethod ?? ""} />
              <FieldError message={errors.processingMethod?.[0]} />
            </div>
          </div>
          <div>
            <Label htmlFor="notes">Internal notes</Label>
            <Textarea id="notes" name="notes" rows={2} defaultValue={product?.notes ?? ""} />
            <FieldError message={errors.notes?.[0]} />
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : product ? "Save changes" : "Create draft product"}
        </Button>
      </div>
    </form>
  );
}
