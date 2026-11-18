import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MailPlus, KeyRound, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { AccountStatusBadge, EmploymentStatusBadge } from "@/components/shared/status-badge";
import {
  AccountStatusActions,
  AssignRoleDialog,
  ResendInvitationButton,
  RevokeRoleButton,
  RevokeSessionsButton,
} from "@/components/users/access-controls";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { ACCOUNT_ACTIVITY_LABELS, type AccountStatusValue } from "@/lib/constants/statuses";
import { formatDateTime, formatRelative } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/services/authorization";
import { getRoles } from "@/services/roles/get-roles";
import { getAccountActivityFor, getUserAccount } from "@/services/users/get-users";

export const metadata: Metadata = { title: "User access" };
export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-[0.6875rem] text-ink-subtle">{label}</span>
      <span className="text-right text-xs font-medium text-ink">{value}</span>
    </div>
  );
}

export default async function UserAccessPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission("access.accounts.view");
  const { id } = await params;
  const account = await getUserAccount(id);
  if (!account) notFound();

  const [roles, activity] = await Promise.all([getRoles(), getAccountActivityFor(id)]);
  const isSelf = account.id === principal.user.id;

  const statusPermissions: { status: AccountStatusValue; permission: Parameters<typeof principal.permissions.has>[0] }[] = [
    { status: "active", permission: "access.accounts.activate" },
    { status: "suspended", permission: "access.accounts.suspend" },
    { status: "locked", permission: "access.accounts.suspend" },
    { status: "deactivated", permission: "access.accounts.deactivate" },
  ];
  const allowedStatuses = statusPermissions
    .filter((entry) => principal.permissions.has(entry.permission))
    .map((entry) => entry.status);

  const canInvite = principal.permissions.has("access.accounts.invite");
  const canRevokeSessions = principal.permissions.has("access.accounts.revoke");
  const canAssignRoles = principal.permissions.has("access.assignments.manage");

  const activeCodes = account.assignments
    .filter((assignment) => assignment.is_active)
    .map((assignment) => assignment.roles?.code ?? "");

  return (
    <div>
      <PageHeader
        title={account.display_name ?? "User account"}
        description="Account lifecycle, sessions and role assignments. Every change is authorized server-side and written to the audit trail."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administration" },
          { label: "Users & access", href: "/administration/users" },
          { label: "Manage" },
        ]}
        actions={
          <Link href="/administration/users" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            <ArrowLeft aria-hidden /> Back to list
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Account</CardTitle>
              <CardDescription>Auth identity and linked employee</CardDescription>
            </div>
            <AccountStatusBadge status={account.account_status} />
          </CardHeader>
          <CardContent className="space-y-2">
            <Row label="Display name" value={account.display_name ?? "—"} />
            <Row
              label="Employee"
              value={
                account.employee ? (
                  <Link href={`/administration/employees/${account.employee.id}`} className="hover:underline">
                    {account.employee.first_name} {account.employee.last_name}
                  </Link>
                ) : (
                  "Not linked"
                )
              }
            />
            <Row label="Employee number" value={account.employee?.employee_number ?? "—"} />
            <Row
              label="Employment status"
              value={account.employee ? <EmploymentStatusBadge status={account.employee.employment_status} /> : "—"}
            />
            <Row label="Status reason" value={account.status_reason ?? "—"} />
            <Row label="Invited" value={account.invited_at ? formatDateTime(account.invited_at) : "—"} />
            <Row label="Invitations sent" value={String(account.invitation_count ?? 0)} />
            <Row label="Last sign-in" value={account.last_login_at ? formatRelative(account.last_login_at) : "Never"} />
            <Row
              label="Sessions revoked"
              value={account.sessions_revoked_at ? formatDateTime(account.sessions_revoked_at) : "Never"}
            />
            <Row label="Auth user id" value={<span className="font-mono text-[0.625rem]">{account.id}</span>} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Lifecycle actions</CardTitle>
              <CardDescription>
                Statuses follow a fixed path; the database rejects any illegal jump even if the UI is bypassed.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isSelf ? (
              <p className="rounded-md border border-pending-600/30 bg-pending-50 px-3 py-2 text-[0.6875rem] text-pending-700">
                <ShieldAlert className="mr-1 inline size-3.5" aria-hidden />
                This is your own account. You cannot change its status or roles — another administrator must do it.
              </p>
            ) : null}

            {!isSelf ? (
              <AccountStatusActions
                userId={account.id}
                currentStatus={account.account_status}
                allowed={allowedStatuses}
              />
            ) : null}

            <div className="flex flex-wrap gap-2">
              {canInvite && !isSelf && account.account_status !== "deactivated" ? (
                <ResendInvitationButton userId={account.id} />
              ) : null}
              {canRevokeSessions ? <RevokeSessionsButton userId={account.id} /> : null}
            </div>

            <p className="text-[0.6875rem] text-ink-subtle">
              Suspending, locking or deactivating an account blocks sign-in on the very next request. Revoking sessions
              invalidates tokens issued before the revocation, without changing the account status.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Role assignments</CardTitle>
              <CardDescription>Multiple roles combine their permissions.</CardDescription>
            </div>
            {canAssignRoles && !isSelf ? (
              <AssignRoleDialog userId={account.id} roles={roles} availableRoles={activeCodes} />
            ) : null}
          </CardHeader>
          <CardContent>
            {account.assignments.length === 0 ? (
              <EmptyState
                icon={KeyRound}
                title="No roles assigned"
                description="This account can sign in but has no access to any module."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <TH>Role</TH>
                      <TH>Assigned</TH>
                      <TH>Expires</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {account.assignments.map((assignment) => (
                      <TR key={assignment.id}>
                        <TD className="text-xs">
                          <span className="font-medium">{assignment.roles?.name ?? "Unknown"}</span>
                          <span className="block font-mono text-[0.625rem] text-ink-subtle">
                            {assignment.roles?.code ?? ""}
                          </span>
                        </TD>
                        <TD className="text-[0.6875rem] text-ink-muted">{formatDateTime(assignment.assigned_at)}</TD>
                        <TD className="text-xs">{assignment.expires_at ? formatDateTime(assignment.expires_at) : "Open"}</TD>
                        <TD>
                          <Badge tone={assignment.is_active ? "success" : "neutral"} dot>
                            {assignment.is_active ? "Active" : "Revoked"}
                          </Badge>
                        </TD>
                        <TD className="text-right">
                          {assignment.is_active && canAssignRoles && !isSelf ? (
                            <RevokeRoleButton
                              assignmentId={assignment.id}
                              roleName={assignment.roles?.name ?? "role"}
                            />
                          ) : null}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Account activity</CardTitle>
              <CardDescription>Lifecycle telemetry for this account.</CardDescription>
            </div>
            <Badge tone="neutral">{activity.length}</Badge>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-xs text-ink-subtle">No account activity recorded yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {activity.map((entry) => (
                  <li key={entry.id} className="flex items-start justify-between gap-3 border-b border-border/60 pb-1.5 last:border-0">
                    <div>
                      <p className="text-xs font-medium text-ink">
                        {ACCOUNT_ACTIVITY_LABELS[entry.activity_type as keyof typeof ACCOUNT_ACTIVITY_LABELS] ??
                          entry.activity_type.replace(/_/g, " ")}
                      </p>
                      {entry.description ? (
                        <p className="text-[0.6875rem] text-ink-muted">{entry.description}</p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-[0.625rem] text-ink-subtle">
                      {formatRelative(entry.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {!canInvite && account.account_status === "invited" ? (
        <p className="mt-3 flex items-center gap-1.5 text-[0.6875rem] text-ink-subtle">
          <MailPlus className="size-3.5" aria-hidden />
          Re-sending an invitation requires <code className="rounded bg-surface-sunken px-1">access.accounts.invite</code>.
        </p>
      ) : null}
    </div>
  );
}
