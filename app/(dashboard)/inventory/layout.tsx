import type { ReactNode } from "react";

import { WorkspaceNav, type WorkspaceLink } from "@/components/shared/workspace-nav";
import type { PermissionCode } from "@/lib/permissions/definitions";
import { requireActiveProfile } from "@/services/authorization";

const SECTIONS: { label: string; href: string; permission: PermissionCode }[] = [
  { label: "Overview", href: "/inventory", permission: "inventory.dashboard.view" },
  { label: "Stock", href: "/inventory/stock", permission: "inventory.stock.view" },
  { label: "Lots", href: "/inventory/lots", permission: "inventory.stock.view" },
  { label: "Movements", href: "/inventory/movements", permission: "inventory.stock.view" },
  { label: "Transfers", href: "/inventory/transfers", permission: "inventory.transfer.view" },
  { label: "Counts", href: "/inventory/counts", permission: "inventory.count.view" },
  { label: "Adjustments", href: "/inventory/adjustments", permission: "inventory.adjustment.view" },
  { label: "Restrictions", href: "/inventory/restrictions", permission: "inventory.restriction.view" },
  { label: "Reservations", href: "/inventory/reservations", permission: "inventory.reservation.view" },
  { label: "Reports", href: "/inventory/reports", permission: "inventory.reports.view" },
];

export const dynamic = "force-dynamic";

/**
 * Inventory workspace shell.
 *
 * The section list is filtered by the caller's own permissions, so no link is offered that would be
 * refused. The links are not the control: each page re-checks, each service checks again, and RLS enforces
 * the same rule inside PostgreSQL.
 */
export default async function InventoryLayout({ children }: { children: ReactNode }) {
  const principal = await requireActiveProfile();
  const links: WorkspaceLink[] = SECTIONS.filter((section) => principal.permissions.has(section.permission)).map(
    ({ label, href }) => ({ label, href }),
  );

  return (
    <div className="space-y-4">
      <WorkspaceNav links={links} label="Inventory" />
      {children}
    </div>
  );
}
