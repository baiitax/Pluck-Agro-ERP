import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";
import type { Database } from "@/types/database.types";
import type { RequestMeta } from "@/services/employees/manage-employee";
import {
  callInventoryRpc,
  inventoryError,
  numeric,
  recordInventoryAudit,
  type RegisterPage,
} from "@/services/inventory/shared";

type CountRow = Database["public"]["Tables"]["inventory_stock_counts"]["Row"];
type CountLineRow = Database["public"]["Tables"]["inventory_stock_count_lines"]["Row"];
type AdjustmentRow = Database["public"]["Tables"]["inventory_stock_adjustments"]["Row"];
type AdjustmentLineRow = Database["public"]["Tables"]["inventory_stock_adjustment_lines"]["Row"];

/**
 * Stock counts and stock adjustments.
 *
 * Two documents with the same destination and different meanings:
 *
 *  * a **count** says "we looked, and the shelf holds this"; its variance is a discovery;
 *  * an **adjustment** says "we know why the number is wrong"; its line is a decision.
 *
 * Both post movements after approval and neither edits a balance. The service layer deliberately exposes
 * the database's own refusals ("Stock count PA-CNT-2026-0001 is counting; it must be approved…") rather
 * than paraphrasing them, because the person pressing the button needs to know which step is missing.
 */

export async function listCounts(filters: { status?: string; page?: number } = {}): Promise<RegisterPage<CountRow & { lineCount: number; countedLines: number; warehouseName: string | null }>> {
  await requirePermission("inventory.count.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;

  let query = supabase.from("inventory_stock_counts").select("*", { count: "exact" }).order("count_date", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Stock counts could not be loaded. ${error.message}`);

  const rows = data ?? [];
  const ids = rows.map((row) => row.id);
  const warehouseIds = Array.from(new Set(rows.map((row) => row.warehouse_id)));

  const [{ data: lines }, { data: warehouses }] = await Promise.all([
    ids.length
      ? supabase
          .from("inventory_stock_count_lines")
          .select("count_id, counted_quantity")
          .in("count_id", ids)
          .returns<{ count_id: string; counted_quantity: number | null }[]>()
      : Promise.resolve({ data: [] as { count_id: string; counted_quantity: number | null }[] }),
    warehouseIds.length
      ? supabase.from("warehouses").select("id, name").in("id", warehouseIds).returns<{ id: string; name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const total = count ?? 0;
  return {
    rows: rows.map((row) => {
      const own = (lines ?? []).filter((line) => line.count_id === row.id);
      return {
        ...row,
        lineCount: own.length,
        countedLines: own.filter((line) => line.counted_quantity !== null).length,
        warehouseName: (warehouses ?? []).find((warehouse) => warehouse.id === row.warehouse_id)?.name ?? null,
      };
    }),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type CountDetail = {
  count: CountRow & { warehouseName: string | null };
  lines: (CountLineRow & { lotReference: string | null; productCode: string | null; productName: string | null; unitCode: string | null })[];
  /** True when every line has a counted quantity; the database refuses to move on otherwise. */
  allCounted: boolean;
  /** What the next step needs, stated in words rather than inferred from a status string. */
  nextStep: string;
};

export async function getCountDetail(countId: string): Promise<CountDetail> {
  await requirePermission("inventory.count.view");
  const supabase = await createSupabaseServerClient();

  const { data: count, error } = await supabase
    .from("inventory_stock_counts")
    .select("*")
    .eq("id", countId)
    .maybeSingle<CountRow>();
  if (error) throw new AppError("DATABASE_ERROR", `That stock count could not be loaded. ${error.message}`);
  if (!count) throw new AppError("NOT_FOUND", "That stock count does not exist, or you cannot see it.");

  const [{ data: lines }, { data: warehouse }] = await Promise.all([
    supabase
      .from("inventory_stock_count_lines")
      .select("*, lot:inventory_lots(lot_reference), product:products(code, name), unit:units_of_measure(code)")
      .eq("count_id", countId)
      .order("line_number")
      .returns<
        (CountLineRow & {
          lot: { lot_reference: string } | null;
          product: { code: string; name: string } | null;
          unit: { code: string } | null;
        })[]
      >(),
    supabase.from("warehouses").select("name").eq("id", count.warehouse_id).maybeSingle<{ name: string }>(),
  ]);

  const allCounted = (lines ?? []).every((line) => line.counted_quantity !== null);

  const nextStep =
    count.status === "counting"
      ? allCounted
        ? "Every line has been counted. Submit the count for approval."
        : "Record a counted quantity for every line."
      : count.status === "counted" || count.status === "submitted"
        ? "Waiting for approval. Variances post only after approval."
        : count.status === "approved"
          ? "Approved. Posting will create a gain or loss movement per variance."
          : count.status === "posted"
            ? "Posted. The variances are in the ledger and cannot be changed."
            : count.status === "rejected"
              ? "Rejected. Recount and submit again."
              : count.status === "cancelled"
                ? "Cancelled. Nothing was posted."
                : "Draft.";

  return {
    count: { ...count, warehouseName: warehouse?.name ?? null },
    lines: (lines ?? []).map((line) => ({
      ...line,
      lotReference: line.lot?.lot_reference ?? null,
      productCode: line.product?.code ?? null,
      productName: line.product?.name ?? null,
      unitCode: line.unit?.code ?? null,
    })),
    allCounted,
    nextStep,
  };
}

export async function startStockCount(
  input: { warehouseId: string; locationId?: string | null; countDate: string; notes?: string | null },
  meta: RequestMeta = {},
): Promise<{ id: string; reference: string }> {
  await requirePermission("inventory.count.execute");

  const rows = await callInventoryRpc<{ id: string; reference: string }[]>("inventory_start_stock_count", {
    p_warehouse_id: input.warehouseId,
    p_location_id: input.locationId ?? null,
    p_count_date: input.countDate,
    p_notes: input.notes ?? null,
  });

  const count = rows[0];
  if (!count) throw new AppError("VALIDATION_ERROR", "The database did not return a stock count.");

  await recordInventoryAudit(
    {
      action: "inventory.count.started",
      entityType: "inventory_stock_count",
      entityId: count.id,
      description: `Started stock count ${count.reference}; system quantities were frozen at this moment`,
    },
    meta,
  );

  return count;
}

export async function recordCountLine(
  input: { lineId: string; countedQuantity: string; notes?: string | null },
  meta: RequestMeta = {},
): Promise<{ variance: number | null }> {
  await requirePermission("inventory.count.execute");

  const rows = await callInventoryRpc<{ variance_quantity: number | null }[]>("inventory_record_count_line", {
    p_count_line_id: input.lineId,
    p_counted_quantity: numeric(input.countedQuantity),
    p_notes: input.notes ?? null,
  });

  await recordInventoryAudit(
    {
      action: "inventory.count.recorded",
      entityType: "inventory_stock_count_line",
      entityId: input.lineId,
      description: `Recorded a counted quantity of ${input.countedQuantity}`,
      newValues: { counted_quantity: input.countedQuantity, variance: rows[0]?.variance_quantity ?? null },
    },
    meta,
  );

  return { variance: rows[0]?.variance_quantity ?? null };
}

/** Count submission is a status move; the lifecycle trigger decides whether the caller may make it. */
export async function submitCount(countId: string, meta: RequestMeta = {}): Promise<void> {
  await requirePermission("inventory.count.execute");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("inventory_stock_counts")
    .update({ status: "submitted", submitted_at: new Date().toISOString() } as never)
    .eq("id", countId)
    .eq("status", "counting");
  if (error) throw inventoryError(error);

  await recordInventoryAudit(
    {
      action: "inventory.count.recorded",
      entityType: "inventory_stock_count",
      entityId: countId,
      description: "Submitted a stock count for approval",
    },
    meta,
  );
}

export async function decideCount(
  input: { countId: string; decision: "approved" | "rejected"; reason?: string | null },
  meta: RequestMeta = {},
): Promise<void> {
  await requirePermission("inventory.count.approve");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("inventory_stock_counts")
    .update({
      status: input.decision,
      status_reason: input.reason ?? null,
      approved_at: input.decision === "approved" ? new Date().toISOString() : null,
    } as never)
    .eq("id", input.countId)
    .in("status", ["counted", "submitted"]);
  if (error) throw inventoryError(error);

  await recordInventoryAudit(
    {
      action: "inventory.count.recorded",
      entityType: "inventory_stock_count",
      entityId: input.countId,
      description: `Stock count ${input.decision}${input.reason ? `: ${input.reason}` : ""}`,
      severity: input.decision === "rejected" ? "warning" : "notice",
    },
    meta,
  );
}

/**
 * Posts the variances.
 *
 * The function is idempotent — calling it twice returns the same posted document rather than posting the
 * movements twice, because each movement carries a key derived from the count and line.
 */
export async function postCount(
  countId: string,
  meta: RequestMeta = {},
): Promise<{ gain: number; loss: number }> {
  await requirePermission("inventory.count.approve");

  const rows = await callInventoryRpc<
    { total_gain_quantity: number; total_loss_quantity: number; status: string }[]
  >("inventory_post_stock_count", { p_count_id: countId });

  const posted = rows[0];
  if (!posted) throw new AppError("VALIDATION_ERROR", "The database did not return the posted count.");

  await recordInventoryAudit(
    {
      action: "inventory.count.posted",
      entityType: "inventory_stock_count",
      entityId: countId,
      description: `Posted stock count variances: +${posted.total_gain_quantity} gained, −${posted.total_loss_quantity} lost`,
      severity: Number(posted.total_loss_quantity) > 0 ? "warning" : "notice",
      newValues: { ...posted },
    },
    meta,
  );

  return { gain: Number(posted.total_gain_quantity), loss: Number(posted.total_loss_quantity) };
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

export async function listAdjustments(filters: { status?: string; page?: number } = {}): Promise<RegisterPage<AdjustmentRow & { lineCount: number }>> {
  await requirePermission("inventory.adjustment.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;

  let query = supabase
    .from("inventory_stock_adjustments")
    .select("*", { count: "exact" })
    .order("adjustment_date", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Adjustments could not be loaded. ${error.message}`);

  const rows = data ?? [];
  const ids = rows.map((row) => row.id);
  const { data: lines } = ids.length
    ? await supabase
        .from("inventory_stock_adjustment_lines")
        .select("adjustment_id")
        .in("adjustment_id", ids)
        .returns<{ adjustment_id: string }[]>()
    : { data: [] as { adjustment_id: string }[] };

  const total = count ?? 0;
  return {
    rows: rows.map((row) => ({
      ...row,
      lineCount: (lines ?? []).filter((line) => line.adjustment_id === row.id).length,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type AdjustmentDetail = {
  adjustment: AdjustmentRow;
  lines: (AdjustmentLineRow & { lotReference: string | null; productCode: string | null; productName: string | null })[];
  nextStep: string;
};

export async function getAdjustmentDetail(adjustmentId: string): Promise<AdjustmentDetail> {
  await requirePermission("inventory.adjustment.view");
  const supabase = await createSupabaseServerClient();

  const { data: adjustment, error } = await supabase
    .from("inventory_stock_adjustments")
    .select("*")
    .eq("id", adjustmentId)
    .maybeSingle<AdjustmentRow>();
  if (error) throw new AppError("DATABASE_ERROR", `That adjustment could not be loaded. ${error.message}`);
  if (!adjustment) throw new AppError("NOT_FOUND", "That adjustment does not exist, or you cannot see it.");

  const { data: lines } = await supabase
    .from("inventory_stock_adjustment_lines")
    .select("*, lot:inventory_lots(lot_reference), product:products(code, name)")
    .eq("adjustment_id", adjustmentId)
    .order("line_number")
    .returns<
      (AdjustmentLineRow & { lot: { lot_reference: string } | null; product: { code: string; name: string } | null })[]
    >();

  const nextStep =
    adjustment.status === "draft"
      ? "Submit the adjustment for approval."
      : adjustment.status === "submitted"
        ? "Waiting for approval. Nothing has been posted."
        : adjustment.status === "approved"
          ? "Approved. Posting writes one movement per line."
          : adjustment.status === "posted"
            ? "Posted. Each line is a movement in the register."
            : adjustment.status === "rejected"
              ? "Rejected. Amend the lines and resubmit."
              : "Cancelled. Nothing was posted.";

  return {
    adjustment,
    lines: (lines ?? []).map((line) => ({
      ...line,
      lotReference: line.lot?.lot_reference ?? null,
      productCode: line.product?.code ?? null,
      productName: line.product?.name ?? null,
    })),
    nextStep,
  };
}

export type CreateAdjustmentInput = {
  warehouseId: string;
  adjustmentDate: string;
  reasonCode: string;
  reason: string;
  notes?: string | null;
  items: { lotId: string; quantityChange: string; reason?: string | null }[];
};

/** Raises a draft adjustment. Lines are signed here because the document's purpose is to state a direction. */
export async function createAdjustment(
  input: CreateAdjustmentInput,
  meta: RequestMeta = {},
): Promise<{ id: string; reference: string }> {
  await requirePermission("inventory.adjustment.create");
  if (input.items.length === 0) throw new AppError("VALIDATION_ERROR", "Add at least one line to adjust.");

  const supabase = await createSupabaseServerClient();
  const { data: adjustment, error } = await supabase
    .from("inventory_stock_adjustments")
    .insert({
      warehouse_id: input.warehouseId,
      adjustment_date: input.adjustmentDate,
      reason_code: input.reasonCode,
      reason: input.reason,
      notes: input.notes ?? null,
    } as never)
    .select("id, reference")
    .single<{ id: string; reference: string }>();
  if (error || !adjustment) throw inventoryError(error ?? new Error("The adjustment was not created."));

  const { data: lots } = await supabase
    .from("inventory_lots")
    .select("id, product_id, unit_id, warehouse_id")
    .in("id", input.items.map((item) => item.lotId))
    .returns<{ id: string; product_id: string; unit_id: string; warehouse_id: string }[]>();
  const byId = new Map((lots ?? []).map((lot) => [lot.id, lot]));

  const rows = input.items.map((item, index) => {
    const lot = byId.get(item.lotId);
    if (!lot) throw new AppError("VALIDATION_ERROR", "One of the selected lots could not be found.");
    if (lot.warehouse_id !== input.warehouseId) {
      throw new AppError("VALIDATION_ERROR", "Every adjusted lot must be held in the adjustment's warehouse.");
    }
    return {
      adjustment_id: adjustment.id,
      line_number: index + 1,
      lot_id: lot.id,
      product_id: lot.product_id,
      unit_id: lot.unit_id,
      quantity_change: numeric(item.quantityChange),
      reason: item.reason ?? null,
    };
  });

  const { error: lineError } = await supabase.from("inventory_stock_adjustment_lines").insert(rows as never);
  if (lineError) {
    await supabase.from("inventory_stock_adjustments").delete().eq("id", adjustment.id);
    throw inventoryError(lineError);
  }

  await recordInventoryAudit(
    {
      action: "inventory.adjustment.created",
      entityType: "inventory_stock_adjustment",
      entityId: adjustment.id,
      description: `Raised adjustment ${adjustment.reference} with ${rows.length} line(s): ${input.reason}`,
      newValues: { reference: adjustment.reference, line_count: rows.length, reason: input.reason },
    },
    meta,
  );

  return adjustment;
}

export async function submitAdjustment(adjustmentId: string, meta: RequestMeta = {}): Promise<void> {
  await requirePermission("inventory.adjustment.create");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("inventory_stock_adjustments")
    .update({ status: "submitted" } as never)
    .eq("id", adjustmentId)
    .eq("status", "draft");
  if (error) throw inventoryError(error);

  await recordInventoryAudit(
    {
      action: "inventory.adjustment.created",
      entityType: "inventory_stock_adjustment",
      entityId: adjustmentId,
      description: "Submitted a stock adjustment for approval",
    },
    meta,
  );
}

export async function decideAdjustment(
  input: { adjustmentId: string; decision: "approved" | "rejected"; reason?: string | null },
  meta: RequestMeta = {},
): Promise<void> {
  await requirePermission("inventory.adjustment.approve");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("inventory_stock_adjustments")
    .update({
      status: input.decision,
      status_reason: input.reason ?? null,
      approved_at: input.decision === "approved" ? new Date().toISOString() : null,
    } as never)
    .eq("id", input.adjustmentId)
    .eq("status", "submitted");
  if (error) throw inventoryError(error);

  await recordInventoryAudit(
    {
      action: "inventory.adjustment.created",
      entityType: "inventory_stock_adjustment",
      entityId: input.adjustmentId,
      description: `Stock adjustment ${input.decision}${input.reason ? `: ${input.reason}` : ""}`,
      severity: input.decision === "rejected" ? "warning" : "notice",
    },
    meta,
  );
}

export async function postAdjustment(adjustmentId: string, meta: RequestMeta = {}): Promise<void> {
  await requirePermission("inventory.adjustment.approve");

  const rows = await callInventoryRpc<{ status: string; reference: string }[]>("inventory_post_adjustment", {
    p_adjustment_id: adjustmentId,
  });
  if (!rows[0]) throw new AppError("VALIDATION_ERROR", "The database did not return the posted adjustment.");

  await recordInventoryAudit(
    {
      action: "inventory.adjustment.posted",
      entityType: "inventory_stock_adjustment",
      entityId: adjustmentId,
      description: `Posted adjustment ${rows[0].reference}`,
      severity: "notice",
    },
    meta,
  );
}
