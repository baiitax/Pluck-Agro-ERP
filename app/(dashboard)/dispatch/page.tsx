import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Dispatch" };
export const dynamic = "force-dynamic";

export default async function DispatchPage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("dispatch.dispatch.view")) {
    return <PermissionGuard permission="dispatch.dispatch.view" />;
  }

  return (
    <ModulePlaceholder
      title="Dispatch"
      description="Warehouse dispatch, loading and container management."
      permission="dispatch.dispatch.view"
      plannedPhase="a later phase"
      scope={[
          "Dispatch against an approved sales order",
          "Container, seal and weighbridge capture",
          "Atomic stock movement on approval",
          "Shipment milestone history",
          "Delivery confirmation",
      ]}
    />
  );
}
