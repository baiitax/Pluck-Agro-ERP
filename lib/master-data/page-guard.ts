import "server-only";

import type { PermissionCode } from "@/lib/permissions/definitions";
import { requireActiveProfile } from "@/services/authorization";
import type { AuthenticatedUser } from "@/types/auth.types";

/**
 * Page-level guard for the master-data workspace.
 *
 * Returns a decision instead of throwing so a page can render an explanatory "no access" card.
 * Hiding a page is presentation only: every service call re-checks the same permission server-side
 * and RLS enforces it again in PostgreSQL.
 */
export async function guardMasterDataPage(
  permission: PermissionCode,
): Promise<{ allowed: true; principal: AuthenticatedUser } | { allowed: false; principal: AuthenticatedUser }> {
  const principal = await requireActiveProfile();
  return { allowed: principal.permissions.has(permission), principal };
}
