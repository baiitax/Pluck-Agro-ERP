import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { PermissionsMatrix, type MatrixRole } from "@/components/tables/permissions-table";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/definitions";
import { requirePermission } from "@/services/authorization";
import { getRolesWithPermissions } from "@/services/roles/get-roles";

export const metadata: Metadata = { title: "Permission matrix" };
export const dynamic = "force-dynamic";

export default async function PermissionsPage() {
  const principal = await requirePermission("access.permissions.view");
  const roles = await getRolesWithPermissions();

  const matrixRoles: MatrixRole[] = roles.map((role) => ({
    id: role.id,
    name: role.name,
    code: role.code,
    is_active: role.is_active,
    grants: new Map(
      role.role_permissions
        .filter((grant) => grant.permissions?.code)
        .map((grant) => [grant.permissions?.code ?? "", grant.scope_type]),
    ),
  }));

  const activeRoles = matrixRoles.filter((role) => role.is_active);

  return (
    <div>
      <PageHeader
        title="Permission matrix"
        description="Every permission in module.resource.action form against every role. Codes are controlled system data: they cannot be created or deleted at runtime, only granted and revoked."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administration" },
          { label: "Permission matrix" },
        ]}
      />

      <div className="mb-3 flex flex-wrap items-center gap-3 text-[0.6875rem] text-ink-subtle">
        <span>{ALL_PERMISSION_CODES.length} permissions</span>
        <span>·</span>
        <span>{matrixRoles.length} roles ({activeRoles.length} active)</span>
        <span>·</span>
        <span>
          A global grant shows a tick; a scoped grant shows its scope. Scopes are enforced by database policies.
        </span>
      </div>

      <div className="erp-card overflow-hidden">
        <PermissionsMatrix roles={activeRoles} />
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        Editing happens on each role&apos;s page, where the change requires a justification and is written to the audit
        trail. You cannot grant a permission you do not hold yourself
        {principal.roles.some((role) => role.roleCode === "super_administrator")
          ? " — except as super administrator."
          : "."}
      </p>
    </div>
  );
}
