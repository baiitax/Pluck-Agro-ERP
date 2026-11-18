import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assignRoleSchema, revokeRoleSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/services/authorization";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { Role, UserRole } from "@/types/database.types";

async function permissionsGrantedByRole(roleId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("role_permissions")
    .select("permission_id, permissions(code)")
    .eq("role_id", roleId)
    .returns<{ permission_id: string; permissions: { code: string } | null }[]>();
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.permissions?.code ?? "").filter(Boolean);
}

/**
 * Assigns a role to an ERP account.
 *
 * Self-elevation is blocked three times over: you cannot change your own assignments, you cannot
 * grant a role that carries permissions you do not hold, and the database records the change.
 */
export async function assignRole(input: unknown, meta: RequestMeta = {}): Promise<UserRole> {
  const actor = await requirePermission("access.assignments.manage");
  const payload = assignRoleSchema.parse(input);

  if (payload.userId === actor.user.id) {
    throw new AppError(
      "FORBIDDEN",
      "You cannot change your own role assignments. Ask another administrator.",
    );
  }

  const supabase = await createSupabaseServerClient();

  const { data: role, error: roleError } = await supabase
    .from("roles")
    .select("*")
    .eq("id", payload.roleId)
    .maybeSingle<Role>();
  if (roleError) throw new Error(roleError.message);
  if (!role) throw new AppError("NOT_FOUND", "That role does not exist.");
  if (!role.is_active) throw new AppError("CONFLICT", "That role is inactive.");

  const rolePermissions = await permissionsGrantedByRole(role.id);
  const missing = rolePermissions.filter((code) => !actor.permissions.has(code as never));
  if (missing.length > 0) {
    throw new AppError(
      "FORBIDDEN",
      `You cannot assign a role that grants permissions you do not hold (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}).`,
    );
  }

  const { data: targetProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id, account_status")
    .eq("id", payload.userId)
    .maybeSingle<{ id: string; account_status: string }>();
  if (profileError) throw new Error(profileError.message);
  if (!targetProfile) throw new AppError("NOT_FOUND", "That user account does not exist.");
  if (targetProfile.account_status === "deactivated") {
    throw new AppError("CONFLICT", "A deactivated account cannot receive new roles.");
  }

  const { data: existing } = await supabase
    .from("user_roles")
    .select("id, is_active")
    .eq("user_id", payload.userId)
    .eq("role_id", payload.roleId)
    .maybeSingle<{ id: string; is_active: boolean }>();

  if (existing?.is_active) {
    throw new AppError("CONFLICT", "This user already holds that role.");
  }

  const expiresAt = payload.expiresAt ? new Date(`${payload.expiresAt}T23:59:59Z`).toISOString() : null;
  const now = new Date().toISOString();

  const { data, error } = existing
    ? await supabase
        .from("user_roles")
        .update({ is_active: true, expires_at: expiresAt, assigned_by: actor.user.id, assigned_at: now })
        .eq("id", existing.id)
        .select("*")
        .single<UserRole>()
    : await supabase
        .from("user_roles")
        .insert({
          user_id: payload.userId,
          role_id: payload.roleId,
          is_active: true,
          expires_at: expiresAt,
          assigned_by: actor.user.id,
          assigned_at: now,
        })
        .select("*")
        .single<UserRole>();

  if (error) throw new Error(error.message);

  await createSupabaseAdminClient()
    .from("account_activity")
    .insert({
      user_id: payload.userId,
      activity_type: "role_assigned",
      description: `Role "${role.name}" assigned.`,
      ip_address: meta.ipAddress ?? null,
      user_agent: meta.userAgent ?? null,
    });

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "user.role_assigned",
    eventCategory: "authorization",
    severity: "warning",
    module: "access",
    entityType: "user_role",
    entityId: data.id,
    description: `Assigned role "${role.name}" (${role.code}) to user ${payload.userId}.`,
    newValues: { user_id: payload.userId, role_code: role.code, expires_at: expiresAt },
    metadata: { permission_count: rolePermissions.length },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/users");
  revalidatePath(`/administration/users/${payload.userId}`);
  return data;
}

/** Deactivates a role assignment (never hard-deletes, to preserve history). */
export async function revokeRole(input: unknown, meta: RequestMeta = {}): Promise<UserRole> {
  const actor = await requirePermission("access.assignments.manage");
  const payload = revokeRoleSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data: assignment, error: readError } = await supabase
    .from("user_roles")
    .select("*, roles(code, name)")
    .eq("id", payload.assignmentId)
    .maybeSingle<UserRole & { roles: { code: string; name: string } | null }>();
  if (readError) throw new Error(readError.message);
  if (!assignment) throw new AppError("NOT_FOUND", "That role assignment does not exist.");

  if (assignment.user_id === actor.user.id) {
    throw new AppError(
      "FORBIDDEN",
      "You cannot revoke your own role assignments. Ask another administrator.",
    );
  }

  // Never strip access administration from the last account that holds it.
  const roleCode = assignment.roles?.code ?? "";
  if (roleCode === "super_administrator") {
    const { data: roleRow } = await supabase
      .from("roles")
      .select("id")
      .eq("code", "super_administrator")
      .maybeSingle<{ id: string }>();
    if (roleRow) {
      const { data: holders } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role_id", roleRow.id)
        .eq("is_active", true)
        .returns<{ user_id: string }[]>();
      if ((holders ?? []).length <= 1) {
        throw new AppError(
          "CONFLICT",
          "This is the last active super administrator assignment. Assign the role to another account first.",
        );
      }
    }
  }

  const { data, error } = await supabase
    .from("user_roles")
    .update({ is_active: false })
    .eq("id", payload.assignmentId)
    .select("*")
    .single<UserRole>();
  if (error) throw new Error(error.message);

  await createSupabaseAdminClient()
    .from("account_activity")
    .insert({ user_id: assignment.user_id, activity_type: "role_revoked", description: "Role assignment revoked." });

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "user.role_revoked",
    eventCategory: "authorization",
    severity: "warning",
    module: "access",
    entityType: "user_role",
    entityId: assignment.id,
    description: `Revoked role assignment for user ${assignment.user_id}.${payload.reason ? ` Reason: ${payload.reason}` : ""}`,
    oldValues: { user_id: assignment.user_id, role_id: assignment.role_id, is_active: true },
    newValues: { is_active: false },
    metadata: payload.reason ? { reason: payload.reason } : null,
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/users");
  revalidatePath(`/administration/users/${assignment.user_id}`);
  return data;
}
