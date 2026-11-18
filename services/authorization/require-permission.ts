import "server-only";

import { AppError } from "@/lib/errors";
import type { PermissionCode } from "@/lib/permissions/definitions";
import { resolveCurrentPrincipal } from "@/services/auth/resolve-principal";
import type { AuthenticatedUser } from "@/types/auth.types";

/** Throws an AppError when the current principal lacks the permission. */
export async function requirePermission(permission: PermissionCode): Promise<AuthenticatedUser> {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has(permission)) {
    throw new AppError("FORBIDDEN", `You do not have permission to perform this action (${permission}).`);
  }
  return principal;
}

/** Throws unless there is a live, active ERP profile for the caller. */
export async function requireActiveProfile(): Promise<AuthenticatedUser> {
  const resolution = await resolveCurrentPrincipal();
  if (resolution.status !== "authenticated") {
    throw new AppError(
      resolution.reason === "no_session" ? "UNAUTHENTICATED" : "ACCOUNT_INACTIVE",
      resolution.message,
    );
  }
  return resolution.principal;
}

export async function hasPermission(permission: PermissionCode): Promise<boolean> {
  const resolution = await resolveCurrentPrincipal();
  if (resolution.status !== "authenticated") return false;
  return resolution.principal.permissions.has(permission);
}

export function can(
  principal: Pick<AuthenticatedUser, "permissions">,
  permission: PermissionCode,
): boolean {
  return principal.permissions.has(permission);
}
