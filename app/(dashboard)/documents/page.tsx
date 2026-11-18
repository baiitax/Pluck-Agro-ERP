import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("documents.document.view")) {
    return <PermissionGuard permission="documents.document.view" />;
  }

  return (
    <ModulePlaceholder
      title="Documents"
      description="Private document storage and controlled access."
      permission="documents.document.view"
      plannedPhase="a later phase"
      scope={[
          "Private storage buckets",
          "Versioned business documents",
          "Short-lived authorised download links",
          "Document categories and search",
          "Retention and archival",
      ]}
    />
  );
}
