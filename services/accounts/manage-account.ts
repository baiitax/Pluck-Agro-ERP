import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_TRANSITIONS,
  canTransitionAccountStatus,
  type AccountStatusValue,
} from "@/lib/constants/statuses";
import { isPermissionCode, type PermissionCode } from "@/lib/permissions/definitions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  provisionAccountSchema,
  resendInvitationSchema,
  revokeSessionsSchema,
  updateAccountStatusSchema,
} from "@/lib/validation/schemas";
import { requirePermission } from "@/services/authorization";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { AccountActivity, Employee, Profile, Role, UserRole } from "@/types/database.types";

/**
 * Status → permission required.
 * Each lifecycle move has its own granular permission so "may invite" never implies
 * "may deactivate".
 */
const STATUS_PERMISSION: Record<AccountStatusValue, PermissionCode> = {
  invited: "access.accounts.invite",
  pending_setup: "access.accounts.invite",
  active: "access.accounts.activate",
  suspended: "access.accounts.suspend",
  deactivated: "access.accounts.deactivate",
  locked: "access.accounts.suspend",
};

function logActivity(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  entry: { userId: string; activityType: string; description: string; meta?: RequestMeta },
): Promise<void> {
  // Telemetry failures must never break the lifecycle operation itself, but they are logged.
  return Promise.resolve(
    admin.from("account_activity").insert({
      user_id: entry.userId,
      activity_type: entry.activityType,
      description: entry.description,
      ip_address: entry.meta?.ipAddress ?? null,
      user_agent: entry.meta?.userAgent ?? null,
    }),
  ).then(({ error }: { error: { message: string } | null }) => {
    if (error) console.error("[pluck-erp] account activity write failed", error.message);
  });
}

/** Permission set granted by a set of roles — used to stop privilege escalation. */
async function permissionsGrantedByRoles(roleIds: string[]): Promise<Set<string>> {
  const supabase = await createSupabaseServerClient();
  const { data: grants, error } = await supabase
    .from("role_permissions")
    .select("permission_id, permissions(code)")
    .in("role_id", roleIds)
    .returns<{ permission_id: string; permissions: { code: string } | null }[]>();
  if (error) throw new Error(error.message);

  const codes = new Set<string>();
  for (const grant of grants ?? []) {
    if (grant.permissions?.code) codes.add(grant.permissions.code);
  }
  return codes;
}

/**
 * Prevents privilege escalation: an administrator may only grant roles whose permissions they
 * already hold themselves. `super_administrator` bypasses this by definition (it holds every
 * permission), so no special case is needed.
 */
async function assertGrantWithinOwnPermissions(
  actorPermissions: Set<string>,
  roleIds: string[],
): Promise<void> {
  const granted = await permissionsGrantedByRoles(roleIds);
  const missing = [...granted].filter((code) => !actorPermissions.has(code));
  if (missing.length > 0) {
    throw new AppError(
      "FORBIDDEN",
      `You cannot grant permissions you do not hold yourself (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}).`,
    );
  }
}

export type ProvisionAccountResult = {
  profile: Profile;
  assignments: UserRole[];
  invitationSent: boolean;
  invitationWarning?: string;
};

/**
 * Provisions an ERP account for an existing employee.
 *
 * Order of operations matters: the Auth invitation is sent first, then the profile row and role
 * assignments are created. If profile creation fails the auth user is deleted again, so a stray
 * auth identity can never exist without an ERP profile (which would be an unmanaged account).
 * Passwords are never generated, logged or returned: Supabase sends the invitation link.
 */
export async function provisionAccount(
  input: unknown,
  meta: RequestMeta = {},
): Promise<ProvisionAccountResult> {
  const actor = await requirePermission("access.accounts.invite");
  const payload = provisionAccountSchema.parse(input);
  const supabase = await createSupabaseServerClient();

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("*")
    .eq("id", payload.employeeId)
    .maybeSingle<Employee>();
  if (employeeError) throw new Error(employeeError.message);
  if (!employee) throw new AppError("NOT_FOUND", "That employee does not exist.");
  if (["resigned", "terminated", "retired"].includes(employee.employment_status)) {
    throw new AppError("CONFLICT", "This employee's employment has ended; an ERP account cannot be provisioned.");
  }

  const email = (payload.email || employee.email || "").trim().toLowerCase();
  if (!email) {
    throw new AppError("VALIDATION_ERROR", "This employee has no email address. Add one, or supply an email for the account.");
  }

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("employee_id", employee.id)
    .maybeSingle<{ id: string }>();
  if (existingProfile) {
    throw new AppError("CONFLICT", "This employee already has an ERP account.");
  }

  const { data: roles, error: roleError } = await supabase
    .from("roles")
    .select("*")
    .in("id", payload.roleIds)
    .returns<Role[]>();
  if (roleError) throw new Error(roleError.message);
  if ((roles ?? []).length !== payload.roleIds.length) {
    throw new AppError("NOT_FOUND", "One or more selected roles no longer exist.");
  }
  const inactiveRole = (roles ?? []).find((role) => !role.is_active);
  if (inactiveRole) throw new AppError("CONFLICT", `The role "${inactiveRole.name}" is inactive.`);

  await assertGrantWithinOwnPermissions(actor.permissions as Set<string>, payload.roleIds);

  const admin = createSupabaseAdminClient();
  const redirectTo = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`
    : undefined;

  const invite = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { employee_id: employee.id, invited_by: actor.user.id },
  });

  if (invite.error || !invite.data.user) {
    // The message is surfaced verbatim so an administrator can act (e.g. the address already
    // has an auth account). No token or credential is ever included.
    throw new AppError(
      "CONFLICT",
      `The invitation could not be sent: ${invite.error?.message ?? "unknown error"}. If an auth account already exists for ${email}, link the existing account instead.`,
    );
  }

  const authUserId = invite.data.user.id;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .insert({
      id: authUserId,
      employee_id: employee.id,
      display_name: `${employee.first_name} ${employee.last_name}`.trim(),
      account_status: "invited",
      status_reason: payload.reason,
      invited_at: new Date().toISOString(),
      invitation_count: 1,
    })
    .select("*")
    .single<Profile>();

  if (profileError) {
    await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
    if (profileError.code === "23505") {
      throw new AppError("CONFLICT", "A profile is already linked to that auth user or employee.");
    }
    throw new Error(profileError.message);
  }

  const { data: assignments, error: assignmentError } = await supabase
    .from("user_roles")
    .insert(
      payload.roleIds.map((roleId) => ({
        user_id: authUserId,
        role_id: roleId,
        is_active: true,
        assigned_by: actor.user.id,
        assigned_at: new Date().toISOString(),
      })),
    )
    .select("*")
    .returns<UserRole[]>();

  if (assignmentError) {
    // Roll back the whole provisioning attempt so we never leave a half-provisioned account.
    await supabase.from("profiles").delete().eq("id", authUserId);
    await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
    throw new Error(assignmentError.message);
  }

  await logActivity(admin, {
    userId: authUserId,
    activityType: "invited",
    description: `Account provisioned for ${employee.employee_number} by an administrator.`,
    meta,
  });

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "account.provisioned",
    eventCategory: "account_management",
    severity: "notice",
    module: "access",
    entityType: "profile",
    entityId: authUserId,
    description: `Provisioned an ERP account for ${employee.employee_number} (${email}) with ${payload.roleIds.length} role(s).`,
    newValues: {
      employee_id: employee.id,
      account_status: profile.account_status,
      roles: (roles ?? []).map((role) => role.code),
    },
    metadata: { reason: payload.reason },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/users");
  revalidatePath(`/administration/employees/${employee.id}`);
  return { profile, assignments: assignments ?? [], invitationSent: true };
}

/**
 * Moves an account through its lifecycle. Illegal transitions are rejected here and again by a
 * database trigger, so neither a modified client nor a direct API call can skip a state.
 */
export async function updateAccountStatus(
  input: unknown,
  meta: RequestMeta = {},
): Promise<Profile> {
  const payload = updateAccountStatusSchema.parse(input);
  const targetStatus = payload.status as AccountStatusValue;

  if (!ACCOUNT_STATUSES.includes(targetStatus)) {
    throw new AppError("VALIDATION_ERROR", "Unknown account status.");
  }

  const actor = await requirePermission(STATUS_PERMISSION[targetStatus]);

  if (payload.userId === actor.user.id) {
    throw new AppError(
      "FORBIDDEN",
      "You cannot change the status of your own account. Ask another administrator.",
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: profile, error: readError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", payload.userId)
    .maybeSingle<Profile>();
  if (readError) throw new Error(readError.message);
  if (!profile) throw new AppError("NOT_FOUND", "That account does not exist.");

  const from = profile.account_status as AccountStatusValue;
  if (from === targetStatus) {
    throw new AppError("CONFLICT", `This account is already ${targetStatus.replace("_", " ")}.`);
  }
  if (!canTransitionAccountStatus(from, targetStatus)) {
    throw new AppError(
      "CONFLICT",
      `An account cannot move from ${from.replace("_", " ")} to ${targetStatus.replace("_", " ")}. Allowed: ${
        ACCOUNT_STATUS_TRANSITIONS[from].map((value) => value.replace("_", " ")).join(", ") || "none"
      }.`,
    );
  }

  // Never allow the final active super administrator to be locked out.
  if (targetStatus !== "active") {
    const { data: superRole } = await supabase
      .from("roles")
      .select("id")
      .eq("code", "super_administrator")
      .maybeSingle<{ id: string }>();

    if (superRole) {
      const { data: targetRoles } = await supabase
        .from("user_roles")
        .select("role_id")
        .eq("user_id", payload.userId)
        .eq("is_active", true)
        .returns<{ role_id: string }[]>();

      if ((targetRoles ?? []).some((row) => row.role_id === superRole.id)) {
        const { data: holders } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role_id", superRole.id)
          .eq("is_active", true)
          .returns<{ user_id: string }[]>();

        const holderIds = (holders ?? []).map((row) => row.user_id);
        const { data: activeHolders } = await supabase
          .from("profiles")
          .select("id")
          .in("id", holderIds.length > 0 ? holderIds : ["00000000-0000-0000-0000-000000000000"])
          .eq("account_status", "active")
          .returns<{ id: string }[]>();

        if ((activeHolders ?? []).length <= 1) {
          throw new AppError(
            "CONFLICT",
            "This is the last active super administrator. Grant the role to another account first.",
          );
        }
      }
    }
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ account_status: targetStatus, status_reason: payload.reason })
    .eq("id", payload.userId)
    .select("*")
    .single<Profile>();
  if (error) throw new Error(error.message);

  const admin = createSupabaseAdminClient();
  await logActivity(admin, {
    userId: payload.userId,
    activityType:
      targetStatus === "active"
        ? from === "deactivated" || from === "suspended" || from === "locked"
          ? "reactivated"
          : "activated"
        : targetStatus === "suspended"
          ? "suspended"
          : targetStatus === "deactivated"
            ? "deactivated"
            : "invited",
    description: `Account moved from ${from} to ${targetStatus}. Reason: ${payload.reason}`,
    meta,
  });

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: `account.${targetStatus}`,
    eventCategory: "account_management",
    severity: targetStatus === "active" ? "notice" : "warning",
    module: "access",
    entityType: "profile",
    entityId: payload.userId,
    description: `Account status changed from ${from} to ${targetStatus}. Reason: ${payload.reason}`,
    oldValues: { account_status: from, is_active: profile.is_active },
    newValues: { account_status: data.account_status, is_active: data.is_active },
    metadata: {
      reason: payload.reason,
      sessions_valid_after: data.sessions_valid_after,
    },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/users");
  revalidatePath(`/administration/users/${payload.userId}`);
  return data;
}

/** Re-sends the Supabase invitation link. Never reveals or regenerates a password. */
export async function resendInvitation(input: unknown, meta: RequestMeta = {}): Promise<void> {
  const actor = await requirePermission("access.accounts.invite");
  const payload = resendInvitationSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", payload.userId)
    .maybeSingle<Profile>();
  if (error) throw new Error(error.message);
  if (!profile) throw new AppError("NOT_FOUND", "That account does not exist.");
  if (profile.account_status === "deactivated") {
    throw new AppError("CONFLICT", "A deactivated account cannot be re-invited. Reactivate it first.");
  }

  const { data: authUser, error: authError } = await createSupabaseAdminClient().auth.admin.getUserById(
    payload.userId,
  );
  if (authError || !authUser.user?.email) {
    throw new AppError("NOT_FOUND", "The underlying auth user could not be found.");
  }

  const admin = createSupabaseAdminClient();
  const invite = await admin.auth.admin.inviteUserByEmail(authUser.user.email, {
    redirectTo: process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`
      : undefined,
  });
  if (invite.error) {
    throw new AppError("CONFLICT", `The invitation could not be sent: ${invite.error.message}`);
  }

  await supabase
    .from("profiles")
    .update({ invitation_count: (profile.invitation_count ?? 0) + 1 })
    .eq("id", payload.userId);

  await logActivity(admin, {
    userId: payload.userId,
    activityType: "invitation_resent",
    description: `Invitation re-sent. Reason: ${payload.reason}`,
    meta,
  });

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "account.invitation_resent",
    eventCategory: "account_management",
    severity: "info",
    module: "access",
    entityType: "profile",
    entityId: payload.userId,
    description: `Re-sent the account invitation. Reason: ${payload.reason}`,
    metadata: { reason: payload.reason, invitation_count: (profile.invitation_count ?? 0) + 1 },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath(`/administration/users/${payload.userId}`);
}

/**
 * Revokes every existing session for an account by stamping `sessions_valid_after`.
 * `resolveCurrentPrincipal()` rejects any session issued before that instant, so a stolen or
 * forgotten session stops working on the very next request.
 */
export async function revokeAccountSessions(input: unknown, meta: RequestMeta = {}): Promise<Profile> {
  const actor = await requirePermission("access.accounts.revoke");
  const payload = revokeSessionsSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data: profile, error: readError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", payload.userId)
    .maybeSingle<Profile>();
  if (readError) throw new Error(readError.message);
  if (!profile) throw new AppError("NOT_FOUND", "That account does not exist.");

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("profiles")
    .update({ sessions_valid_after: now, sessions_revoked_at: now, sessions_revoked_by: actor.user.id })
    .eq("id", payload.userId)
    .select("*")
    .single<Profile>();
  if (error) throw new Error(error.message);

  const admin = createSupabaseAdminClient();
  await logActivity(admin, {
    userId: payload.userId,
    activityType: "sessions_revoked",
    description: `All sessions revoked. Reason: ${payload.reason}`,
    meta,
  });

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "account.sessions_revoked",
    eventCategory: "account_management",
    severity: "critical",
    module: "access",
    entityType: "profile",
    entityId: payload.userId,
    description: `Revoked all active sessions. Reason: ${payload.reason}`,
    newValues: { sessions_valid_after: now },
    metadata: { reason: payload.reason },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath(`/administration/users/${payload.userId}`);
  return data;
}

export async function getAccountActivity(userId: string): Promise<AccountActivity[]> {
  await requirePermission("access.accounts.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("account_activity")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<AccountActivity[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function isKnownPermission(code: string): code is PermissionCode {
  return isPermissionCode(code);
}
