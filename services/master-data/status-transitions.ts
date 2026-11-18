import "server-only";

import { MASTER_STATUS_LABELS, labelFor } from "@/lib/master-data/statuses";
import type { PermissionCode } from "@/lib/permissions/definitions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveProfile } from "@/services/authorization";
import { translateDatabaseError } from "@/services/master-data/shared";

export type TransitionOption = { value: string; label: string; hint?: string };

/**
 * The transitions a given record may move to *for this caller*.
 *
 * Read from `master_data_status_transitions` — the same table the trigger consults — so the UI can
 * never offer a move the database will reject. Transitions whose `required_permission` the caller
 * lacks are filtered out here, and the trigger plus RLS still enforce them on write.
 */
export async function getAvailableTransitions(
  entityType: "supplier" | "customer" | "product",
  currentStatus: string,
): Promise<TransitionOption[]> {
  const principal = await requireActiveProfile();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("master_data_status_transitions")
    .select("to_status, required_permission, requires_reason, description")
    .eq("entity_type", entityType)
    .eq("from_status", currentStatus)
    .order("to_status")
    .returns<{ to_status: string; required_permission: string | null; requires_reason: boolean; description: string | null }[]>();
  if (error) throw translateDatabaseError(error, "The status lifecycle");

  return (data ?? [])
    .filter((row) => !row.required_permission || principal.permissions.has(row.required_permission as PermissionCode))
    .map((row) => ({
      value: row.to_status,
      label: MASTER_STATUS_LABELS[row.to_status] ?? labelFor(row.to_status),
      hint: [row.description, row.requires_reason ? "A reason is required." : null].filter(Boolean).join(" · ") || undefined,
    }));
}
