import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Quality control" };
export const dynamic = "force-dynamic";

export default async function QualityPage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("quality.inspection.view")) {
    return <PermissionGuard permission="quality.inspection.view" />;
  }

  return (
    <ModulePlaceholder
      title="Quality control"
      description="Inspection, traceability and product release control."
      permission="quality.inspection.view"
      plannedPhase="a later phase"
      scope={[
          "Raw material and finished product inspection",
          "Lot and batch traceability chain",
          "Certificates of analysis",
          "Quarantine and rejection handling",
          "Versioned results after approval",
      ]}
    />
  );
}
