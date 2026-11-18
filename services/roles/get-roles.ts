import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Role } from "@/types/database.types";

export type RoleWithPermissions = Role & {
  role_permissions: {
    permission_id: string;
    scope_type: string;
    permissions: { code: string; module: string; resource: string; action: string } | null;
  }[];
};

export type RoleWithStats = Role & {
  permission_count: number;
  member_count: number;
};

const ROLE_SELECT = "*, role_permissions(permission_id, scope_type, permissions(code, module, resource, action))";

export async function getRolesWithPermissions(): Promise<RoleWithPermissions[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("roles")
    .select(ROLE_SELECT)
    .order("name", { ascending: true })
    .returns<RoleWithPermissions[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getRoleWithPermissions(id: string): Promise<RoleWithPermissions | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("roles")
    .select(ROLE_SELECT)
    .eq("id", id)
    .maybeSingle<RoleWithPermissions>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function getRoles(): Promise<Role[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("roles")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .returns<Role[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Roles plus per-role member counts, for the roles list. */
export async function getRolesWithStats(): Promise<RoleWithStats[]> {
  const supabase = await createSupabaseServerClient();
  const [rolesResult, assignmentsResult] = await Promise.all([
    supabase.from("roles").select(ROLE_SELECT).order("name", { ascending: true }).returns<RoleWithPermissions[]>(),
    supabase
      .from("user_roles")
      .select("role_id, is_active")
      .eq("is_active", true)
      .returns<{ role_id: string; is_active: boolean }[]>(),
  ]);

  if (rolesResult.error) throw new Error(rolesResult.error.message);
  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);

  const memberCounts = new Map<string, number>();
  for (const row of assignmentsResult.data ?? []) {
    memberCounts.set(row.role_id, (memberCounts.get(row.role_id) ?? 0) + 1);
  }

  return (rolesResult.data ?? []).map((role) => ({
    ...role,
    permission_count: role.role_permissions.length,
    member_count: memberCounts.get(role.id) ?? 0,
  }));
}

export async function getRoleMembers(roleId: string): Promise<
  { user_id: string; is_active: boolean; expires_at: string | null; assigned_at: string; profile: { id: string; display_name: string | null; account_status: string } | null }[]
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id, is_active, expires_at, assigned_at, profile:profiles(id, display_name, account_status)")
    .eq("role_id", roleId)
    .returns<
      { user_id: string; is_active: boolean; expires_at: string | null; assigned_at: string; profile: { id: string; display_name: string | null; account_status: string } | null }[]
    >();
  if (error) throw new Error(error.message);
  return data ?? [];
}
