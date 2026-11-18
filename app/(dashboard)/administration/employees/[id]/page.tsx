import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { AccountStatusBadge, EmploymentStatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { DeactivateEmployeeDialog, EmployeeFormDialog } from "@/components/forms/employee-form";
import { AddEmergencyContactDialog, RemoveEmergencyContactButton } from "@/components/employees/emergency-contacts";
import { EMPLOYMENT_TYPE_LABELS, EMPLOYEE_CATEGORY_LABELS } from "@/lib/validation/employee.schemas";
import { formatDate, formatDateTime, formatRelative } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/services/authorization";
import { getDepartments } from "@/services/departments/get-departments";
import { getEmployeeDetail } from "@/services/employees/get-employee-detail";
import { employeeFullName, getEmployeeOptions } from "@/services/employees/get-employees";
import { getPositions } from "@/services/positions/manage-positions";

export const metadata: Metadata = { title: "Employee" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "employment", label: "Employment" },
  { key: "organization", label: "Organisation" },
  { key: "account", label: "ERP account" },
  { key: "contacts", label: "Emergency contacts" },
  { key: "authority", label: "Authority & delegation" },
  { key: "history", label: "History" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-[0.6875rem] text-ink-subtle">{label}</span>
      <span className="text-right text-xs font-medium text-ink">{value}</span>
    </div>
  );
}

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const principal = await requirePermission("employees.employee.view");
  const { id } = await params;
  const query = await searchParams;
  const rawTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab: TabKey = TABS.some((candidate) => candidate.key === rawTab) ? (rawTab as TabKey) : "overview";

  const detail = await getEmployeeDetail(id);
  if (!detail) notFound();

  const { employee } = detail;
  const canUpdate = principal.permissions.has("employees.employee.update");
  const canDeactivate = principal.permissions.has("employees.employee.deactivate");
  const canViewHistory = principal.permissions.has("employees.history.view");
  const canViewAuthority = principal.permissions.has("governance.approvals.view");
  const canProvision = principal.permissions.has("access.accounts.invite");

  const [departments, positions, supervisors] = await Promise.all([
    getDepartments(),
    getPositions(),
    getEmployeeOptions(),
  ]);

  const employmentEnded = ["resigned", "terminated", "retired"].includes(employee.employment_status);

  return (
    <div>
      <PageHeader
        title={employeeFullName(employee)}
        description={`${employee.employee_number}${employee.job_title ? ` · ${employee.job_title}` : ""}${
          employee.department ? ` · ${employee.department.name}` : ""
        }`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administration" },
          { label: "Employees", href: "/administration/employees" },
          { label: employeeFullName(employee) },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/administration/employees"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              <ArrowLeft aria-hidden /> Back to register
            </Link>
            {canUpdate ? (
              <EmployeeFormDialog
                departments={departments.map((department) => ({
                  id: department.id,
                  label: `${department.name} (${department.code})`,
                }))}
                positions={positions
                  .filter((position) => position.is_active)
                  .map((position) => ({ id: position.id, label: `${position.title} (${position.code})` }))}
                supervisors={supervisors.map((option) => ({
                  id: option.id,
                  label: `${option.first_name} ${option.last_name} · ${option.employee_number}`,
                }))}
                employee={employee}
                trigger="edit"
              />
            ) : null}
            {canDeactivate && !employmentEnded ? (
              <DeactivateEmployeeDialog
                employeeId={employee.id}
                employeeName={employeeFullName(employee)}
              />
            ) : null}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <EmploymentStatusBadge status={employee.employment_status} />
        {detail.account ? (
          <AccountStatusBadge status={detail.account.account_status} />
        ) : (
          <Badge tone="neutral" dot>
            No ERP account
          </Badge>
        )}
        {detail.supervisor ? (
          <Badge tone="info">
            Reports to {detail.supervisor.first_name} {detail.supervisor.last_name}
          </Badge>
        ) : null}
      </div>

      <nav className="mb-4 flex flex-wrap gap-1 border-b border-border" aria-label="Employee sections">
        {TABS.map((candidate) => {
          if (candidate.key === "history" && !canViewHistory) return null;
          if (candidate.key === "authority" && !canViewAuthority) return null;
          const active = candidate.key === tab;
          return (
            <Link
              key={candidate.key}
              href={`/administration/employees/${employee.id}?tab=${candidate.key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                active
                  ? "border-brand-600 text-brand-800"
                  : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink",
              )}
            >
              {candidate.label}
            </Link>
          );
        })}
      </nav>

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>Personal details</CardTitle>
                <CardDescription>Contact information recorded for this employee.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-x-6 sm:grid-cols-2">
              <Row label="Employee number" value={<span className="font-mono">{employee.employee_number}</span>} />
              <Row label="Full name" value={employeeFullName(employee)} />
              <Row label="Email" value={employee.email ?? "—"} />
              <Row label="Phone" value={employee.phone ?? "—"} />
              <Row label="Work location" value={employee.work_location ?? "—"} />
              <Row label="Date joined" value={formatDate(employee.date_joined)} />
              <Row label="Employment end" value={formatDate(employee.employment_end_date)} />
              <Row label="Record created" value={formatDateTime(employee.created_at)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Access at a glance</CardTitle>
                <CardDescription>Account access is managed separately from employment.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {detail.account ? (
                <>
                  <Row label="Account status" value={<AccountStatusBadge status={detail.account.account_status} />} />
                  <Row
                    label="Roles"
                    value={
                      detail.account.assignments.filter((assignment) => assignment.is_active).length === 0
                        ? "No active role"
                        : detail.account.assignments
                            .filter((assignment) => assignment.is_active)
                            .map((assignment) => assignment.roles?.name ?? "Unknown")
                            .join(", ")
                    }
                  />
                  <Row
                    label="Last sign-in"
                    value={detail.account.last_login_at ? formatRelative(detail.account.last_login_at) : "Never"}
                  />
                  <Link
                    href={`/administration/users/${detail.account.id}`}
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-2 w-full")}
                  >
                    <KeyRound aria-hidden /> Manage account
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-ink-muted">
                    This employee has no ERP login. Operational staff often need none.
                  </p>
                  {canProvision && !employmentEnded ? (
                    <Link
                      href={`/administration/users?provision=${employee.id}`}
                      className={cn(buttonVariants({ size: "sm" }), "mt-1 w-full")}
                    >
                      <ShieldCheck aria-hidden /> Provision an account
                    </Link>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "employment" ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Employment</CardTitle>
              <CardDescription>Employment terms and status. Ending employment never deletes history.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-x-6 sm:grid-cols-2">
            <Row label="Employment status" value={<EmploymentStatusBadge status={employee.employment_status} />} />
            <Row
              label="Employment type"
              value={
                EMPLOYMENT_TYPE_LABELS[employee.employment_type as keyof typeof EMPLOYMENT_TYPE_LABELS] ??
                employee.employment_type
              }
            />
            <Row
              label="Employee category"
              value={
                employee.employee_category
                  ? (EMPLOYEE_CATEGORY_LABELS[
                      employee.employee_category as keyof typeof EMPLOYEE_CATEGORY_LABELS
                    ] ?? employee.employee_category)
                  : "—"
              }
            />
            <Row label="Job title" value={employee.job_title ?? "—"} />
            <Row label="Position" value={employee.position ? `${employee.position.title} (${employee.position.code})` : "—"} />
            <Row label="Date joined" value={formatDate(employee.date_joined)} />
            <Row label="Employment end date" value={formatDate(employee.employment_end_date)} />
            <Row label="Deactivated at" value={employee.deactivated_at ? formatDateTime(employee.deactivated_at) : "—"} />
            <Row label="Notes" value={<span className="whitespace-pre-line">{employee.notes ?? "—"}</span>} />
          </CardContent>
        </Card>
      ) : null}

      {tab === "organization" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Placement</CardTitle>
                <CardDescription>Department, position and reporting line.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Row
                label="Department"
                value={
                  employee.department ? (
                    <Link href="/administration/departments" className="hover:underline">
                      {employee.department.name} ({employee.department.code})
                    </Link>
                  ) : (
                    "Unassigned"
                  )
                }
              />
              <Row label="Position" value={employee.position?.title ?? "—"} />
              <Row
                label="Supervisor"
                value={
                  detail.supervisor ? (
                    <Link
                      href={`/administration/employees/${detail.supervisor.id}`}
                      className="hover:underline"
                    >
                      {detail.supervisor.first_name} {detail.supervisor.last_name}
                    </Link>
                  ) : (
                    "No supervisor recorded"
                  )
                }
              />
              <Row label="Work location" value={employee.work_location ?? "—"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Direct reports</CardTitle>
                <CardDescription>{detail.subordinates.length} employee(s) report to this person.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {detail.subordinates.length === 0 ? (
                <p className="text-xs text-ink-subtle">Nobody reports to this employee.</p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.subordinates.map((subordinate) => (
                    <li key={subordinate.id} className="flex items-center justify-between text-xs">
                      <Link
                        href={`/administration/employees/${subordinate.id}`}
                        className="font-medium text-ink hover:text-brand-700 hover:underline"
                      >
                        {subordinate.first_name} {subordinate.last_name}
                      </Link>
                      <span className="font-mono text-[0.6875rem] text-ink-subtle">
                        {subordinate.employee_number}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "account" ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>ERP account</CardTitle>
              <CardDescription>
                Account lifecycle is a security decision, authorized by <code>access.accounts.*</code> permissions.
              </CardDescription>
            </div>
            {detail.account ? <AccountStatusBadge status={detail.account.account_status} /> : null}
          </CardHeader>
          <CardContent>
            {!detail.account ? (
              <EmptyState
                icon={KeyRound}
                title="No ERP account"
                description="This employee does not have a login. Provisioning is a separate, audited action."
                action={
                  canProvision && !employmentEnded ? (
                    <Link
                      href={`/administration/users?provision=${employee.id}`}
                      className={cn(buttonVariants({ size: "sm" }))}
                    >
                      Provision an account
                    </Link>
                  ) : null
                }
              />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-x-6 sm:grid-cols-2">
                  <Row label="Account status" value={<AccountStatusBadge status={detail.account.account_status} />} />
                  <Row label="Status reason" value={detail.account.status_reason ?? "—"} />
                  <Row label="Invited" value={detail.account.invited_at ? formatDateTime(detail.account.invited_at) : "—"} />
                  <Row
                    label="Invitations sent"
                    value={String(detail.account.invitation_count ?? 0)}
                  />
                  <Row label="Activated" value={detail.account.activated_at ? formatDateTime(detail.account.activated_at) : "—"} />
                  <Row
                    label="Sessions revoked"
                    value={detail.account.sessions_revoked_at ? formatDateTime(detail.account.sessions_revoked_at) : "Never"}
                  />
                </div>

                <div>
                  <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-subtle">
                    Role assignments
                  </p>
                  {(detail.account.assignments ?? []).length === 0 ? (
                    <p className="text-xs text-warning-600">
                      No roles assigned. The account can sign in but cannot use any module.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {detail.account.assignments.map((assignment) => (
                        <Badge key={assignment.id} tone={assignment.is_active ? "info" : "neutral"}>
                          {assignment.roles?.name ?? "Unknown"}
                          {assignment.is_active ? "" : " (revoked)"}
                          {assignment.expires_at ? ` · until ${formatDate(assignment.expires_at)}` : ""}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {detail.activity.length > 0 ? (
                  <div>
                    <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-subtle">
                      Recent account activity
                    </p>
                    <ul className="space-y-1 text-xs">
                      {detail.activity.slice(0, 8).map((activity) => (
                        <li key={activity.id} className="flex items-baseline justify-between gap-2">
                          <span className="text-ink-muted">
                            {activity.activity_type.replace(/_/g, " ")}
                            {activity.description ? ` — ${activity.description}` : ""}
                          </span>
                          <span className="shrink-0 text-[0.625rem] text-ink-subtle">
                            {formatRelative(activity.created_at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <Link
                  href={`/administration/users/${detail.account.id}`}
                  className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                >
                  <KeyRound aria-hidden /> Open account management
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "contacts" ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Emergency contacts</CardTitle>
              <CardDescription>
                Only staff with employee-update or audit permission can read these records.
              </CardDescription>
            </div>
            {canUpdate ? <AddEmergencyContactDialog employeeId={employee.id} /> : null}
          </CardHeader>
          <CardContent>
            {detail.contacts.length === 0 ? (
              <p className="text-xs text-ink-subtle">
                No emergency contact recorded.
                {canUpdate ? " Add one so the organisation can reach someone in an emergency." : ""}
              </p>
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Name</TH>
                      <TH>Relationship</TH>
                      <TH>Phone</TH>
                      {canUpdate ? <TH className="text-right">Actions</TH> : null}
                    </TR>
                  </THead>
                  <TBody>
                    {detail.contacts.map((contact) => (
                      <TR key={contact.id}>
                        <TD className="text-xs font-medium">{contact.contact_name}</TD>
                        <TD className="text-xs">{contact.relationship ?? "—"}</TD>
                        <TD className="font-mono text-[0.6875rem]">{contact.phone}</TD>
                        {canUpdate ? (
                          <TD className="text-right">
                            <RemoveEmergencyContactButton id={contact.id} employeeId={employee.id} />
                          </TD>
                        ) : null}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "authority" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Approval authorities</CardTitle>
                <CardDescription>
                  Configured limits this person may approve within. Phase 1 records configuration only — no approval
                  workflow runs yet.
                </CardDescription>
              </div>
              <Link
                href="/governance/authorities"
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                Manage authorities
              </Link>
            </CardHeader>
            <CardContent>
              {detail.authorities.length === 0 ? (
                <p className="text-xs text-ink-subtle">
                  No approval authority has been configured for this employee.
                </p>
              ) : (
                <TableWrapper>
                  <Table>
                    <THead>
                      <TR className="hover:bg-transparent">
                        <TH>Module</TH>
                        <TH>Transaction</TH>
                        <TH>Range</TH>
                        <TH>Scope</TH>
                        <TH>Valid</TH>
                        <TH>Status</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {detail.authorities.map((authority) => (
                        <TR key={authority.id}>
                          <TD className="text-xs">{authority.module}</TD>
                          <TD className="text-xs">{authority.transaction_type}</TD>
                          <TD className="text-xs">
                            {authority.currency_code} {Number(authority.minimum_amount).toLocaleString()} –{" "}
                            {Number(authority.maximum_amount).toLocaleString()}
                          </TD>
                          <TD className="text-xs">{authority.scope_type}</TD>
                          <TD className="text-xs">
                            {formatDate(authority.effective_from)}
                            {authority.effective_until ? ` → ${formatDate(authority.effective_until)}` : " → open"}
                          </TD>
                          <TD>
                            <Badge tone={authority.is_active ? "success" : "neutral"} dot>
                              {authority.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableWrapper>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Delegating to others</CardTitle>
                  <CardDescription>Authority this person has delegated away.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {detail.delegationsOut.length === 0 ? (
                  <p className="text-xs text-ink-subtle">No delegations created.</p>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {detail.delegationsOut.map((delegation) => (
                      <li key={delegation.id} className="flex items-center justify-between gap-2">
                        <span className="text-ink-muted">
                          {delegation.module}/{delegation.transaction_type} up to {delegation.currency_code}{" "}
                          {Number(delegation.delegated_limit).toLocaleString()}
                        </span>
                        <Badge tone={delegation.status === "approved" ? "success" : "neutral"}>
                          {delegation.status.replace(/_/g, " ")}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Receiving delegation</CardTitle>
                  <CardDescription>Authority delegated to this person.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {detail.delegationsIn.length === 0 ? (
                  <p className="text-xs text-ink-subtle">No delegation received.</p>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {detail.delegationsIn.map((delegation) => (
                      <li key={delegation.id} className="flex items-center justify-between gap-2">
                        <span className="text-ink-muted">
                          {delegation.module}/{delegation.transaction_type} up to {delegation.currency_code}{" "}
                          {Number(delegation.delegated_limit).toLocaleString()}
                        </span>
                        <Badge tone={delegation.status === "approved" ? "success" : "neutral"}>
                          {delegation.status.replace(/_/g, " ")}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "history" && canViewHistory ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Organisational history</CardTitle>
              <CardDescription>
                Written automatically whenever department, position, supervisor or employment status changes.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {detail.history.length === 0 ? (
              <p className="text-xs text-ink-subtle">No recorded changes yet.</p>
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Effective from</TH>
                      <TH>Department</TH>
                      <TH>Position</TH>
                      <TH>Supervisor</TH>
                      <TH>Status</TH>
                      <TH>Reason</TH>
                      <TH>Recorded</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {detail.history.map((entry) => (
                      <TR key={entry.id}>
                        <TD className="text-xs">{formatDate(entry.effective_from)}</TD>
                        <TD className="text-xs">{entry.department?.name ?? "—"}</TD>
                        <TD className="text-xs">{entry.position?.title ?? "—"}</TD>
                        <TD className="text-xs">
                          {entry.supervisor ? `${entry.supervisor.first_name} ${entry.supervisor.last_name}` : "—"}
                        </TD>
                        <TD className="text-xs">{entry.employment_status ?? "—"}</TD>
                        <TD className="text-xs">{entry.reason ?? "—"}</TD>
                        <TD className="text-[0.6875rem] text-ink-subtle">{formatDateTime(entry.created_at)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
