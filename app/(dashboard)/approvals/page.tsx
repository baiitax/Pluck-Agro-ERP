import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("approvals.queue.view")) {
    return <PermissionGuard permission="approvals.queue.view" />;
  }

  return (
    <ModulePlaceholder
      title="Approvals"
      description="Central workflow and approval engine."
      permission="approvals.queue.view"
      plannedPhase="a later phase"
      scope={[
          "Configurable approval stages",
          "Value-based approval limits",
          "Separation of duties controls",
          "Approval history and comments",
          "Escalation rules",
      ]}
    />
  );
}
