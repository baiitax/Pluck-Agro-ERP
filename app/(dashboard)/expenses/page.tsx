import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Expenses & imprest" };
export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("expenses.expense.view")) {
    return <PermissionGuard permission="expenses.expense.view" />;
  }

  return (
    <ModulePlaceholder
      title="Expenses & imprest"
      description="Expense capture, approval and imprest reconciliation."
      permission="expenses.expense.view"
      plannedPhase="a later phase"
      scope={[
          "Expense requests with supporting documents",
          "Approval authority enforcement",
          "Imprest issue, spend and replenishment",
          "Reconciliation and posting to finance",
          "Departmental expense reporting",
      ]}
    />
  );
}
