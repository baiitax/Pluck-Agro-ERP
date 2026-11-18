import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("dashboard.overview.view")) {
    return <PermissionGuard permission="dashboard.overview.view" />;
  }

  return (
    <ModulePlaceholder
      title="Notifications"
      description="Notification centre and activity feed."
      permission="dashboard.overview.view"
      plannedPhase="a later phase"
      scope={[
          "Pending approval notifications",
          "Low stock and quality alerts",
          "Read/unread state and preferences",
          "Links to the related transaction",
          "Notification delivery channels",
      ]}
    />
  );
}
