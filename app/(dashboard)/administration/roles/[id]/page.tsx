import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CloneRoleDialog, DeleteRoleButton, EditRoleDialog } from "@/components/roles/role-form";
import { PermissionMatrixEditor } from "@/components/roles/permission-matrix";
import { formatDateTime } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/services/authorization";
import { getPermissions } from "@/services/permissions/get-permissions";
import { getRoleMembers, getRoleWithPermissions } from "@/services/roles/get-roles";

export const metadata: Metadata = { title: "Role permissions" };
export const dynamic = "force-dynamic";

export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await requirePermission("access.roles.view");
  const { id } = await params;
  const role = await getRoleWithPermissions(id);
  if (!role) notFound();

  const [permissions, members] = await Promise.all([getPermissions(), getRoleMembers(id)]);

  const canUpdate = principal.permissions.has("access.roles.update");
  const canCreate = principal.permissions.has("access.roles.create");
  const canManagePermissions = principal.permissions.has("access.permissions.manage");
  const holdsThisRole = principal.roles.some((assignment) => assignment.roleId === role.id);
  const isSuperAdmin = principal.roles.some((assignment) => assignment.roleCode === "super_administrator");

  let readOnlyReason: string | undefined;
  if (!canManagePermissions) {
    readOnlyReason = "Editing role permissions requires the access.permissions.manage permission.";
  } else if (holdsThisRole && !isSuperAdmin) {
    readOnlyReason =
      "You currently hold this role, so you cannot widen its permissions yourself. Ask another administrator.";
  }

  return (
    <div>
      <PageHeader
        title={role.name}
        description={role.description ?? "No description recorded for this role."}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administration" },
          { label: "Roles", href: "/administration/roles" },
          { label: role.name },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/administration/roles" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              <ArrowLeft aria-hidden /> Back to roles
            </Link>
            {canCreate ? (
              <CloneRoleDialog
                role={{
                  id: role.id,
                  name: role.name,
                  code: role.code,
                  category: role.category,
                  description: role.description,
                  is_active: role.is_active,
                  is_system_role: role.is_system_role,
                }}
              />
            ) : null}
            {canUpdate ? (
              <EditRoleDialog
                role={{
                  id: role.id,
                  name: role.name,
                  code: role.code,
                  category: role.category,
                  description: role.description,
                  is_active: role.is_active,
                  is_system_role: role.is_system_role,
                }}
              />
            ) : null}
            {canUpdate ? (
              <DeleteRoleButton roleId={role.id} name={role.name} disabled={role.is_system_role} />
            ) : null}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="neutral" className="font-mono">
          {role.code}
        </Badge>
        <Badge tone={role.is_system_role ? "brand" : "neutral"}>
          {role.is_system_role ? "System role" : "Custom role"}
        </Badge>
        <Badge tone={role.is_active ? "success" : "neutral"} dot>
          {role.is_active ? "Active" : "Inactive"}
        </Badge>
        <Badge tone="info">{role.category.replace(/_/g, " ")}</Badge>
        <span className="text-[0.6875rem] text-ink-subtle">Created {formatDateTime(role.created_at)}</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        <Card className="xl:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Permission matrix</CardTitle>
              <CardDescription>
                Every permission this role grants, with its scope. Saving replaces the full set in one transaction and
                is written to the audit trail with the added and removed codes.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <PermissionMatrixEditor
              roleId={role.id}
              roleName={role.name}
              permissions={permissions.map((permission) => ({ id: permission.id, code: permission.code }))}
              initialGrants={role.role_permissions
                .filter((grant) => grant.permissions?.code)
                .map((grant) => ({ code: grant.permissions?.code ?? "", scopeType: grant.scope_type }))}
              currentUserPermissions={[...principal.permissions]}
              readOnlyReason={readOnlyReason}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Members</CardTitle>
              <CardDescription>{members.length} assignment(s)</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <p className="text-xs text-ink-subtle">Nobody holds this role.</p>
            ) : (
              <ul className="space-y-1.5">
                {members.map((member) => (
                  <li key={member.user_id} className="flex items-center justify-between gap-2 text-xs">
                    <Link
                      href={`/administration/users/${member.user_id}`}
                      className="truncate font-medium text-ink hover:text-brand-700 hover:underline"
                    >
                      {member.profile?.display_name ?? member.user_id.slice(0, 8)}
                    </Link>
                    <Badge tone={member.is_active ? "success" : "neutral"} dot>
                      {member.is_active ? "Active" : "Revoked"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
