import type { Metadata } from "next";

import { SupplierForm } from "@/components/master-data/new-supplier-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { SUPPLIER_TYPES, labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getSupplierCategoryOptions, getCurrencyOptions } from "@/services/master-data/reference-data";
import { peekSupplierReference } from "@/services/master-data/suppliers";

export const metadata: Metadata = { title: "New supplier" };
export const dynamic = "force-dynamic";

export default async function NewSupplierPage() {
  const { allowed } = await guardMasterDataPage("master_data.suppliers.create");
  if (!allowed) return <PermissionGuard permission="master_data.suppliers.create" />;

  const [categories, currencies, reference] = await Promise.all([
    getSupplierCategoryOptions(),
    getCurrencyOptions(),
    peekSupplierReference(),
  ]);

  return (
    <div>
      <PageHeader
        title="New supplier"
        description="A supplier is created as a draft. Verification and activation are separate steps with their own permissions, so creating a record never by itself makes a partner usable for procurement."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Suppliers", href: "/master-data/suppliers" },
          { label: "New" },
        ]}
      />
      <SupplierForm
        categories={categories}
        currencies={currencies}
        supplierTypes={SUPPLIER_TYPES.map((type) => ({ value: type, label: labelFor(type) }))}
        reference={reference}
      />
    </div>
  );
}
