import type { ReactNode } from "react";

import { WorkspaceNav, type WorkspaceLink } from "@/components/shared/workspace-nav";
import type { PermissionCode } from "@/lib/permissions/definitions";
import { requireActiveProfile } from "@/services/authorization";

const SECTIONS: { label: string; href: string; permission: PermissionCode }[] = [
  { label: "Overview", href: "/quality", permission: "quality.dashboard.view" },
  { label: "Specifications", href: "/quality/specifications", permission: "quality.specification.view" },
  { label: "Inspections", href: "/quality/inspections", permission: "quality.inspection.view" },
  { label: "Dispositions", href: "/quality/dispositions", permission: "quality.disposition.view" },
  { label: "Holds", href: "/quality/holds", permission: "quality.disposition.view" },
  { label: "Non-conformance", href: "/quality/ncr", permission: "quality.ncr.view" },
  { label: "Certificates", href: "/quality/certificates", permission: "quality.certificate.view" },
  { label: "Traceability", href: "/quality/traceability", permission: "quality.traceability.view" },
  { label: "Reports", href: "/quality/reports", permission: "quality.reports.view" },
];

export const dynamic = "force-dynamic";

/**
 * Quality workspace shell.
 *
 * The section list is filtered by the caller's own permissions, so no link is offered that would be refused. The
 * links are not the control: each page re-checks, each service checks again, and RLS enforces the same rule inside
 * PostgreSQL.
 */
export default async function QualityLayout({ children }: { children: ReactNode }) {
  const principal = await requireActiveProfile();
  const links: WorkspaceLink[] = SECTIONS.filter((section) => principal.permissions.has(section.permission)).map(
    ({ label, href }) => ({ label, href }),
  );

  return (
    <div className="space-y-4">
      <WorkspaceNav links={links} label="Quality" />
      {children}
    </div>
  );
}
