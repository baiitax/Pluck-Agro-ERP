import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Assets & investments" };
export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("assets.asset.view")) {
    return <PermissionGuard permission="assets.asset.view" />;
  }

  return (
    <ModulePlaceholder
      title="Assets & investments"
      description="Fixed asset register, depreciation and investment tracking."
      permission="assets.asset.view"
      plannedPhase="a later phase"
      scope={[
          "Asset registration and custody",
          "Depreciation schedules and runs",
          "Transfers and disposals",
          "Investment register and returns",
          "Accounting integration",
      ]}
    />
  );
}
