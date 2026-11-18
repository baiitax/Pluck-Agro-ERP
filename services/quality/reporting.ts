import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";
import type { Database } from "@/types/database.types";
import { pageOf, type RegisterPage } from "@/services/quality/shared";

type DashboardRow = Database["public"]["Views"]["quality_dashboard_summary"]["Row"];
type LotStatusRow = Database["public"]["Views"]["quality_lot_status"]["Row"];
type TraceabilityRow = Database["public"]["Views"]["quality_lot_traceability"]["Row"];
type InspectionRegisterRow = Database["public"]["Views"]["quality_inspection_register"]["Row"];

/**
 * Quality reporting.
 *
 * Every figure comes from a view over the documents and — for anything about quantity — from Phase 4's availability
 * view. Nothing is cached and nothing is recomputed here. Where a view exposes a `failed_holds` count it is shown,
 * not hidden: a hold that did not take effect is the one number a quality manager must not have smoothed away.
 */

export async function getQualityDashboard(): Promise<DashboardRow> {
  await requirePermission("quality.dashboard.view");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("quality_dashboard_summary")
    .select("*")
    .maybeSingle<DashboardRow>();
  if (error) throw new AppError("DATABASE_ERROR", `Quality figures could not be loaded. ${error.message}`);

  return (
    data ?? {
      inspections_in_progress: 0,
      inspections_awaiting_approval: 0,
      approved_non_conforming: 0,
      open_holds: 0,
      failed_holds: 0,
      open_ncrs: 0,
      open_capa_actions: 0,
      overdue_capa_actions: 0,
      certificates_issued: 0,
      total_available_quantity: 0,
      total_restricted_quantity: 0,
    }
  );
}

export async function listLotQuality(
  filters: { qualityStatus?: string; page?: number } = {},
): Promise<RegisterPage<LotStatusRow>> {
  await requirePermission("quality.traceability.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;

  let query = supabase
    .from("quality_lot_status")
    .select("*", { count: "exact" })
    .order("lot_reference", { ascending: false });
  if (filters.qualityStatus) query = query.eq("quality_status", filters.qualityStatus);

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Lot quality positions could not be loaded. ${error.message}`);

  return pageOf(data ?? [], page, pageSize, count ?? 0);
}

export async function getLotTraceability(lotId: string): Promise<TraceabilityRow> {
  await requirePermission("quality.traceability.view");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("quality_lot_traceability")
    .select("*")
    .eq("lot_id", lotId)
    .maybeSingle<TraceabilityRow>();
  if (error) throw new AppError("DATABASE_ERROR", `That lot's traceability could not be loaded. ${error.message}`);
  if (!data) throw new AppError("NOT_FOUND", "That lot does not exist, or you cannot see it.");

  return data;
}

/** Inspections for the reporting screen, with the counts a quality manager reads first. */
export async function listInspectionReport(
  filters: { from?: string; to?: string; page?: number } = {},
): Promise<RegisterPage<InspectionRegisterRow>> {
  await requirePermission("quality.reports.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 50;

  let query = supabase
    .from("quality_inspection_register")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00Z`);
  if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59Z`);

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `The inspection report could not be loaded. ${error.message}`);

  return pageOf(data ?? [], page, pageSize, count ?? 0);
}
