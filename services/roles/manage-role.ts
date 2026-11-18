import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { roleCloneSchema, roleCreateSchema, roleDeleteSchema, roleUpdateSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/services/authorization";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { PermissionScopeName, Role } from "@/types/database.types";

function slugCode(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export async function createRole(input: unknown, meta: RequestMeta = {}): Promise<Role> {
  const actor = await requirePermission("access.roles.create");
  const payload = roleCreateSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const code = payload.code?.trim() || slugCode(payload.name);

  const { data, error } = await supabase
    .from("roles")
    .insert({
      name: payload.name.trim(),
      code,
      category: payload.category,
      description: payload.description?.trim() || null,
      is_system_role: false,
      is_active: true,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("*")
    .single<Role>();

  if (error) {
    if (error.code === "23505") throw new AppError("CONFLICT", "That role code is already in use.");
    throw new Error(error.message);
  }

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "role.created",
    eventCategory: "authorization",
    severity: "notice",
    module: "access",
    entityType: "role",
    entityId: data.id,
    description: `Created role ${data.name} (${data.code}).`,
    newValues: { name: data.name, code: data.code, category: data.category },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/roles");
  return data;
}

const SYSTEM_ROLE_NAME_CHANGE_FORBIDDEN_MSG =
  "System role codes are protected. Rename the role or clone it into a custom role instead.";

export async function updateRole(input: unknown, meta: RequestMeta = {}): Promise<Role> {
  const actor = await requirePermission("access.roles.update");
  const payload = roleUpdateSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: readError } = await supabase
    .from("roles")
    .select("*")
    .eq("id", payload.id)
    .maybeSingle<Role>();
  if (readError) throw new Error(readError.message);
  if (!existing) throw new AppError("NOT_FOUND", "Role not found.");

  if (existing.is_system_role && existing.category === "system" && payload.category !== "system") {
    throw new AppError("CONFLICT", SYSTEM_ROLE_NAME_CHANGE_FORBIDDEN_MSG);
  }

  const { data, error } = await supabase
    .from("roles")
    .update({
      name: payload.name.trim(),
      category: payload.category,
      description: payload.description?.trim() || null,
      is_active: payload.isActive,
      updated_by: actor.user.id,
    })
    .eq("id", payload.id)
    .select("*")
    .single<Role>();
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "role.updated",
    eventCategory: "authorization",
    severity: "notice",
    module: "access",
    entityType: "role",
    entityId: data.id,
    description: `Updated role ${data.name} (${data.code}).`,
    oldValues: {
      name: existing.name,
      category: existing.category,
      description: existing.description,
      is_active: existing.is_active,
    },
    newValues: { name: data.name, category: data.category, description: data.description, is_active: data.is_active },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/roles");
  revalidatePath(`/administration/roles/${data.id}`);
  return data;
}

/** Clones a role and its grants into a new custom role. */
export async function cloneRole(input: unknown, meta: RequestMeta = {}): Promise<Role> {
  const actor = await requirePermission("access.roles.create");
  const payload = roleCloneSchema.parse(input);
  const supabase = await createSupabaseServerClient();

  const { data: source, error: sourceError } = await supabase
    .from("roles")
    .select("*, role_permissions(permission_id, scope_type)")
    .eq("id", payload.sourceRoleId)
    .maybeSingle<Role & { role_permissions: { permission_id: string; scope_type: string }[] }>();
  if (sourceError) throw new Error(sourceError.message);
  if (!source) throw new AppError("NOT_FOUND", "Source role not found.");

  const { data: created, error } = await supabase
    .from("roles")
    .insert({
      name: payload.name.trim(),
      code: payload.code.trim(),
      category: "custom",
      description: `Cloned from ${source.name}.`,
      is_system_role: false,
      is_active: true,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("*")
    .single<Role>();
  if (error) {
    if (error.code === "23505") throw new AppError("CONFLICT", "That role code is already in use.");
    throw new Error(error.message);
  }

  const grants = source.role_permissions ?? [];
  if (grants.length > 0) {
    const { error: grantError } = await supabase.from("role_permissions").insert(
      grants.map((grant) => ({
        role_id: created.id,
        permission_id: grant.permission_id,
        scope_type: grant.scope_type as PermissionScopeName,
      })),
    );
    if (grantError) {
      await supabase.from("roles").delete().eq("id", created.id);
      throw new Error(grantError.message);
    }
  }

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "role.cloned",
    eventCategory: "authorization",
    severity: "notice",
    module: "access",
    entityType: "role",
    entityId: created.id,
    description: `Cloned role ${source.code} into ${created.code} with ${grants.length} permission(s).`,
    newValues: { source_role: source.code, code: created.code, permission_count: grants.length },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/roles");
  return created;
}

/**
 * Deletes a custom role with no active assignments. System roles cannot be deleted (enforced by
 * a database trigger as well), and roles with members must be deactivated instead so nobody
 * loses access silently.
 */
export async function deleteRole(input: unknown, meta: RequestMeta = {}): Promise<void> {
  const actor = await requirePermission("access.roles.update");
  const payload = roleDeleteSchema.parse(input);
  const supabase = await createSupabaseServerClient();

  const { data: role, error: readError } = await supabase
    .from("roles")
    .select("*")
    .eq("id", payload.id)
    .maybeSingle<Role>();
  if (readError) throw new Error(readError.message);
  if (!role) throw new AppError("NOT_FOUND", "Role not found.");
  if (role.is_system_role) {
    throw new AppError("CONFLICT", "System roles cannot be deleted. Deactivate it instead.");
  }

  const { data: members } = await supabase
    .from("user_roles")
    .select("id")
    .eq("role_id", payload.id)
    .eq("is_active", true)
    .returns<{ id: string }[]>();
  if ((members ?? []).length > 0) {
    throw new AppError(
      "CONFLICT",
      `This role is assigned to ${members?.length} user(s). Reassign them before deleting it.`,
    );
  }

  const { error } = await supabase.from("roles").delete().eq("id", payload.id);
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "role.deleted",
    eventCategory: "authorization",
    severity: "warning",
    module: "access",
    entityType: "role",
    entityId: payload.id,
    description: `Deleted role ${role.code}. Reason: ${payload.reason}`,
    oldValues: { name: role.name, code: role.code, category: role.category },
    metadata: { reason: payload.reason },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/roles");
}
