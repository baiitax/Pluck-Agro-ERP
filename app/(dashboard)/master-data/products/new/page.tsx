import type { Metadata } from "next";

import { ProductForm } from "@/components/master-data/product-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { PRODUCT_TYPES, labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getProductCategoryOptions, getUnitOptions } from "@/services/master-data/reference-data";
import { peekProductReference } from "@/services/master-data/products";

export const metadata: Metadata = { title: "New product" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const { allowed } = await guardMasterDataPage("master_data.products.create");
  if (!allowed) return <PermissionGuard permission="master_data.products.create" />;

  const [categories, units, reference] = await Promise.all([getProductCategoryOptions(), getUnitOptions(), peekProductReference()]);

  return (
    <div>
      <PageHeader
        title="New product"
        description="Products are created as drafts. The base unit is chosen once and is locked after the draft stage, because changing it would re-interpret every quantity already recorded against the product."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Products", href: "/master-data/products" },
          { label: "New" },
        ]}
      />
      <ProductForm
        categories={categories}
        units={units}
        productTypes={PRODUCT_TYPES.map((type) => ({ value: type, label: labelFor(type) }))}
        reference={reference}
        baseUnitLocked={false}
      />
    </div>
  );
}
