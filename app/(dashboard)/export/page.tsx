import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Export" };
export const dynamic = "force-dynamic";

export default async function ExportPage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("export.shipment.view")) {
    return <PermissionGuard permission="export.shipment.view" />;
  }

  return (
    <ModulePlaceholder
      title="Export"
      description="Export documentation and shipment tracking."
      permission="export.shipment.view"
      plannedPhase="a later phase"
      scope={[
          "Commercial invoice and packing list",
          "Certificates of analysis and origin",
          "Bill of lading and phytosanitary records",
          "Shipment status tracking",
          "Export performance reporting",
      ]}
    />
  );
}
