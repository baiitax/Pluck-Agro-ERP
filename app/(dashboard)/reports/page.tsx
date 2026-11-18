import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("reports.report.view")) {
    return <PermissionGuard permission="reports.report.view" />;
  }

  return (
    <ModulePlaceholder
      title="Reports"
      description="Governed departmental and executive reporting."
      permission="reports.report.view"
      plannedPhase="a later phase"
      scope={[
          "Departmental operational reports",
          "Financial statements from the ledger",
          "Posted vs pending vs reconciled data",
          "Exportable report definitions",
          "Executive intelligence dashboards",
      ]}
    />
  );
}
