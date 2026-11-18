import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SupplierForm } from "@/components/master-data/new-supplier-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { SUPPLIER_TYPES, MASTER_STATUS_LABELS, labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getSupplierCategoryOptions, getCurrencyOptions } from "@/services/master-data/reference-data";
import { getSupplier } from "@/services/master-data/suppliers";

export const metadata: Metadata = { title: "Edit supplier" };
export const dynamic = "force-dynamic";

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { allowed } = await guardMasterDataPage("master_data.suppliers.update");
  if (!allowed) return <PermissionGuard permission="master_data.suppliers.update" />;

  const detail = await getSupplier(id);
  if (!detail) notFound();
  const { supplier } = detail;

  const [categories, currencies] = await Promise.all([getSupplierCategoryOptions(), getCurrencyOptions()]);

  return (
    <div>
      <PageHeader
        title={`Edit ${supplier.legal_name}`}
        description={`Reference ${supplier.reference} · status ${MASTER_STATUS_LABELS[supplier.status] ?? supplier.status}. Status is changed from the profile, not from this form, so each transition carries its own permission.`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Suppliers", href: "/master-data/suppliers" },
          { label: supplier.reference, href: `/master-data/suppliers/${supplier.id}` },
          { label: "Edit" },
        ]}
      />
      <SupplierForm
        categories={categories}
        currencies={currencies}
        supplierTypes={SUPPLIER_TYPES.map((type) => ({ value: type, label: labelFor(type) }))}
        reference={supplier.reference}
        supplier={{
          id: supplier.id,
          legalName: supplier.legal_name,
          tradingName: supplier.trading_name,
          supplierType: supplier.supplier_type,
          primaryCategoryId: supplier.primary_category_id,
          registrationCountry: supplier.registration_country,
          registrationNumber: supplier.registration_number,
          taxIdentificationNumber: supplier.tax_identification_number,
          contactPerson: supplier.contact_person,
          phone: supplier.phone,
          email: supplier.email,
          website: supplier.website,
          preferredCurrencyCode: supplier.preferred_currency_code,
          notes: supplier.notes,
        }}
      />
    </div>
  );
}
