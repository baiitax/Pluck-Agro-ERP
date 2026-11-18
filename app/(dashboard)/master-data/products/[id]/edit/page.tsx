import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProductForm } from "@/components/master-data/product-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { MASTER_STATUS_LABELS, PRODUCT_TYPES, labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getProduct } from "@/services/master-data/products";
import { getProductCategoryOptions, getUnitOptions } from "@/services/master-data/reference-data";

export const metadata: Metadata = { title: "Edit product" };
export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { allowed } = await guardMasterDataPage("master_data.products.update");
  if (!allowed) return <PermissionGuard permission="master_data.products.update" />;

  const detail = await getProduct(id);
  if (!detail) notFound();
  const { product } = detail;

  const [categories, units] = await Promise.all([getProductCategoryOptions(), getUnitOptions()]);
  const locked = product.status !== "draft";

  return (
    <div>
      <PageHeader
        title={`Edit ${product.name}`}
        description={`Code ${product.code} · status ${MASTER_STATUS_LABELS[product.status] ?? product.status}.${locked ? " The base unit is locked because the product is no longer a draft." : ""}`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Products", href: "/master-data/products" },
          { label: product.code, href: `/master-data/products/${product.id}` },
          { label: "Edit" },
        ]}
      />
      <ProductForm
        categories={categories}
        units={units}
        productTypes={PRODUCT_TYPES.map((type) => ({ value: type, label: labelFor(type) }))}
        reference={product.reference}
        baseUnitLocked={locked}
        product={{
          id: product.id,
          code: product.code,
          name: product.name,
          shortDescription: product.short_description,
          description: product.description,
          categoryId: product.category_id,
          productType: product.product_type,
          brand: product.brand,
          internalReference: product.internal_reference,
          barcode: product.barcode,
          baseUnitId: product.base_unit_id,
          purchaseUnitId: product.purchase_unit_id,
          storageUnitId: product.storage_unit_id,
          salesUnitId: product.sales_unit_id,
          productionUnitId: product.production_unit_id,
          origin: product.origin,
          processingMethod: product.processing_method,
          notes: product.notes,
        }}
      />
    </div>
  );
}
