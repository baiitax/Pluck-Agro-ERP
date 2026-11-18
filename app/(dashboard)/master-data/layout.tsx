import type { ReactNode } from "react";

import { MasterDataNav, type WorkspaceLink } from "@/components/master-data/workspace-nav";
import type { PermissionCode } from "@/lib/permissions/definitions";
import { requireActiveProfile } from "@/services/authorization";

const SECTIONS: { label: string; href: string; permission: PermissionCode }[] = [
  { label: "Overview", href: "/master-data", permission: "master_data.overview.view" },
  { label: "Suppliers", href: "/master-data/suppliers", permission: "master_data.suppliers.view" },
  { label: "Customers", href: "/master-data/customers", permission: "master_data.customers.view" },
  { label: "Products", href: "/master-data/products", permission: "master_data.products.view" },
  { label: "Units & conversions", href: "/master-data/units", permission: "master_data.units.view" },
  { label: "Sites", href: "/master-data/sites", permission: "master_data.sites.view" },
  { label: "Warehouses", href: "/master-data/warehouses", permission: "master_data.warehouses.view" },
  { label: "Currencies", href: "/master-data/currencies", permission: "master_data.currencies.view" },
  { label: "Exchange rates", href: "/master-data/exchange-rates", permission: "master_data.exchange_rates.view" },
  { label: "Payment terms", href: "/master-data/payment-terms", permission: "master_data.payment_terms.view" },
  { label: "Delivery terms", href: "/master-data/delivery-terms", permission: "master_data.delivery_terms.view" },
  { label: "Tax categories", href: "/master-data/tax-categories", permission: "master_data.tax_categories.view" },
  { label: "Duplicates", href: "/master-data/duplicates", permission: "master_data.duplicates.view" },
  { label: "Data quality", href: "/master-data/quality", permission: "master_data.quality.view" },
  { label: "Imports", href: "/master-data/imports", permission: "master_data.imports.view" },
  { label: "Change history", href: "/master-data/history", permission: "master_data.history.view" },
];

export const dynamic = "force-dynamic";

/**
 * Master-data workspace shell.
 *
 * The section list is filtered by the caller's own permissions before it is rendered, so nobody is
 * offered a link they will be refused. The links are not the control: each page and each service
 * re-checks its permission, and RLS enforces the same rule in PostgreSQL.
 */
export default async function MasterDataLayout({ children }: { children: ReactNode }) {
  const principal = await requireActiveProfile();
  const links: WorkspaceLink[] = SECTIONS.filter((section) => principal.permissions.has(section.permission)).map(
    ({ label, href }) => ({ label, href }),
  );

  return (
    <div className="space-y-4">
      <MasterDataNav links={links} />
      {children}
    </div>
  );
}
