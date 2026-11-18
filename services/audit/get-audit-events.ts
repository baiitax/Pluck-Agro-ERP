import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuditCategory, AuditLog, AuditSeverity } from "@/types/database.types";

export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  "authentication",
  "employee_management",
  "account_management",
  "authorization",
  "governance",
  "system_administration",
  "general",
];

export const AUDIT_SEVERITIES: readonly AuditSeverity[] = ["info", "notice", "warning", "critical"];

export type AuditQuery = {
  module?: string;
  category?: string;
  severity?: string;
  actorUserId?: string;
  actorEmployeeId?: string;
  requestId?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type AuditRow = AuditLog & {
  actor: { id: string; display_name: string | null } | null;
  actor_employee: { id: string; employee_number: string; first_name: string; last_name: string } | null;
};

const SELECT = "*, actor:profiles!audit_logs_actor_user_id_fkey(id, display_name), actor_employee:employees!audit_logs_actor_employee_id_fkey(id, employee_number, first_name, last_name)";

function applyFilters<T extends { eq: (column: string, value: string) => T; ilike: (column: string, pattern: string) => T; gte: (column: string, value: string) => T; lte: (column: string, value: string) => T; or: (filter: string) => T }>(
  request: T,
  query: AuditQuery,
): T {
  let next = request;
  if (query.module) next = next.eq("module", query.module);
  if (query.category) next = next.eq("event_category", query.category);
  if (query.severity) next = next.eq("severity", query.severity);
  if (query.actorUserId) next = next.eq("actor_user_id", query.actorUserId);
  if (query.actorEmployeeId) next = next.eq("actor_employee_id", query.actorEmployeeId);
  if (query.requestId) next = next.eq("request_id", query.requestId);
  if (query.entityType) next = next.eq("entity_type", query.entityType);
  if (query.entityId) next = next.eq("entity_id", query.entityId);
  if (query.from) next = next.gte("created_at", `${query.from}T00:00:00.000Z`);
  if (query.to) next = next.lte("created_at", `${query.to}T23:59:59.999Z`);
  if (query.search) {
    const term = query.search.replace(/[%,()]/g, " ").trim();
    if (term) next = next.or(`description.ilike.%${term}%,action.ilike.%${term}%`);
  }
  return next;
}

export async function getAuditEvents(query: AuditQuery = {}): Promise<{
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, query.pageSize ?? 25));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = await createSupabaseServerClient();
  const base = supabase.from("audit_logs").select(SELECT, { count: "exact" });
  const filtered = applyFilters(base, query);
  const { data, count, error } = await filtered
    .order("created_at", { ascending: false })
    .range(from, to)
    .returns<AuditRow[]>();
  if (error) throw new Error(error.message);

  return { rows: data ?? [], total: count ?? 0, page, pageSize };
}

export async function getAuditEvent(id: string): Promise<AuditRow | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle<AuditRow>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export type AuditExportRow = AuditLog;

/** Streams up to `limit` events for CSV export. Exporting requires governance.audit.export. */
export async function getAuditEventsForExport(query: AuditQuery, limit = 5000): Promise<AuditExportRow[]> {
  const supabase = await createSupabaseServerClient();
  const base = supabase.from("audit_logs").select("*");
  const { data, error } = await applyFilters(base, query)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 5000))
    .returns<AuditLog[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}
