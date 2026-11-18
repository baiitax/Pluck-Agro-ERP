import type { ReactNode } from "react";

import { WorkspaceNav, type WorkspaceLink } from "@/components/shared/workspace-nav";
import type { PermissionCode } from "@/lib/permissions/definitions";
import { requireActiveProfile } from "@/services/authorization";

const SECTIONS: { label: string; href: string; permission: PermissionCode }[] = [
  { label: "Overview", href: "/production", permission: "production.dashboard.view" },
  { label: "Plans", href: "/production/plans", permission: "production.plan.view" },
  { label: "Batches", href: "/production/batches", permission: "production.batch.view" },
  { label: "Configuration", href: "/production/configuration", permission: "production.product.view" },
  { label: "Reports", href: "/production/reports", permission: "production.reports.view" },
];

export const dynamic = "force-dynamic";

/** Production workspace shell, filtered by the caller's own permissions. */
export default async function ProductionLayout({ children }: { children: ReactNode }) {
  const principal = await requireActiveProfile();
  const links: WorkspaceLink[] = SECTIONS.filter((section) => principal.permissions.has(section.permission)).map(
    ({ label, href }) => ({ label, href }),
  );

  return (
    <div className="space-y-4">
      <WorkspaceNav links={links} label="Production" />
      {children}
    </div>
  );
}
