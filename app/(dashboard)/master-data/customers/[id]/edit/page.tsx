import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CustomerForm } from "@/components/master-data/customer-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { CUSTOMER_TYPES, MASTER_STATUS_LABELS, labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getCustomer } from "@/services/master-data/customers";
import { getCustomerCategoryOptions, getCurrencyOptions } from "@/services/master-data/reference-data";

export const metadata: Metadata = { title: "Edit customer" };
export const dynamic = "force-dynamic";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { allowed } = await guardMasterDataPage("master_data.customers.update");
  if (!allowed) return <PermissionGuard permission="master_data.customers.update" />;

  const detail = await getCustomer(id);
  if (!detail) notFound();
  const { customer } = detail;

  const [categories, currencies] = await Promise.all([getCustomerCategoryOptions(), getCurrencyOptions()]);

  return (
    <div>
      <PageHeader
        title={`Edit ${customer.legal_name}`}
        description={`Reference ${customer.reference} · status ${MASTER_STATUS_LABELS[customer.status] ?? customer.status}. Credit details are edited from the profile under their own permission.`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Customers", href: "/master-data/customers" },
          { label: customer.reference, href: `/master-data/customers/${customer.id}` },
          { label: "Edit" },
        ]}
      />
      <CustomerForm
        categories={categories}
        currencies={currencies}
        customerTypes={CUSTOMER_TYPES.map((type) => ({ value: type, label: labelFor(type) }))}
        reference={customer.reference}
        customer={{
          id: customer.id,
          legalName: customer.legal_name,
          tradingName: customer.trading_name,
          customerType: customer.customer_type,
          primaryCategoryId: customer.primary_category_id,
          registrationNumber: customer.registration_number,
          taxIdentificationNumber: customer.tax_identification_number,
          registrationCountry: customer.registration_country,
          contactName: customer.contact_name,
          contactEmail: customer.contact_email,
          contactPhone: customer.contact_phone,
          preferredCurrencyCode: customer.preferred_currency_code,
          notes: customer.notes,
        }}
      />
    </div>
  );
}
