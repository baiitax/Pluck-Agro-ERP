import type { Metadata } from "next";
import { GitBranch } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import {
  CreateDelegationDialog,
  DelegationDecisionButtons,
  RevokeDelegationButton,
} from "@/components/governance/delegation-form";
import { formatDate } from "@/lib/formatting";
import { effectiveDelegationStatus } from "@/lib/governance/delegation";
import { requirePermission } from "@/services/authorization";
import { getDepartments } from "@/services/departments/get-departments";
import { getEmployeeOptions } from "@/services/employees/get-employees";
import { getDelegations } from "@/services/governance/delegations";

export const metadata: Metadata = { title: "Delegations" };
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  approved: "success",
  pending_approval: "pending",
  rejected: "danger",
  revoked: "neutral",
  expired: "neutral",
} as const;

export default async function DelegationsPage() {
  const principal = await requirePermission("governance.delegations.view");
  const [delegations, employees, departments] = await Promise.all([
    getDelegations(),
    getEmployeeOptions(),
    getDepartments(),
  ]);

  const canConfigure = principal.permissions.has("governance.delegations.configure");
  const canApprove = principal.permissions.has("governance.delegations.approve");
  const canRevoke = principal.permissions.has("governance.delegations.revoke");

  const employeeOptions = employees.map((employee) => ({
    id: employee.id,
    label: `${employee.first_name} ${employee.last_name} · ${employee.employee_number}`,
  }));

  return (
    <div>
      <PageHeader
        title="Approval delegations"
        description="Temporary transfer of approval authority. A delegation never exceeds the delegator's own limit, expires automatically, cannot form a loop, and takes effect only after a second person approves it."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Governance" },
          { label: "Delegations" },
        ]}
        actions={
          canConfigure ? (
            <CreateDelegationDialog
              employees={employeeOptions}
              departments={departments.map((department) => ({ id: department.id, label: department.name }))}
            />
          ) : null
        }
      />

      <div className="erp-card overflow-hidden">
        {delegations.length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title="No delegations recorded"
            description={
              canConfigure
                ? "Create a delegation when someone is away. The delegator must already hold configured approval authority."
                : "Nobody has delegated approval authority yet."
            }
          />
        ) : (
          <TableWrapper>
            <Table className="min-w-[56rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Delegator → Delegate</TH>
                  <TH>Module / transaction</TH>
                  <TH>Limit</TH>
                  <TH>Window</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {delegations.map((delegation) => {
                  const status = effectiveDelegationStatus(delegation);
                  const effective = status === "approved";
                  return (
                    <TR key={delegation.id}>
                      <TD className="text-xs">
                        <span className="font-medium text-ink">
                          {delegation.delegator ? `${delegation.delegator.first_name} ${delegation.delegator.last_name}` : "Unknown"}
                        </span>
                        <span className="mx-1 text-ink-subtle">→</span>
                        <span className="font-medium text-ink">
                          {delegation.delegate ? `${delegation.delegate.first_name} ${delegation.delegate.last_name}` : "Unknown"}
                        </span>
                        <span className="block text-[0.6875rem] text-ink-subtle">
                          {delegation.reason}
                        </span>
                      </TD>
                      <TD className="text-xs">
                        {delegation.module}/{delegation.transaction_type}
                        {delegation.department ? (
                          <span className="block text-[0.6875rem] text-ink-subtle">{delegation.department.name}</span>
                        ) : null}
                      </TD>
                      <TD className="text-xs">
                        {delegation.currency_code} {Number(delegation.delegated_limit).toLocaleString()}
                      </TD>
                      <TD className="text-[0.6875rem] text-ink-muted">
                        {formatDate(delegation.effective_from)} → {formatDate(delegation.effective_until)}
                      </TD>
                      <TD>
                        <Badge tone={STATUS_TONE[status]} dot>
                          {status.replace(/_/g, " ")}
                        </Badge>
                      </TD>
                      <TD className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {status === "pending_approval" ? (
                            <DelegationDecisionButtons
                              delegationId={delegation.id}
                              delegatorName={
                                delegation.delegator
                                  ? `${delegation.delegator.first_name} ${delegation.delegator.last_name}`
                                  : "Unknown"
                              }
                              delegateName={
                                delegation.delegate
                                  ? `${delegation.delegate.first_name} ${delegation.delegate.last_name}`
                                  : "Unknown"
                              }
                              effectiveFrom={delegation.effective_from}
                              effectiveUntil={delegation.effective_until}
                              canApprove={canApprove}
                            />
                          ) : null}
                          {canRevoke && (status === "approved" || status === "pending_approval") ? (
                            <RevokeDelegationButton delegationId={delegation.id} />
                          ) : null}
                          {status !== "pending_approval" && !(canRevoke && effective) ? (
                            <span className="text-[0.6875rem] text-ink-subtle">—</span>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {delegations.length} delegation record(s) ·{" "}
        {delegations.filter((delegation) => effectiveDelegationStatus(delegation) === "approved").length} in force ·{" "}
        {delegations.filter((delegation) => delegation.status === "pending_approval").length} awaiting approval.
      </p>
    </div>
  );
}
