import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";

/**
 * Inventory and production reporting.
 *
 * What these reports are: registers and derived quantities from posted documents.
 *
 * What they are **not**: a valuation. `inventory_movements.recorded_value` holds the cost *stated by the
 * source document* — what the goods receipt said, what the adjustment said. Turning those into a stock value
 * requires a valuation method (FIFO, weighted average, standard cost) and Pluck Agro has not chosen one. A
 * report that presented a weighted number without saying which method produced it would be inventing an
 * accounting policy, so this module reports quantities and recorded values separately and never divides one
 * lot's cost into another's quantity.
 */

export type StockReport = {
  rows: {
    productCode: string;
    productName: string;
    unitCode: string;
    warehouseName: string;
    lotCount: number;
    onHand: number;
    restricted: number;
    reserved: number;
    available: number;
    earliestExpiry: string | null;
  }[];
  totals: { onHand: number; restricted: number; reserved: number; available: number };
};

export async function getStockReport(filters: { warehouseId?: string } = {}): Promise<StockReport> {
  await requirePermission("inventory.reports.view");
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("inventory_stock_summary")
    .select("*")
    .order("product_name")
    .order("warehouse_name");
  if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);

  const { data, error } = await query.returns<
    {
      product_code: string;
      product_name: string;
      unit_code: string;
      warehouse_name: string;
      lot_count: number;
      on_hand_quantity: number;
      restricted_quantity: number;
      reserved_quantity: number;
      available_quantity: number;
      earliest_expiry_date: string | null;
    }[]
  >();
  if (error) throw new AppError("DATABASE_ERROR", `The stock report could not be loaded. ${error.message}`);

  const rows = (data ?? []).map((row) => ({
    productCode: row.product_code,
    productName: row.product_name,
    unitCode: row.unit_code,
    warehouseName: row.warehouse_name,
    lotCount: Number(row.lot_count),
    onHand: Number(row.on_hand_quantity),
    restricted: Number(row.restricted_quantity),
    reserved: Number(row.reserved_quantity),
    available: Number(row.available_quantity),
    earliestExpiry: row.earliest_expiry_date,
  }));

  return {
    rows,
    totals: rows.reduce(
      (totals, row) => ({
        onHand: totals.onHand + row.onHand,
        restricted: totals.restricted + row.restricted,
        reserved: totals.reserved + row.reserved,
        available: totals.available + row.available,
      }),
      { onHand: 0, restricted: 0, reserved: 0, available: 0 },
    ),
  };
}

export type MovementReportRow = {
  movementDate: string;
  movementReference: string;
  movementType: string;
  direction: string;
  quantity: number;
  productCode: string;
  productName: string;
  lotReference: string;
  warehouseName: string;
  sourceType: string;
  sourceReference: string | null;
  postedByName: string | null;
  recordedCost: string | null;
};

/**
 * Movements with the cost their source document stated.
 *
 * `recorded_value` is shown as stated, per movement, with the currency it was stated in. Summing it across
 * mixed currencies, or across movements whose source documents stated nothing, would produce a number that
 * looks like a valuation and is not one, so the report deliberately shows per-row values and a count of rows
 * with no stated cost instead.
 */
export async function getMovementReport(filters: { from?: string; to?: string; movementType?: string } = {}): Promise<{
  rows: MovementReportRow[];
  rowsWithoutStatedCost: number;
}> {
  await requirePermission("inventory.reports.view");
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("inventory_movement_register")
    .select(
      "movement_date, movement_reference, movement_type, direction, quantity, product_code, product_name, lot_reference, warehouse_name, source_type, source_reference, posted_by_name, id",
    )
    .order("posted_at", { ascending: false })
    .limit(500);
  if (filters.from) query = query.gte("movement_date", filters.from);
  if (filters.to) query = query.lte("movement_date", filters.to);
  if (filters.movementType) query = query.eq("movement_type", filters.movementType);

  const { data, error } = await query.returns<
    {
      movement_date: string;
      movement_reference: string;
      movement_type: string;
      direction: string;
      quantity: number;
      product_code: string;
      product_name: string;
      lot_reference: string;
      warehouse_name: string;
      source_type: string;
      source_reference: string | null;
      posted_by_name: string | null;
      id: string;
    }[]
  >();
  if (error) throw new AppError("DATABASE_ERROR", `The movement report could not be loaded. ${error.message}`);

  const ids = (data ?? []).map((row) => row.id);
  const { data: values } = ids.length
    ? await supabase
        .from("inventory_movements")
        .select("id, recorded_value, currency_code")
        .in("id", ids)
        .returns<{ id: string; recorded_value: number | null; currency_code: string | null }[]>()
    : { data: [] as { id: string; recorded_value: number | null; currency_code: string | null }[] };

  const valueById = new Map((values ?? []).map((row) => [row.id, row]));
  let rowsWithoutStatedCost = 0;

  const rows = (data ?? []).map((row) => {
    const value = valueById.get(row.id);
    if (value?.recorded_value === null || value?.recorded_value === undefined) rowsWithoutStatedCost += 1;
    return {
      movementDate: row.movement_date,
      movementReference: row.movement_reference,
      movementType: row.movement_type,
      direction: row.direction,
      quantity: Number(row.quantity),
      productCode: row.product_code,
      productName: row.product_name,
      lotReference: row.lot_reference,
      warehouseName: row.warehouse_name,
      sourceType: row.source_type,
      sourceReference: row.source_reference,
      postedByName: row.posted_by_name,
      recordedCost:
        value?.recorded_value === null || value?.recorded_value === undefined
          ? null
          : `${value.currency_code ?? ""} ${Number(value.recorded_value).toFixed(2)}`.trim(),
    };
  });

  return { rows, rowsWithoutStatedCost };
}

export type ExpiryReportRow = {
  lotReference: string;
  productCode: string;
  productName: string;
  warehouseName: string;
  onHand: number;
  available: number;
  expiryDate: string;
  daysToExpiry: number;
  band: string;
};

export async function getExpiryReport(): Promise<ExpiryReportRow[]> {
  await requirePermission("inventory.reports.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inventory_expiring_lots")
    .select("*")
    .order("expiry_date", { ascending: true })
    .returns<
      {
        lot_reference: string;
        product_code: string;
        product_name: string;
        warehouse_name: string;
        on_hand_quantity: number;
        available_quantity: number;
        expiry_date: string;
        days_to_expiry: number;
        expiry_band: string;
      }[]
    >();
  if (error) throw new AppError("DATABASE_ERROR", `The expiry report could not be loaded. ${error.message}`);

  return (data ?? []).map((row) => ({
    lotReference: row.lot_reference,
    productCode: row.product_code,
    productName: row.product_name,
    warehouseName: row.warehouse_name,
    onHand: Number(row.on_hand_quantity),
    available: Number(row.available_quantity),
    expiryDate: row.expiry_date,
    daysToExpiry: Number(row.days_to_expiry),
    band: row.expiry_band,
  }));
}

export type HoldReportRow = {
  reference: string;
  type: string;
  lotReference: string;
  productName: string;
  outstanding: number;
  status: string;
  reason: string | null;
  sourceModule: string;
  createdAt: string;
};

export async function getHoldReport(): Promise<HoldReportRow[]> {
  await requirePermission("inventory.reports.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inventory_restriction_register")
    .select("*")
    .in("status", ["active", "partially_released"])
    .order("created_at", { ascending: false })
    .returns<
      {
        restriction_reference: string;
        restriction_type: string;
        lot_reference: string;
        product_name: string;
        outstanding_quantity: number;
        status: string;
        reason: string | null;
        source_module: string;
        created_at: string;
      }[]
    >();
  if (error) throw new AppError("DATABASE_ERROR", `The hold report could not be loaded. ${error.message}`);

  return (data ?? []).map((row) => ({
    reference: row.restriction_reference,
    type: row.restriction_type,
    lotReference: row.lot_reference,
    productName: row.product_name,
    outstanding: Number(row.outstanding_quantity),
    status: row.status,
    reason: row.reason,
    sourceModule: row.source_module,
    createdAt: row.created_at,
  }));
}

export type YieldReportRow = {
  productCode: string;
  productName: string;
  periodMonth: string;
  closedBatches: number;
  totalIssued: number;
  totalOutput: number;
  totalWaste: number;
  averageYield: number | null;
  lowestYield: number | null;
  highestYield: number | null;
  outsideBand: number;
  incomparable: number;
};

export async function getYieldReport(): Promise<YieldReportRow[]> {
  await requirePermission("production.reports.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("production_yield_summary")
    .select("*")
    .order("period_month", { ascending: false })
    .returns<
      {
        product_code: string;
        product_name: string;
        period_month: string;
        closed_batch_count: number;
        total_issued_quantity: number;
        total_output_quantity: number;
        total_waste_quantity: number;
        average_recorded_yield_percent: number | null;
        lowest_recorded_yield_percent: number | null;
        highest_recorded_yield_percent: number | null;
        batches_outside_declared_band: number;
        batches_without_comparable_yield: number;
      }[]
    >();
  if (error) throw new AppError("DATABASE_ERROR", `The yield report could not be loaded. ${error.message}`);

  return (data ?? []).map((row) => ({
    productCode: row.product_code,
    productName: row.product_name,
    periodMonth: row.period_month,
    closedBatches: row.closed_batch_count,
    totalIssued: Number(row.total_issued_quantity),
    totalOutput: Number(row.total_output_quantity),
    totalWaste: Number(row.total_waste_quantity),
    averageYield: row.average_recorded_yield_percent === null ? null : Number(row.average_recorded_yield_percent),
    lowestYield: row.lowest_recorded_yield_percent === null ? null : Number(row.lowest_recorded_yield_percent),
    highestYield: row.highest_recorded_yield_percent === null ? null : Number(row.highest_recorded_yield_percent),
    outsideBand: row.batches_outside_declared_band,
    incomparable: row.batches_without_comparable_yield,
  }));
}

export type ConsumptionReportRow = {
  batchReference: string;
  batchDate: string;
  productCode: string;
  productName: string;
  unitCode: string;
  consumed: number;
  issueCount: number;
  lotCount: number;
};

export async function getConsumptionReport(): Promise<ConsumptionReportRow[]> {
  await requirePermission("production.reports.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("production_material_consumption")
    .select("*")
    .order("batch_date", { ascending: false })
    .limit(300)
    .returns<
      {
        batch_reference: string;
        batch_date: string;
        product_code: string;
        product_name: string;
        unit_code: string;
        consumed_quantity: number;
        issue_count: number;
        lot_count: number;
      }[]
    >();
  if (error) throw new AppError("DATABASE_ERROR", `The consumption report could not be loaded. ${error.message}`);

  return (data ?? []).map((row) => ({
    batchReference: row.batch_reference,
    batchDate: row.batch_date,
    productCode: row.product_code,
    productName: row.product_name,
    unitCode: row.unit_code,
    consumed: Number(row.consumed_quantity),
    issueCount: row.issue_count,
    lotCount: row.lot_count,
  }));
}
