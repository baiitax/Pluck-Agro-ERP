import type { Metadata } from "next";
import { Scale } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { CreateAuthorityDialog } from "@/components/governance/authority-form";
import { formatDate } from "@/lib/formatting";
import { isAuthorityActive } from "@/lib/governance/authority";
import { requirePermission } from "@/services/authorization";
import { getDepartments } from "@/services/departments/get-departments";
import { getEmployeeOptions } from "@/services/employees/get-employees";
import { getAuthorities } from "@/services/governance/authorities";
import { getRoles } from "@/services/roles/get-roles";

export const metadata: Metadata = { title: "Approval authorities" };
export const dynamic = "force-dynamic";

export default async function AuthoritiesPage() {
  const principal = await requirePermission("governance.approvals.view");
  const [authorities, employees, departments, roles] = await Promise.all([
    getAuthorities(),
    getEmployeeOptions(),
    getDepartments(),
    getRoles(),
  ]);

  const canConfigure = principal.permissions.has("governance.approvals.configure");

  return (
    <div>
      <PageHeader
        title="Approval authorities"
        description="Who may approve what, up to which amount. These are configuration records entered by administrators — the system never invents a limit, and Phase 1 runs no approval workflow."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Governance" },
          { label: "Approval authorities" },
        ]}
        actions={
          canConfigure ? (
            <CreateAuthorityDialog
              employees={employees.map((employee) => ({
                id: employee.id,
                label: `${employee.first_name} ${employee.last_name} · ${employee.employee_number}`,
              }))}
              departments={departments.map((department) => ({ id: department.id, label: department.name }))}
              roles={roles.map((role) => ({ id: role.id, label: `${role.name} (${role.code})` }))}
            />
          ) : null
        }
      />

      <div className="erp-card overflow-hidden">
        {authorities.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="No approval authority configured"
            description={
              canConfigure
                ? "Configure limits per module and transaction type. Until you do, nobody holds any recorded approval authority — and nothing can be delegated."
                : "No approval authority has been configured yet. An administrator with governance.approvals.configure permission maintains it."
            }
          />
        ) : (
          <TableWrapper>
            <Table className="min-w-[52rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Principal</TH>
                  <TH>Module</TH>
                  <TH>Transaction</TH>
                  <TH>Range</TH>
                  <TH>Level</TH>
                  <TH>Scope</TH>
                  <TH>Validity</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {authorities.map((authority) => {
                  const active = isAuthorityActive(authority);
                  return (
                    <TR key={authority.id}>
                      <TD className="text-xs">
                        {authority.employee ? (
                          <>
                            <span className="font-medium text-ink">
                              {authority.employee.first_name} {authority.employee.last_name}
                            </span>
                            <span className="block text-[0.6875rem] text-ink-subtle">
                              {authority.employee.employee_number}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="font-medium text-ink">{authority.role?.name ?? "Unknown role"}</span>
                            <span className="block text-[0.6875rem] text-ink-subtle">via role</span>
                          </>
                        )}
                      </TD>
                      <TD className="text-xs">{authority.module}</TD>
                      <TD className="text-xs">{authority.transaction_type}</TD>
                      <TD className="text-xs">
                        {authority.currency_code} {Number(authority.minimum_amount).toLocaleString()} –{" "}
                        {Number(authority.maximum_amount).toLocaleString()}
                      </TD>
                      <TD className="text-xs">{authority.authority_level}</TD>
                      <TD className="text-xs">
                        {authority.scope_type.replace(/_/g, " ")}
                        {authority.department ? ` · ${authority.department.name}` : ""}
                      </TD>
                      <TD className="text-[0.6875rem] text-ink-muted">
                        {formatDate(authority.effective_from)}
                        {authority.effective_until ? ` → ${formatDate(authority.effective_until)}` : " → open"}
                      </TD>
                      <TD>
                        <Badge tone={active ? "success" : "neutral"} dot>
                          {active ? "Active" : authority.is_active ? "Outside window" : "Inactive"}
                        </Badge>
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
        {authorities.length} configured limit(s) ·{" "}
        {authorities.filter((authority) => isAuthorityActive(authority)).length} currently inside their validity window.
        Every change is a governance audit event.
      </p>
    </div>
  );
}
