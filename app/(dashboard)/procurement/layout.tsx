import type { ReactNode } from "react";

import { ProcurementNav, type ProcurementLink } from "@/components/procurement/workspace-nav";
import type { PermissionCode } from "@/lib/permissions/definitions";
import { requireActiveProfile } from "@/services/authorization";

const SECTIONS: { label: string; href: string; permission: PermissionCode }[] = [
  { label: "Overview", href: "/procurement", permission: "procurement.dashboard.view" },
  { label: "Requisitions", href: "/procurement/requisitions", permission: "procurement.requisition.view" },
  { label: "Quotations", href: "/procurement/quotations", permission: "procurement.quotation.view" },
  { label: "Comparisons", href: "/procurement/quotations/comparisons", permission: "procurement.quotation.compare" },
  { label: "Purchase orders", href: "/procurement/purchase-orders", permission: "procurement.purchase_order.view" },
  { label: "Goods receipts", href: "/procurement/goods-receipts", permission: "procurement.goods_receipt.view" },
  { label: "Supplier advances", href: "/procurement/supplier-advances", permission: "procurement.supplier_advance.view" },
  { label: "Supplier position", href: "/procurement/suppliers", permission: "procurement.reconciliation.view" },
  { label: "Approvals", href: "/procurement/approvals", permission: "procurement.approval.view" },
  { label: "Documents", href: "/procurement/documents", permission: "procurement.document.view" },
  { label: "Reports", href: "/procurement/reports", permission: "procurement.reports.view" },
  { label: "Legacy readiness", href: "/procurement/legacy", permission: "procurement.legacy.view" },
];

export const dynamic = "force-dynamic";

/**
 * Procurement workspace shell.
 *
 * The section list is filtered by the caller's own permissions before it renders, so nobody is
 * offered a link they will be refused. The links are not the control: each page re-checks its
 * permission, each service checks it again, and RLS enforces the same rule in PostgreSQL.
 */
export default async function ProcurementLayout({ children }: { children: ReactNode }) {
  const principal = await requireActiveProfile();
  const links: ProcurementLink[] = SECTIONS.filter((section) => principal.permissions.has(section.permission)).map(
    ({ label, href }) => ({ label, href }),
  );

  return (
    <div className="space-y-4">
      <ProcurementNav links={links} />
      {children}
    </div>
  );
}
