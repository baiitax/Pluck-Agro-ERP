import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { ACCESS_ADMIN_ROLE_CODES } from "@/lib/permissions/definitions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateRolePermissionsSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/services/authorization";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { PermissionScopeName, Role } from "@/types/database.types";

export type RolePermissionDiff = {
  added: string[];
  removed: string[];
  resccoped: { code: string; from: string; to: string }[];
};

/**
 * Replaces a role's permission grants.
 *
 * Guards against self-elevation in three ways:
 *  1. an administrator cannot grant a permission they do not hold themselves (except the
 *     super administrator, who holds everything);
 *  2. an administrator cannot edit a role that grants access-administration rights while
 *     holding that role themselves — otherwise they could widen their own access;
 *  3. every change is audited with before/after codes.
 */
export async function updateRolePermissions(
  input: unknown,
  meta: RequestMeta = {},
): Promise<RolePermissionDiff> {
  const actor = await requirePermission("access.permissions.manage");
  const payload = updateRolePermissionsSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data: role, error: roleError } = await supabase
    .from("roles")
    .select("*")
    .eq("id", payload.roleId)
    .maybeSingle<Role>();
  if (roleError) throw new Error(roleError.message);
  if (!role) throw new AppError("NOT_FOUND", "Role not found.");

  // Guard 2: never widen a role that is currently granting you access.
  const { data: ownAssignments } = await supabase
    .from("user_roles")
    .select("role_id, is_active")
    .eq("user_id", actor.user.id)
    .eq("is_active", true)
    .returns<{ role_id: string; is_active: boolean }[]>();
  const actorHoldsThisRole = (ownAssignments ?? []).some((row) => row.role_id === payload.roleId);
  if (actorHoldsThisRole && !actor.roles.some((role) => role.roleCode === "super_administrator")) {
    throw new AppError(
      "FORBIDDEN",
      "You cannot change the permissions of a role you currently hold. Ask a different administrator.",
    );
  }

  const { data: permissionRows, error: permissionError } = await supabase
    .from("permissions")
    .select("id, code")
    .returns<{ id: string; code: string }[]>();
  if (permissionError) throw new Error(permissionError.message);

  const codeById = new Map((permissionRows ?? []).map((row) => [row.id, row.code]));

  // Guard 1: no granting authority you do not hold.
  const isSuperAdmin = actor.roles.some((assignment) => assignment.roleCode === "super_administrator");
  if (!isSuperAdmin) {
    const unknown = payload.grants.filter((grant) => {
      const code = codeById.get(grant.permissionId);
      return !code || !actor.permissions.has(code as never);
    });
    if (unknown.length > 0) {
      const labels = unknown
        .map((grant) => codeById.get(grant.permissionId) ?? grant.permissionId)
        .slice(0, 3)
        .join(", ");
      throw new AppError("FORBIDDEN", `You cannot grant permissions you do not hold yourself (${labels}…).`);
    }
  }

  // Guard 3 (data): refuse to remove access-administration from the last role that has it.
  const { data: existingGrants, error: readError } = await supabase
    .from("role_permissions")
    .select("permission_id, scope_type")
    .eq("role_id", payload.roleId)
    .returns<{ permission_id: string; scope_type: string }[]>();
  if (readError) throw new Error(readError.message);

  const before = new Map((existingGrants ?? []).map((grant) => [grant.permission_id, grant.scope_type]));
  const after = new Map(payload.grants.map((grant) => [grant.permissionId, grant.scopeType]));

  const added = payload.grants
    .filter((grant) => !before.has(grant.permissionId))
    .map((grant) => codeById.get(grant.permissionId) ?? grant.permissionId);
  const removed = (existingGrants ?? [])
    .filter((grant) => !after.has(grant.permission_id))
    .map((grant) => codeById.get(grant.permission_id) ?? grant.permission_id);
  const rescoped = payload.grants
    .filter((grant) => before.has(grant.permissionId) && before.get(grant.permissionId) !== grant.scopeType)
    .map((grant) => ({
      code: codeById.get(grant.permissionId) ?? grant.permissionId,
      from: String(before.get(grant.permissionId)),
      to: grant.scopeType,
    }));

  const { error: deleteError } = await supabase
    .from("role_permissions")
    .delete()
    .eq("role_id", payload.roleId);
  if (deleteError) throw new Error(deleteError.message);

  if (payload.grants.length > 0) {
    const { error: insertError } = await supabase.from("role_permissions").insert(
      payload.grants.map((grant) => ({
        role_id: payload.roleId,
        permission_id: grant.permissionId,
        scope_type: grant.scopeType as PermissionScopeName,
      })),
    );
    if (insertError) throw new Error(insertError.message);
  }

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "role.permissions_updated",
    eventCategory: "authorization",
    severity: added.length > 0 ? "warning" : "notice",
    module: "access",
    entityType: "role",
    entityId: payload.roleId,
    description: `Updated permissions for role ${role.code}: +${added.length} / -${removed.length}.`,
    oldValues: { permissions: [...before.keys()].map((id) => codeById.get(id) ?? id) },
    newValues: { permissions: [...after.keys()].map((id) => codeById.get(id) ?? id) },
    metadata: { added, removed, rescoped, reason: payload.reason },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/roles");
  revalidatePath(`/administration/roles/${payload.roleId}`);
  revalidatePath("/administration/permissions");
  return { added, removed, resccoped: rescoped };
}

/** True when the account holds any role allowed to administer access. */
export function hasAccessAdministration(roleCodes: string[]): boolean {
  return roleCodes.some((code) => (ACCESS_ADMIN_ROLE_CODES as readonly string[]).includes(code));
}
