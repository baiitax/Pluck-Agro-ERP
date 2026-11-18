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

type BatchRow = Database["public"]["Tables"]["production_batches"]["Row"];
type BatchMaterialRow = Database["public"]["Tables"]["production_batch_materials"]["Row"];
type BatchOutputRow = Database["public"]["Tables"]["production_batch_outputs"]["Row"];
type BatchLogRow = Database["public"]["Tables"]["production_batch_logs"]["Row"];
type BatchSummaryRow = Database["public"]["Views"]["production_batch_summary"]["Row"];

/**
 * Running production.
 *
 * The three quantity-changing operations — issue material, record output, close — are database functions,
 * and this service is a thin, audited wrapper around them. That is deliberate: the functions lock the lot,
 * post the movement and update the batch in one transaction, and no path in TypeScript can produce a stock
 * change that skipped the ledger.
 *
 * Recorded yield is read from the batch, never recomputed here. When a batch's input and output are in
 * different units the database records `mixed_units` and no percentage, and the interface shows that rather
 * than a number.
 */

export async function listBatches(
  filters: { status?: string; page?: number } = {},
): Promise<RegisterPage<BatchSummaryRow>> {
  await requirePermission("production.batch.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;

  let query = supabase
    .from("production_batch_summary")
    .select("*", { count: "exact" })
    .order("batch_date", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Production batches could not be loaded. ${error.message}`);

  const total = count ?? 0;
  return { rows: data ?? [], page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export type BatchDetail = {
  batch: BatchSummaryRow;
  materials: (BatchMaterialRow & { lotReference: string | null; productCode: string | null; productName: string | null })[];
  outputs: (BatchOutputRow & { lotReference: string | null; productCode: string | null; productName: string | null })[];
  logs: BatchLogRow[];
  /** Output lots still held by a quality restriction, with the restriction that would have to be released. */
  restrictedOutputs: { outputId: string; lotReference: string | null; restrictionId: string; reason: string | null }[];
  nextStep: string;
};

export async function getBatchDetail(batchId: string): Promise<BatchDetail> {
  await requirePermission("production.batch.view");
  const supabase = await createSupabaseServerClient();

  const { data: batch, error } = await supabase
    .from("production_batch_summary")
    .select("*")
    .eq("id", batchId)
    .maybeSingle<BatchSummaryRow>();
  if (error) throw new AppError("DATABASE_ERROR", `That batch could not be loaded. ${error.message}`);
  if (!batch) throw new AppError("NOT_FOUND", "That production batch does not exist, or you cannot see it.");

  const [{ data: materials }, { data: outputs }, { data: logs }] = await Promise.all([
    supabase
      .from("production_batch_materials")
      .select("*, lot:inventory_lots(lot_reference), product:products(code, name)")
      .eq("batch_id", batchId)
      .order("line_number")
      .returns<
        (BatchMaterialRow & { lot: { lot_reference: string } | null; product: { code: string; name: string } | null })[]
      >(),
    supabase
      .from("production_batch_outputs")
      .select("*, lot:inventory_lots(lot_reference), product:products(code, name)")
      .eq("batch_id", batchId)
      .order("line_number")
      .returns<
        (BatchOutputRow & { lot: { lot_reference: string } | null; product: { code: string; name: string } | null })[]
      >(),
    supabase
      .from("production_batch_logs")
      .select("*")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: false })
      .returns<BatchLogRow[]>(),
  ]);

  const restrictionIds = (outputs ?? []).map((output) => output.restriction_id).filter((id): id is string => Boolean(id));
  const { data: restrictions } = restrictionIds.length
    ? await supabase
        .from("inventory_restrictions")
        .select("id, reason, status")
        .in("id", restrictionIds)
        .returns<{ id: string; reason: string | null; status: string }[]>()
    : { data: [] as { id: string; reason: string | null; status: string }[] };

  const restrictedOutputs = (outputs ?? [])
    .filter((output) => output.restriction_id)
    .map((output) => {
      const restriction = (restrictions ?? []).find((row) => row.id === output.restriction_id);
      return {
        outputId: output.id,
        lotReference: output.lot?.lot_reference ?? null,
        restrictionId: output.restriction_id as string,
        reason: restriction?.reason ?? null,
        status: restriction?.status ?? "unknown",
      };
    })
    .filter((row) => row.status === "active" || row.status === "partially_released")
    .map(({ outputId, lotReference, restrictionId, reason }) => ({ outputId, lotReference, restrictionId, reason }));

  const nextStep =
    batch.status === "in_progress"
      ? "Issue material, record output as it is produced, then close the batch to reconcile it."
      : batch.status === "completed"
        ? "Completed. Closing records the observed yield and requires a reason when it falls outside a declared band."
        : batch.status === "closed"
          ? "Closed. Its quantities are recorded and the yield is fixed."
          : batch.status === "aborted"
            ? "Aborted. The material that was issued remains a recorded loss."
            : batch.status === "cancelled"
              ? "Cancelled before any material was issued."
              : "Draft.";

  return {
    batch,
    materials: (materials ?? []).map((line) => ({
      ...line,
      lotReference: line.lot?.lot_reference ?? null,
      productCode: line.product?.code ?? null,
      productName: line.product?.name ?? null,
    })),
    outputs: (outputs ?? []).map((line) => ({
      ...line,
      lotReference: line.lot?.lot_reference ?? null,
      productCode: line.product?.code ?? null,
      productName: line.product?.name ?? null,
    })),
    logs: logs ?? [],
    restrictedOutputs,
    nextStep,
  };
}

export async function startBatch(
  input: {
    planId?: string | null;
    productId?: string | null;
    plannedQuantity?: string | null;
    unitId?: string | null;
    warehouseId?: string | null;
    batchDate?: string | null;
    notes?: string | null;
  },
  meta: RequestMeta = {},
): Promise<{ id: string; reference: string }> {
  await requirePermission("production.batch.create");

  const rows = await callInventoryRpc<{ id: string; reference: string }[]>("production_start_batch", {
    p_plan_id: input.planId ?? null,
    p_product_id: input.productId ?? null,
    p_planned_quantity: numeric(input.plannedQuantity),
    p_unit_id: input.unitId ?? null,
    p_warehouse_id: input.warehouseId ?? null,
    p_batch_date: input.batchDate ?? null,
    p_notes: input.notes ?? null,
  });

  const batch = rows[0];
  if (!batch) throw new AppError("VALIDATION_ERROR", "The database did not return a batch.");

  await recordInventoryAudit(
    {
      action: "production.batch.started",
      entityType: "production_batch",
      entityId: batch.id,
      description: `Started production batch ${batch.reference}${input.planId ? " from an approved plan" : ""}`,
      newValues: { reference: batch.reference, plan_id: input.planId ?? null },
    },
    meta,
  );

  return batch;
}

/** Issues material. Refused by the database when the lot lacks available stock, with the lot named. */
export async function issueMaterial(
  input: { batchId: string; lotId: string; quantity: string; notes?: string | null },
  meta: RequestMeta = {},
): Promise<{ lineNumber: number; movementId: string }> {
  await requirePermission("production.batch.execute");

  const rows = await callInventoryRpc<{ line_number: number; movement_id: string }[]>(
    "production_issue_material",
    {
      p_batch_id: input.batchId,
      p_lot_id: input.lotId,
      p_quantity: numeric(input.quantity),
      p_notes: input.notes ?? null,
    },
  );

  const line = rows[0];
  if (!line) throw new AppError("VALIDATION_ERROR", "The database did not return an issue line.");

  await recordInventoryAudit(
    {
      action: "production.batch.material_issued",
      entityType: "production_batch",
      entityId: input.batchId,
      description: `Issued ${input.quantity} from lot ${input.lotId} to the batch; stock has left the warehouse`,
      newValues: { line_number: line.line_number, movement_id: line.movement_id, quantity: input.quantity },
    },
    meta,
  );

  return { lineNumber: line.line_number, movementId: line.movement_id };
}

/**
 * Records output.
 *
 * The returned `restrictionId` is the real hold Quality will have to release. When it is present, the output
 * is in stock but not available — the page says exactly that rather than showing a quantity anybody could
 * dispatch.
 */
export async function recordOutput(
  input: {
    batchId: string;
    quantity: string;
    outputType: string;
    productId?: string | null;
    unitId?: string | null;
    locationId?: string | null;
    manufactureDate?: string | null;
    expiryDate?: string | null;
    grade?: string | null;
    notes?: string | null;
  },
  meta: RequestMeta = {},
): Promise<{ lotId: string; restrictionId: string | null }> {
  await requirePermission("production.batch.execute");

  const rows = await callInventoryRpc<{ lot_id: string; restriction_id: string | null }[]>(
    "production_record_output",
    {
      p_batch_id: input.batchId,
      p_quantity: numeric(input.quantity),
      p_output_type: input.outputType,
      p_product_id: input.productId ?? null,
      p_unit_id: input.unitId ?? null,
      p_location_id: input.locationId ?? null,
      p_manufacture_date: input.manufactureDate ?? null,
      p_expiry_date: input.expiryDate ?? null,
      p_grade: input.grade ?? null,
      p_notes: input.notes ?? null,
    },
  );

  const output = rows[0];
  if (!output) throw new AppError("VALIDATION_ERROR", "The database did not return an output line.");

  await recordInventoryAudit(
    {
      action: "production.batch.output_recorded",
      entityType: "production_batch",
      entityId: input.batchId,
      description: `Recorded ${input.quantity} of ${input.outputType} output${
        output.restriction_id ? "; the output lot is held pending inspection" : ""
      }`,
      newValues: { lot_id: output.lot_id, restriction_id: output.restriction_id, quantity: input.quantity },
    },
    meta,
  );

  return { lotId: output.lot_id, restrictionId: output.restriction_id };
}

export async function closeBatch(
  input: { batchId: string; reason?: string | null },
  meta: RequestMeta = {},
): Promise<{ recordedYieldPercent: number | null; withinDeclaredBand: boolean | null }> {
  await requirePermission("production.batch.close");

  const rows = await callInventoryRpc<
    { recorded_yield_percent: number | null; within_declared_band: boolean | null; reference: string }[]
  >("production_close_batch", {
    p_batch_id: input.batchId,
    p_reason: input.reason ?? null,
  });

  const batch = rows[0];
  if (!batch) throw new AppError("VALIDATION_ERROR", "The database did not return the closed batch.");

  await recordInventoryAudit(
    {
      action: "production.batch.closed",
      entityType: "production_batch",
      entityId: input.batchId,
      description:
        batch.recorded_yield_percent === null
          ? `Closed batch ${batch.reference}; input and output are in different units, so no yield percentage is stated`
          : `Closed batch ${batch.reference} with a recorded yield of ${batch.recorded_yield_percent}%`,
      severity: "notice",
      newValues: { ...batch, reason: input.reason ?? null },
    },
    meta,
  );

  return {
    recordedYieldPercent: batch.recorded_yield_percent,
    withinDeclaredBand: batch.within_declared_band,
  };
}

export async function logEntry(
  input: { batchId: string; body: string; logType?: string; shift?: string | null },
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  await requirePermission("production.batch.execute");

  const rows = await callInventoryRpc<{ id: string }[]>("production_log_batch", {
    p_batch_id: input.batchId,
    p_body: input.body,
    p_log_type: input.logType ?? "note",
    p_shift: input.shift ?? null,
  });

  const log = rows[0];
  if (!log) throw new AppError("VALIDATION_ERROR", "The database did not return a log entry.");

  await recordInventoryAudit(
    {
      action: "production.batch.logged",
      entityType: "production_batch",
      entityId: input.batchId,
      description: `Added a ${input.logType ?? "note"} to the batch log`,
      newValues: { log_id: log.id },
    },
    meta,
  );

  return log;
}

/**
 * Guards a status move the interface offers but does not perform itself.
 *
 * Cancel and abort are lifecycle edges, so they go through the same trigger as everything else; this helper
 * exists only so the service can audit the move. It deliberately does not re-implement the rule.
 */
export async function transitionBatch(
  input: { batchId: string; status: "aborted" | "cancelled" | "completed"; reason: string },
  meta: RequestMeta = {},
): Promise<void> {
  await requirePermission("production.batch.execute");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("production_batches")
    .update({ status: input.status, status_reason: input.reason } as never)
    .eq("id", input.batchId);
  if (error) throw inventoryError(error);

  await recordInventoryAudit(
    {
      action: "production.batch.closed",
      entityType: "production_batch",
      entityId: input.batchId,
      description: `Batch moved to ${input.status}: ${input.reason}`,
      severity: "warning",
    },
    meta,
  );
}

export type { BatchRow, BatchMaterialRow, BatchOutputRow, BatchLogRow, BatchSummaryRow };
