import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";
import { translateDatabaseError } from "@/services/master-data/shared";
import type { MasterDataChangeHistoryRow } from "@/types/database.types";

export type HistoryRow = MasterDataChangeHistoryRow & {
  actor: { display_name: string | null } | null;
  actor_employee: { first_name: string; last_name: string; employee_number: string } | null;
};

export type HistoryFilters = {
  entityType?: string;
  entityId?: string;
  changeType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Master-data change history.
 *
 * These rows are written by the database trigger installed on every master table, so a change
 * cannot escape the trail by bypassing the service layer. The view is read-only and requires
 * master_data.history.view.
 */
export async function getMasterDataHistory(filters: HistoryFilters = {}) {
  await requirePermission("master_data.history.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));

  let query = supabase
    .from("master_data_change_history")
    .select(
      "*, actor:profiles!master_data_change_history_actor_user_id_fkey(display_name), actor_employee:employees!master_data_change_history_actor_employee_id_fkey(first_name, last_name, employee_number)",
      { count: "exact" },
    );

  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.entityId) query = query.eq("entity_id", filters.entityId);
  if (filters.changeType) query = query.eq("change_type", filters.changeType);
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00.000Z`);
  if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59.999Z`);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1)
    .returns<HistoryRow[]>();
  if (error) throw translateDatabaseError(error, "The change history");

  return { rows: data ?? [], total: count ?? 0, page, pageSize };
}

export const MASTER_ENTITY_LABELS: Record<string, string> = {
  supplier: "Supplier",
  customer: "Customer",
  product: "Product",
  product_variant: "Product variant",
  site: "Site",
  warehouse: "Warehouse",
  warehouse_location: "Storage location",
};

export function entityLabel(entity: string): string {
  return MASTER_ENTITY_LABELS[entity] ?? entity.replace(/_/g, " ");
}
