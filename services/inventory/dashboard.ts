import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";
import { getInventorySettings, type InventorySettings } from "@/services/inventory/shared";

/**
 * Inventory overview.
 *
 * Every figure is a count or a sum the database produced from real rows. Where the data does not exist yet —
 * no movements, no lots, nothing received — the number is zero and the page renders an empty state rather
 * than a placeholder that looks like activity.
 */

export type InventoryMetric = { label: string; value: string; hint: string; tone?: "neutral" | "warning" | "danger" };

export type InventoryDashboard = {
  metrics: InventoryMetric[];
  settings: InventorySettings;
  attention: {
    expiringLots: { lotReference: string; productName: string; quantity: number; expiryDate: string; band: string }[];
    activeRestrictions: number;
    restrictedQuantity: number;
    inTransitQuantity: number;
    pendingHandoffs: number;
    ledgerClean: boolean;
  };
  recentMovements: {
    id: string;
    movementReference: string;
    movementDate: string;
    movementType: string;
    direction: string;
    quantity: number;
    productName: string;
    lotReference: string;
    warehouseName: string;
  }[];
};

const number = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

export async function getInventoryDashboard(): Promise<InventoryDashboard> {
  await requirePermission("inventory.dashboard.view");
  const supabase = await createSupabaseServerClient();

  const [
    { count: lotCount },
    { data: availability },
    { count: pendingTransfers },
    { count: openCounts },
    { count: pendingAdjustments },
    { data: expiring },
    { data: integrity },
    { count: pendingHandoffs },
    { data: recent },
  ] = await Promise.all([
    supabase.from("inventory_lots").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("inventory_availability")
      .select("on_hand_quantity, restricted_quantity, reserved_quantity, available_quantity")
      .returns<
        { on_hand_quantity: number; restricted_quantity: number; reserved_quantity: number; available_quantity: number }[]
      >(),
    supabase.from("inventory_transfers").select("id", { count: "exact", head: true }).in("status", ["submitted", "approved"]),
    supabase.from("inventory_stock_counts").select("id", { count: "exact", head: true }).in("status", ["counting", "counted", "submitted"]),
    supabase.from("inventory_stock_adjustments").select("id", { count: "exact", head: true }).in("status", ["draft", "submitted"]),
    supabase
      .from("inventory_expiring_lots")
      .select("lot_reference, product_name, available_quantity, expiry_date, expiry_band")
      .in("expiry_band", ["expired", "within_30_days", "within_90_days"])
      .order("expiry_date", { ascending: true })
      .limit(8)
      .returns<
        { lot_reference: string; product_name: string; available_quantity: number; expiry_date: string; expiry_band: string }[]
      >(),
    supabase
      .from("inventory_ledger_integrity")
      .select("*")
      .maybeSingle<{
        movements_without_lot: number;
        movements_with_bad_direction: number;
        movements_with_non_positive_quantity: number;
        reversals_in_wrong_direction: number;
        lots_with_negative_balance: number;
        lots_with_duplicate_movement_ids: number;
      }>(),
    supabase
      .from("procurement_integration_outbox")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "procurement.goods_receipt.posted")
      .eq("status", "pending"),
    supabase
      .from("inventory_movement_register")
      .select("id, movement_reference, movement_date, movement_type, direction, quantity, product_name, lot_reference, warehouse_name")
      .order("posted_at", { ascending: false })
      .limit(8)
      .returns<
        {
          id: string;
          movement_reference: string;
          movement_date: string;
          movement_type: string;
          direction: string;
          quantity: number;
          product_name: string;
          lot_reference: string;
          warehouse_name: string;
        }[]
      >(),
  ]);

  const rows = availability ?? [];
  const onHand = rows.reduce((total, row) => total + Number(row.on_hand_quantity), 0);
  const restricted = rows.reduce((total, row) => total + Number(row.restricted_quantity), 0);
  const reserved = rows.reduce((total, row) => total + Number(row.reserved_quantity), 0);
  const available = rows.reduce((total, row) => total + Number(row.available_quantity), 0);

  const { data: inTransitRows } = await supabase
    .from("inventory_in_transit")
    .select("in_transit_quantity")
    .returns<{ in_transit_quantity: number }[]>();
  const inTransit = (inTransitRows ?? []).reduce((total, row) => total + Number(row.in_transit_quantity), 0);

  const { count: activeRestrictions } = await supabase
    .from("inventory_restrictions")
    .select("id", { count: "exact", head: true })
    .in("status", ["active", "partially_released"]);

  const ledgerClean =
    integrity !== null &&
    Object.values(integrity).every((value) => Number(value) === 0);

  const metrics: InventoryMetric[] = [
    { label: "Open lots", value: number(lotCount), hint: "Lots that can still receive or issue stock" },
    { label: "On hand", value: number(onHand), hint: "Sum of posted movements per lot" },
    {
      label: "Available",
      value: number(available),
      hint: "On hand less restrictions and reservations",
      tone: restricted + reserved > 0 ? "warning" : "neutral",
    },
    {
      label: "Held back",
      value: number(restricted + reserved),
      hint: `${number(restricted)} restricted · ${number(reserved)} reserved`,
      tone: restricted > 0 ? "warning" : "neutral",
    },
    { label: "In transit", value: number(inTransit), hint: "Dispatched but not yet received at the destination" },
    {
      label: "Awaiting action",
      value: number((pendingTransfers ?? 0) + (openCounts ?? 0) + (pendingAdjustments ?? 0)),
      hint: `${number(pendingTransfers)} transfers · ${number(openCounts)} counts · ${number(pendingAdjustments)} adjustments`,
    },
  ];

  return {
    metrics,
    settings: await getInventorySettings(),
    attention: {
      expiringLots: (expiring ?? []).map((row) => ({
        lotReference: row.lot_reference,
        productName: row.product_name,
        quantity: Number(row.available_quantity),
        expiryDate: row.expiry_date,
        band: row.expiry_band,
      })),
      activeRestrictions: activeRestrictions ?? 0,
      restrictedQuantity: restricted,
      inTransitQuantity: inTransit,
      pendingHandoffs: pendingHandoffs ?? 0,
      ledgerClean,
    },
    recentMovements: (recent ?? []).map((row) => ({
      id: row.id,
      movementReference: row.movement_reference,
      movementDate: row.movement_date,
      movementType: row.movement_type,
      direction: row.direction,
      quantity: Number(row.quantity),
      productName: row.product_name,
      lotReference: row.lot_reference,
      warehouseName: row.warehouse_name,
    })),
  };
}

export type ProductionDashboard = {
  metrics: InventoryMetric[];
  plans: { id: string; reference: string; productName: string; status: string; outstanding: number; progress: number | null }[];
  batches: { id: string; reference: string; productName: string; status: string; output: number; yield: number | null; basis: string | null }[];
  yieldLastClosed: {
    productCode: string;
    productName: string;
    periodMonth: string;
    closedBatches: number;
    averageYield: number | null;
    outsideBand: number;
    incomparable: number;
  }[];
  configuration: { stages: number; routedProducts: number; declaredInputs: number; yieldRules: number };
};

export async function getProductionDashboard(): Promise<ProductionDashboard> {
  await requirePermission("production.dashboard.view");
  const supabase = await createSupabaseServerClient();

  const [
    { count: openPlans },
    { count: runningBatches },
    { data: plans },
    { data: batches },
    { data: yields },
    { count: stages },
    { count: routed },
    { count: inputs },
    { count: rules },
  ] = await Promise.all([
    supabase.from("production_plans").select("id", { count: "exact", head: true }).in("status", ["approved", "in_progress"]),
    supabase.from("production_batches").select("id", { count: "exact", head: true }).eq("status", "in_progress"),
    supabase
      .from("production_plan_progress")
      .select("id, reference, product_name, status, outstanding_quantity, progress_percent")
      .in("status", ["approved", "in_progress", "submitted"])
      .order("planned_date", { ascending: true })
      .limit(6)
      .returns<
        {
          id: string;
          reference: string;
          product_name: string;
          status: string;
          outstanding_quantity: number;
          progress_percent: number | null;
        }[]
      >(),
    supabase
      .from("production_batch_summary")
      .select("id, reference, product_name, status, output_quantity, recorded_yield_percent, recorded_yield_basis")
      .in("status", ["in_progress", "completed"])
      .order("batch_date", { ascending: false })
      .limit(6)
      .returns<
        {
          id: string;
          reference: string;
          product_name: string;
          status: string;
          output_quantity: number;
          recorded_yield_percent: number | null;
          recorded_yield_basis: string | null;
        }[]
      >(),
    supabase
      .from("production_yield_summary")
      .select("product_code, product_name, period_month, closed_batch_count, average_recorded_yield_percent, batches_outside_declared_band, batches_without_comparable_yield")
      .order("period_month", { ascending: false })
      .limit(6)
      .returns<
        {
          product_code: string;
          product_name: string;
          period_month: string;
          closed_batch_count: number;
          average_recorded_yield_percent: number | null;
          batches_outside_declared_band: number;
          batches_without_comparable_yield: number;
        }[]
      >(),
    supabase.from("production_stages").select("id", { count: "exact", head: true }),
    supabase.from("production_product_processes").select("id", { count: "exact", head: true }),
    supabase.from("production_product_inputs").select("id", { count: "exact", head: true }),
    supabase.from("production_yield_rules").select("id", { count: "exact", head: true }),
  ]);

  const metrics: InventoryMetric[] = [
    { label: "Approved / running plans", value: number(openPlans), hint: "Plans the factory is expected to execute" },
    { label: "Batches in progress", value: number(runningBatches), hint: "Batches consuming material right now" },
    { label: "Declared stages", value: number(stages), hint: "Process stages configured by the factory" },
    {
      label: "Yield rules",
      value: number(rules),
      hint: rules ? "Products with a declared acceptable yield band" : "None declared: every batch close needs a stated reason",
      tone: rules ? "neutral" : "warning",
    },
  ];

  return {
    metrics,
    plans: (plans ?? []).map((plan) => ({
      id: plan.id,
      reference: plan.reference,
      productName: plan.product_name,
      status: plan.status,
      outstanding: Number(plan.outstanding_quantity),
      progress: plan.progress_percent === null ? null : Number(plan.progress_percent),
    })),
    batches: (batches ?? []).map((batch) => ({
      id: batch.id,
      reference: batch.reference,
      productName: batch.product_name,
      status: batch.status,
      output: Number(batch.output_quantity),
      yield: batch.recorded_yield_percent === null ? null : Number(batch.recorded_yield_percent),
      basis: batch.recorded_yield_basis,
    })),
    yieldLastClosed: (yields ?? []).map((row) => ({
      productCode: row.product_code,
      productName: row.product_name,
      periodMonth: row.period_month,
      closedBatches: row.closed_batch_count,
      averageYield: row.average_recorded_yield_percent === null ? null : Number(row.average_recorded_yield_percent),
      outsideBand: row.batches_outside_declared_band,
      incomparable: row.batches_without_comparable_yield,
    })),
    configuration: {
      stages: stages ?? 0,
      routedProducts: routed ?? 0,
      declaredInputs: inputs ?? 0,
      yieldRules: rules ?? 0,
    },
  };
}

/** Loads the production configuration for the settings page. Configuration, not history. */
export async function getProductionConfiguration(): Promise<{
  stages: { id: string; code: string; name: string; sequence: number; is_active: boolean; description: string | null }[];
  processes: {
    id: string;
    productName: string;
    stageName: string;
    sequence: number;
    expectedDurationHours: number | null;
  }[];
  inputs: {
    id: string;
    productName: string;
    inputProductName: string;
    quantity: number;
    basisQuantity: number;
    unitCode: string;
    isOptional: boolean;
  }[];
  yieldRules: {
    id: string;
    productName: string;
    basis: string;
    minPercent: number | null;
    maxPercent: number | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    isActive: boolean;
  }[];
}> {
  await requirePermission("production.product.view");
  const supabase = await createSupabaseServerClient();

  const [{ data: stages }, { data: processes }, { data: inputs }, { data: rules }] = await Promise.all([
    supabase
      .from("production_stages")
      .select("id, code, name, sequence, is_active, description")
      .order("sequence")
      .returns<
        { id: string; code: string; name: string; sequence: number; is_active: boolean; description: string | null }[]
      >(),
    supabase
      .from("production_product_processes")
      .select("id, sequence, expected_duration_hours, product:products(name), stage:production_stages(name)")
      .order("sequence")
      .returns<
        {
          id: string;
          sequence: number;
          expected_duration_hours: number | null;
          product: { name: string } | null;
          stage: { name: string } | null;
        }[]
      >(),
    supabase
      .from("production_product_inputs")
      .select("id, quantity, basis_quantity, is_optional, product:products!production_product_inputs_product_id_fkey(name), input:products!production_product_inputs_input_product_id_fkey(name), unit:units_of_measure(code)")
      .returns<
        {
          id: string;
          quantity: number;
          basis_quantity: number;
          is_optional: boolean;
          product: { name: string } | null;
          input: { name: string } | null;
          unit: { code: string } | null;
        }[]
      >(),
    supabase
      .from("production_yield_rules")
      .select("id, basis, min_percent, max_percent, effective_from, effective_to, is_active, product:products(name)")
      .order("effective_from", { ascending: false })
      .returns<
        {
          id: string;
          basis: string;
          min_percent: number | null;
          max_percent: number | null;
          effective_from: string;
          effective_to: string | null;
          is_active: boolean;
          product: { name: string } | null;
        }[]
      >(),
  ]);

  return {
    stages: stages ?? [],
    processes: (processes ?? []).map((row) => ({
      id: row.id,
      productName: row.product?.name ?? "—",
      stageName: row.stage?.name ?? "—",
      sequence: row.sequence,
      expectedDurationHours: row.expected_duration_hours === null ? null : Number(row.expected_duration_hours),
    })),
    inputs: (inputs ?? []).map((row) => ({
      id: row.id,
      productName: row.product?.name ?? "—",
      inputProductName: row.input?.name ?? "—",
      quantity: Number(row.quantity),
      basisQuantity: Number(row.basis_quantity),
      unitCode: row.unit?.code ?? "—",
      isOptional: row.is_optional,
    })),
    yieldRules: (rules ?? []).map((row) => ({
      id: row.id,
      productName: row.product?.name ?? "—",
      basis: row.basis,
      minPercent: row.min_percent === null ? null : Number(row.min_percent),
      maxPercent: row.max_percent === null ? null : Number(row.max_percent),
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      isActive: row.is_active,
    })),
  };
}

/** Saves one configuration row through the tables, which are the only writers of configuration. */
export async function createStage(
  input: { code: string; name: string; sequence: string; description?: string | null },
): Promise<{ id: string }> {
  await requirePermission("production.product.manage");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("production_stages")
    .insert({
      code: input.code.trim().toUpperCase(),
      name: input.name,
      sequence: Number(input.sequence),
      description: input.description ?? null,
    } as never)
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new AppError("VALIDATION_ERROR", error?.message ?? "The stage was not created.");
  return data;
}

/**
 * Saves one routing step: "this product passes through this stage, in this order".
 *
 * Routing is descriptive. `production_plan_apply_declared_inputs` reads declared inputs, not processes, so a
 * route records how the factory works without asserting a material requirement the company has not stated.
 */
export async function createProcess(input: {
  productId: string;
  stageId: string;
  sequence: string;
  expectedDurationHours?: string | null;
  instructions?: string | null;
}): Promise<{ id: string }> {
  await requirePermission("production.product.manage");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("production_product_processes")
    .insert({
      product_id: input.productId,
      stage_id: input.stageId,
      sequence: Number(input.sequence),
      expected_duration_hours: input.expectedDurationHours
        ? (input.expectedDurationHours as unknown as number)
        : null,
      instructions: input.instructions ?? null,
    } as never)
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new AppError("VALIDATION_ERROR", error?.message ?? "The routing step was not saved.");
  return data;
}

/**
 * Saves a declared input.
 *
 * This is the row that makes `production_plan_apply_declared_inputs` produce anything. It records what the
 * company says it uses; the system never fills it in.
 */
export async function createDeclaredInput(input: {
  productId: string;
  inputProductId: string;
  unitId: string;
  quantity: string;
  basisQuantity: string;
  isOptional: boolean;
  notes?: string | null;
}): Promise<{ id: string }> {
  await requirePermission("production.product.manage");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("production_product_inputs")
    .insert({
      product_id: input.productId,
      input_product_id: input.inputProductId,
      unit_id: input.unitId,
      quantity: input.quantity as unknown as number,
      basis_quantity: input.basisQuantity as unknown as number,
      is_optional: input.isOptional,
      notes: input.notes ?? null,
    } as never)
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new AppError("VALIDATION_ERROR", error?.message ?? "The declared input was not saved.");
  return data;
}

export async function createYieldRule(input: {
  productId: string;
  basis: string;
  minPercent?: string | null;
  maxPercent?: string | null;
  effectiveFrom: string;
  notes?: string | null;
}): Promise<{ id: string }> {
  await requirePermission("production.product.manage");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("production_yield_rules")
    .insert({
      product_id: input.productId,
      basis: input.basis,
      min_percent: input.minPercent ? (input.minPercent as unknown as number) : null,
      max_percent: input.maxPercent ? (input.maxPercent as unknown as number) : null,
      effective_from: input.effectiveFrom,
      notes: input.notes ?? null,
    } as never)
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new AppError("VALIDATION_ERROR", error?.message ?? "The yield rule was not saved.");
  return data;
}
