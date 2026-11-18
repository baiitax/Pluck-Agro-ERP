import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Finance & accounting" };
export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("finance.journal.view")) {
    return <PermissionGuard permission="finance.journal.view" />;
  }

  return (
    <ModulePlaceholder
      title="Finance & accounting"
      description="Double-entry accounting integrated with operational transactions."
      permission="finance.journal.view"
      plannedPhase="a later phase"
      scope={[
          "Chart of accounts and accounting periods",
          "Balanced journal entries with atomic posting",
          "Accounts payable and receivable",
          "Trial balance, P&L, balance sheet, cash flow",
          "Period locking and reversal discipline",
      ]}
    />
  );
}
