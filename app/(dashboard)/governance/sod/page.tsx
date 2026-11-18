import type { Metadata } from "next";
import { Scale } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { SodOverrideDialog, SodRuleDialog } from "@/components/governance/sod-form";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { requirePermission } from "@/services/authorization";
import { getEmployeeOptions } from "@/services/employees/get-employees";
import { getSodOverrides, getSodRules } from "@/services/governance/sod";

export const metadata: Metadata = { title: "Segregation of duties" };
export const dynamic = "force-dynamic";

const ENFORCEMENT_TONE = { BLOCK: "danger", REQUIRE_OVERRIDE: "warning", WARN: "info" } as const;

export default async function SodPage() {
  const principal = await requirePermission("governance.sod.view");
  const [rules, overrides, employees] = await Promise.all([getSodRules(), getSodOverrides(), getEmployeeOptions()]);

  const canConfigure = principal.permissions.has("governance.sod.configure");

  return (
    <div>
      <PageHeader
        title="Segregation of duties"
        description="Conflicting-duty rules are policy, not defaults. The system seeds none: configure only the separations your management has approved, and choose whether to warn, require an override or block."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Governance" }, { label: "Segregation of duties" }]}
        actions={
          canConfigure ? (
            <div className="flex items-center gap-2">
              <SodOverrideDialog
                rules={rules.filter((rule) => rule.is_active).map((rule) => ({ id: rule.id, label: `${rule.code} · ${rule.name}` }))}
                employees={employees.map((employee) => ({
                  id: employee.id,
                  label: `${employee.first_name} ${employee.last_name} · ${employee.employee_number}`,
                }))}
              />
              <SodRuleDialog />
            </div>
          ) : null
        }
      />

      <div className="erp-card mb-4 overflow-hidden">
        {rules.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="No rules configured"
            description="No conflicting-duty rule is enforced until you create one. This is deliberate: the system must never invent governance policy."
          />
        ) : (
          <TableWrapper>
            <Table className="min-w-[48rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Rule</TH>
                  <TH>Module / transaction</TH>
                  <TH>Conflict</TH>
                  <TH>Enforcement</TH>
                  <TH>Status</TH>
                  {canConfigure ? <TH className="text-right">Actions</TH> : null}
                </TR>
              </THead>
              <TBody>
                {rules.map((rule) => (
                  <TR key={rule.id}>
                    <TD className="text-xs">
                      <span className="font-medium text-ink">{rule.name}</span>
                      <span className="block font-mono text-[0.625rem] text-ink-subtle">{rule.code}</span>
                      {rule.description ? (
                        <span className="block text-[0.6875rem] text-ink-muted">{rule.description}</span>
                      ) : null}
                    </TD>
                    <TD className="text-xs">
                      {rule.module}/{rule.transaction_type}
                    </TD>
                    <TD className="font-mono text-[0.6875rem] text-ink-muted">
                      {rule.first_action} ⇄ {rule.conflicting_action}
                    </TD>
                    <TD>
                      <Badge tone={ENFORCEMENT_TONE[rule.enforcement_level] ?? "neutral"}>
                        {rule.enforcement_level.replace(/_/g, " ")}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge tone={rule.is_active ? "success" : "neutral"} dot>
                        {rule.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    {canConfigure ? (
                      <TD className="text-right">
                        <SodRuleDialog
                          rule={{
                            id: rule.id,
                            name: rule.name,
                            code: rule.code,
                            module: rule.module,
                            transaction_type: rule.transaction_type,
                            first_action: rule.first_action,
                            conflicting_action: rule.conflicting_action,
                            enforcement_level: rule.enforcement_level,
                            description: rule.description,
                            is_active: rule.is_active,
                          }}
                        />
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Overrides</CardTitle>
            <CardDescription>
              Time-boxed exceptions to a rule. Each one is a critical audit event with the justification recorded.
            </CardDescription>
          </div>
          <Badge tone="warning">{overrides.length}</Badge>
        </CardHeader>
        <CardContent>
          {overrides.length === 0 ? (
            <p className="text-xs text-ink-subtle">No overrides have been granted.</p>
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Rule</TH>
                    <TH>Employee</TH>
                    <TH>Justification</TH>
                    <TH>Granted</TH>
                    <TH>Expires</TH>
                  </TR>
                </THead>
                <TBody>
                  {overrides.map((override) => (
                    <TR key={override.id}>
                      <TD className="text-xs">
                        {override.rule?.name ?? "Unknown rule"}
                        <span className="block font-mono text-[0.625rem] text-ink-subtle">
                          {override.rule?.code ?? ""}
                        </span>
                      </TD>
                      <TD className="text-xs">
                        {override.employee
                          ? `${override.employee.first_name} ${override.employee.last_name}`
                          : "Unknown employee"}
                      </TD>
                      <TD className="max-w-sm text-[0.6875rem] text-ink-muted">{override.justification}</TD>
                      <TD className="text-[0.6875rem] text-ink-muted">{formatDateTime(override.granted_at)}</TD>
                      <TD className="text-xs">
                        {override.expires_at ? (
                          <span
                            className={
                              new Date(override.expires_at) < new Date() ? "text-danger-700" : "text-ink"
                            }
                          >
                            {formatDate(override.expires_at)}
                            {new Date(override.expires_at) < new Date() ? " (expired)" : ""}
                          </span>
                        ) : (
                          <span className="text-warning-600">Never</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
