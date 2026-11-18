import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isPermissionCode, type PermissionCode } from "@/lib/permissions/definitions";
import type { AuthResolution, AuthenticatedUser, SessionUser } from "@/types/auth.types";
import type { RoleAssignment } from "@/types/permission.types";
import type { Employee, Profile } from "@/types/database.types";

type RoleRow = { id: string; code: string; name: string; is_active: boolean };

/**
 * Resolves the current Supabase Auth user into an ERP principal.
 *
 * A valid Supabase session alone is never sufficient: the user must also have a profile,
 * an active profile, an active employee record (when linked) and at least one active role
 * granting at least one permission. Anything else is treated as unauthenticated.
 */
export async function resolveCurrentPrincipal(): Promise<AuthResolution> {
  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return {
      status: "unauthenticated",
      reason: "no_session",
      message: "Please sign in to continue.",
    };
  }

  const authUser = authData.user;
  const sessionUser: SessionUser = {
    id: authUser.id,
    email: authUser.email ?? "",
    emailConfirmedAt: authUser.email_confirmed_at ?? null,
    lastSignInAt: authUser.last_sign_in_at ?? null,
  };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", authUser.id)
    .maybeSingle<Profile>();

  if (profileError) {
    console.error("[pluck-erp] profile resolution failed", profileError.message);
    return {
      status: "unauthenticated",
      reason: "configuration_error",
      message: "We could not load your ERP profile. Please contact a system administrator.",
    };
  }

  if (!profile) {
    return {
      status: "unauthenticated",
      reason: "no_profile",
      message: "No ERP profile is linked to this account. Please contact a system administrator.",
    };
  }

  // The account lifecycle gate. `is_active` is derived from `account_status` in the database,
  // so checking the detailed status gives the user a precise, honest explanation.
  if (profile.account_status !== "active") {
    if (profile.account_status === "invited" || profile.account_status === "pending_setup") {
      return {
        status: "unauthenticated",
        reason: "pending_account",
        message: "Your invitation has not been completed yet. Follow the link in your invitation email to set a password.",
      };
    }
    return {
      status: "unauthenticated",
      reason: "inactive_profile",
      message:
        profile.account_status === "suspended"
          ? "This ERP account is suspended. Please contact a system administrator."
          : profile.account_status === "locked"
            ? "This ERP account is locked. Please contact a system administrator."
            : "This ERP account has been deactivated. Please contact a system administrator.",
    };
  }

  // Application-level session revocation: a stamp newer than the session's sign-in time means
  // every existing session for this account has been revoked.
  if (
    profile.sessions_valid_after &&
    sessionUser.lastSignInAt &&
    new Date(sessionUser.lastSignInAt).getTime() < new Date(profile.sessions_valid_after).getTime()
  ) {
    return {
      status: "unauthenticated",
      reason: "sessions_revoked",
      message: "Your sessions were revoked by an administrator. Please sign in again.",
    };
  }

  let employee: Employee | null = null;
  if (profile.employee_id) {
    const { data: employeeRow } = await supabase
      .from("employees")
      .select("*")
      .eq("id", profile.employee_id)
      .maybeSingle<Employee>();
    employee = employeeRow ?? null;
  }

  if (
    employee &&
    (employee.employment_status === "terminated" ||
      employee.employment_status === "suspended" ||
      employee.employment_status === "resigned" ||
      employee.employment_status === "retired")
  ) {
    return {
      status: "unauthenticated",
      reason: "inactive_employee",
      message: "Your employee record is not active. Please contact a system administrator.",
    };
  }

  const { roles, permissions } = await loadRoleAssignments(supabase, authUser.id);

  const principal: AuthenticatedUser = {
    user: sessionUser,
    profile,
    employee,
    roles,
    permissions,
  };

  return { status: "authenticated", principal };
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function loadRoleAssignments(
  supabase: ServerClient,
  userId: string,
): Promise<{ roles: RoleAssignment[]; permissions: Set<PermissionCode> }> {
  const { data: assignments } = await supabase
    .from("user_roles")
    .select("id, role_id, user_id, assigned_at, assigned_by, expires_at, is_active")
    .eq("user_id", userId)
    .eq("is_active", true);

  const now = Date.now();
  const liveAssignments = (assignments ?? []).filter((assignment) => {
    if (!assignment.expires_at) return true;
    return new Date(assignment.expires_at).getTime() > now;
  });

  if (liveAssignments.length === 0) {
    return { roles: [], permissions: new Set() };
  }

  const roleIds = [...new Set(liveAssignments.map((assignment) => assignment.role_id))];

  const { data: roleRows } = await supabase
    .from("roles")
    .select("id, code, name, is_active")
    .in("id", roleIds)
    .eq("is_active", true)
    .returns<RoleRow[]>();

  const activeRoles = roleRows ?? [];
  const activeRoleIds = activeRoles.map((role) => role.id);

  const roles: RoleAssignment[] = liveAssignments
    .filter((assignment) => activeRoleIds.includes(assignment.role_id))
    .map((assignment) => {
      const role = activeRoles.find((candidate) => candidate.id === assignment.role_id);
      return {
        id: assignment.id,
        roleId: assignment.role_id,
        roleCode: role?.code ?? "unknown",
        roleName: role?.name ?? "Unknown role",
        assignedAt: assignment.assigned_at,
        assignedBy: assignment.assigned_by,
        expiresAt: assignment.expires_at,
        isActive: assignment.is_active,
      };
    });

  // Every granted code is included regardless of scope: `permissions` drives navigation and
  // UI affordances, while data-level scoping (DEPARTMENT, WAREHOUSE, OWN_RECORDS, …) is
  // enforced by Row Level Security through `private.has_scoped_permission()`. A scoped grant
  // must never silently disappear from the UI.
  const permissions = new Set<PermissionCode>();
  if (activeRoleIds.length > 0) {
    const { data: rolePermissionRows } = await supabase
      .from("role_permissions")
      .select("role_id, permission_id")
      .in("role_id", activeRoleIds);

    const permissionIds = [...new Set((rolePermissionRows ?? []).map((row) => row.permission_id))];

    if (permissionIds.length > 0) {
      const { data: permissionRows } = await supabase
        .from("permissions")
        .select("id, code")
        .in("id", permissionIds);

      for (const permission of permissionRows ?? []) {
        if (isPermissionCode(permission.code)) {
          permissions.add(permission.code);
        }
      }
    }
  }

  return { roles, permissions };
}
