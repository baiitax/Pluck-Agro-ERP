import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Sales" };
export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("sales.order.view")) {
    return <PermissionGuard permission="sales.order.view" />;
  }

  return (
    <ModulePlaceholder
      title="Sales"
      description="Customer orders, commercial pricing and fulfilment tracking."
      permission="sales.order.view"
      plannedPhase="a later phase"
      scope={[
          "Sales orders with approval workflow",
          "Customer and currency-specific pricing",
          "Stock reservations per order line",
          "Fulfilment and invoicing status",
          "Margin analysis",
      ]}
    />
  );
}
