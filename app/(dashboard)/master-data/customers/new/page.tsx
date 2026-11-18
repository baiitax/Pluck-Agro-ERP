import type { Metadata } from "next";

import { CustomerForm } from "@/components/master-data/customer-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { CUSTOMER_TYPES, labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getCustomerCategoryOptions, getCurrencyOptions } from "@/services/master-data/reference-data";
import { peekCustomerReference } from "@/services/master-data/customers";

export const metadata: Metadata = { title: "New customer" };
export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  const { allowed } = await guardMasterDataPage("master_data.customers.create");
  if (!allowed) return <PermissionGuard permission="master_data.customers.create" />;

  const [categories, currencies, reference] = await Promise.all([
    getCustomerCategoryOptions(),
    getCurrencyOptions(),
    peekCustomerReference(),
  ]);

  return (
    <div>
      <PageHeader
        title="New customer"
        description="Customers start as a lead and move through prospect, onboarding, verification and activation. No credit terms are granted here: a stored credit reference does not authorise a credit sale."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Customers", href: "/master-data/customers" },
          { label: "New" },
        ]}
      />
      <CustomerForm
        categories={categories}
        currencies={currencies}
        customerTypes={CUSTOMER_TYPES.map((type) => ({ value: type, label: labelFor(type) }))}
        reference={reference}
      />
    </div>
  );
}
