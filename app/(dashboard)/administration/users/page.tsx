import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { Pagination } from "@/components/shared/pagination";
import { AccountStatusBadge } from "@/components/shared/status-badge";
import { ProvisionAccountDialog } from "@/components/users/access-controls";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { ACCOUNT_STATUSES, ACCOUNT_STATUS_LABELS } from "@/lib/constants/statuses";
import { formatDateTime, formatRelative } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/services/authorization";
import { getRoles } from "@/services/roles/get-roles";
import { getUnlinkedEmployees, getUserAccountsPage } from "@/services/users/get-users";
import type { PageSearchParams } from "@/types/common.types";

export const metadata: Metadata = { title: "Users & access" };
export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function UsersPage({ searchParams }: { searchParams: PageSearchParams }) {
  const principal = await requirePermission("access.accounts.view");

  const params = await searchParams;
  const search = single(params.search) ?? "";
  const status = single(params.status) ?? "";
  const roleFilter = single(params.role) ?? "";
  const roleId = single(params.roleId) ?? "";
  const provisionEmployeeId = single(params.provision) ?? "";
  const page = Number(single(params.page) ?? "1") || 1;

  const [accounts, roles, unlinkedEmployees] = await Promise.all([
    getUserAccountsPage({ search, status, role: roleFilter, roleId, page, pageSize: 20 }),
    getRoles(),
    getUnlinkedEmployees(),
  ]);

  const canInvite = principal.permissions.has("access.accounts.invite");

  return (
    <div>
      <PageHeader
        title="Users & access"
        description="ERP accounts, their lifecycle status and role assignments. An employee record is not a login: accounts are provisioned deliberately and can be suspended or deactivated at any time."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administration" }, { label: "Users & access" }]}
        actions={
          canInvite ? (
            <ProvisionAccountDialog
              employees={unlinkedEmployees.map((employee) => ({
                id: employee.id,
                employee_number: employee.employee_number,
                first_name: employee.first_name,
                last_name: employee.last_name,
                email: employee.email,
              }))}
              roles={roles}
              defaultEmployeeId={provisionEmployeeId || undefined}
            />
          ) : null
        }
      />

      <div className="erp-card overflow-hidden">
        <FilterBar
          action="/administration/users"
          fields={[
            {
              type: "search",
              name: "search",
              label: "Search",
              placeholder: "Account display name",
              defaultValue: search,
            },
            {
              type: "select",
              name: "status",
              label: "Account status",
              defaultValue: status,
              options: [
                { value: "", label: "All statuses" },
                ...ACCOUNT_STATUSES.map((value) => ({ value, label: ACCOUNT_STATUS_LABELS[value] })),
              ],
            },
            {
              type: "select",
              name: "roleId",
              label: "Role",
              defaultValue: roleId,
              options: [
                { value: "", label: "All roles" },
                { value: "none", label: "No role assigned" },
                ...roles.map((role) => ({ value: role.id, label: role.name })),
              ],
            },
          ]}
        />

        {accounts.rows.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={search || status || roleId ? "No accounts match those filters" : "No ERP accounts yet"}
            description={
              canInvite
                ? "Provision an account for an employee. Supabase sends the invitation; no password is handled by this application."
                : "An administrator with access.accounts.invite permission provisions ERP accounts."
            }
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>User</TH>
                    <TH>Employee</TH>
                    <TH>Roles</TH>
                    <TH>Status</TH>
                    <TH>Last sign-in</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {accounts.rows.map((account) => {
                    const activeRoles = account.assignments.filter(
                      (assignment) =>
                        assignment.is_active &&
                        (!assignment.expires_at || new Date(assignment.expires_at) > new Date()),
                    );
                    return (
                      <TR key={account.id}>
                        <TD>
                          <Link
                            href={`/administration/users/${account.id}`}
                            className="text-xs font-semibold text-ink hover:text-brand-700 hover:underline"
                          >
                            {account.display_name ?? "Unnamed account"}
                          </Link>
                          <p className="font-mono text-[0.6875rem] text-ink-subtle">{account.id.slice(0, 8)}…</p>
                        </TD>
                        <TD className="text-xs">
                          {account.employee ? (
                            <Link
                              href={`/administration/employees/${account.employee.id}`}
                              className="hover:underline"
                            >
                              <span className="font-medium text-ink">
                                {account.employee.first_name} {account.employee.last_name}
                              </span>
                              <span className="block text-[0.6875rem] text-ink-subtle">
                                {account.employee.employee_number}
                              </span>
                            </Link>
                          ) : (
                            <span className="text-ink-subtle">Not linked</span>
                          )}
                        </TD>
                        <TD>
                          <div className="flex flex-wrap gap-1">
                            {activeRoles.length === 0 ? (
                              <Badge tone="warning" dot>
                                No role
                              </Badge>
                            ) : (
                              activeRoles.map((assignment) => (
                                <Badge key={assignment.id} tone="info">
                                  {assignment.roles?.name ?? "Unknown"}
                                </Badge>
                              ))
                            )}
                          </div>
                        </TD>
                        <TD>
                          <AccountStatusBadge status={account.account_status} />
                        </TD>
                        <TD className="text-xs text-ink-muted">
                          {account.last_login_at ? (
                            <span title={formatDateTime(account.last_login_at)}>
                              {formatRelative(account.last_login_at)}
                            </span>
                          ) : (
                            "Never"
                          )}
                        </TD>
                        <TD className="text-right">
                          <Link
                            href={`/administration/users/${account.id}`}
                            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                          >
                            <KeyRound aria-hidden /> Manage
                          </Link>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrapper>

            <Pagination
              page={accounts.page}
              pageSize={accounts.pageSize}
              total={accounts.total}
              baseHref="/administration/users"
              params={{ search, status, roleId }}
            />
          </>
        )}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[0.6875rem] text-ink-subtle">
        <ShieldAlert className="size-3.5" aria-hidden />
        An account whose status is not <strong>Active</strong> cannot sign in: every request re-checks the lifecycle
        status and session revocation stamp server-side.
      </p>
    </div>
  );
}
