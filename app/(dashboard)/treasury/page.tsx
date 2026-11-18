import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/shared/module-placeholder";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Treasury & banking" };
export const dynamic = "force-dynamic";

export default async function TreasuryPage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("treasury.payment.view")) {
    return <PermissionGuard permission="treasury.payment.view" />;
  }

  return (
    <ModulePlaceholder
      title="Treasury & banking"
      description="Bank records, payment instructions, reconciliation and FX."
      permission="treasury.payment.view"
      plannedPhase="a later phase"
      scope={[
          "Bank account registry and balances",
          "Payment requests and approvals",
          "Bank statement import and matching",
          "Effective-dated FX rates",
          "Cash position reporting",
      ]}
    />
  );
}
