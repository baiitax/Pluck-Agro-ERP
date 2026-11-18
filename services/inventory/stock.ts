import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";
import type { Database } from "@/types/database.types";
import {
  callInventoryRpc,
  inventoryError,
  numeric,
  recordInventoryAudit,
  type RegisterPage,
} from "@/services/inventory/shared";
import type { RequestMeta } from "@/services/employees/manage-employee";

type AvailabilityRow = Database["public"]["Views"]["inventory_availability"]["Row"];
type MovementRow = Database["public"]["Views"]["inventory_movement_register"]["Row"];
type StockSummaryRow = Database["public"]["Views"]["inventory_stock_summary"]["Row"];
type LotRow = Database["public"]["Tables"]["inventory_lots"]["Row"];
type RestrictionRow = Database["public"]["Views"]["inventory_restriction_register"]["Row"];
type ReservationRow = Database["public"]["Views"]["inventory_reservation_register"]["Row"];

/**
 * Stock reading.
 *
 * Everything here is a read of a view that recomputes from the ledger. No function in this file adds,
 * subtracts or rounds a quantity: `available_quantity` arrives from `inventory_availability`, which applies
 * the same definition the reservation and issue functions enforce. If the interface and the database could
 * disagree about what is available, the interface would be the wrong place to find out.
 */

export type StockFilters = {
  search?: string;
  warehouseId?: string;
  productId?: string;
  onlyWithStock?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listStockSummary(filters: StockFilters = {}): Promise<RegisterPage<StockSummaryRow>> {
  await requirePermission("inventory.stock.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));

  let query = supabase
    .from("inventory_stock_summary")
    .select("*", { count: "exact" })
    .order("product_name", { ascending: true })
    .order("warehouse_name", { ascending: true });

  if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
  if (filters.productId) query = query.eq("product_id", filters.productId);
  if (filters.onlyWithStock !== false) query = query.gt("on_hand_quantity", 0);
  if (filters.search) {
    const term = filters.search.replace(/[%,]/g, "").trim();
    if (term) query = query.or(`product_code.ilike.%${term}%,product_name.ilike.%${term}%,warehouse_name.ilike.%${term}%`);
  }

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Stock could not be loaded. ${error.message}`);

  const total = count ?? 0;
  return { rows: data ?? [], page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export type LotFilters = {
  search?: string;
  status?: string;
  warehouseId?: string;
  productId?: string;
  page?: number;
  pageSize?: number;
};

export async function listLots(filters: LotFilters = {}): Promise<RegisterPage<AvailabilityRow>> {
  await requirePermission("inventory.stock.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));

  let query = supabase.from("inventory_availability").select("*", { count: "exact" }).order("lot_reference", { ascending: false });

  if (filters.status) query = query.eq("lot_status", filters.status);
  if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
  if (filters.productId) query = query.eq("product_id", filters.productId);
  if (filters.search) {
    const term = filters.search.replace(/[%,]/g, "").trim();
    if (term) query = query.or(`lot_reference.ilike.%${term}%,product_name.ilike.%${term}%,product_code.ilike.%${term}%`);
  }

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Lots could not be loaded. ${error.message}`);

  const total = count ?? 0;
  return { rows: data ?? [], page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export type LotDetail = {
  lot: AvailabilityRow;
  movements: MovementRow[];
  restrictions: RestrictionRow[];
  reservations: ReservationRow[];
  source: {
    supplierName: string | null;
    goodsReceiptReference: string | null;
    productionBatchReference: string | null;
  };
};

export async function getLotDetail(lotId: string): Promise<LotDetail> {
  await requirePermission("inventory.stock.view");
  const supabase = await createSupabaseServerClient();

  const { data: lot, error } = await supabase
    .from("inventory_availability")
    .select("*")
    .eq("lot_id", lotId)
    .maybeSingle<AvailabilityRow>();

  if (error) throw new AppError("DATABASE_ERROR", `That lot could not be loaded. ${error.message}`);
  if (!lot) throw new AppError("NOT_FOUND", "That lot does not exist, or you cannot see it.");

  const [{ data: movements }, { data: restrictions }, { data: reservations }] = await Promise.all([
    supabase
      .from("inventory_movement_register")
      .select("*")
      .eq("lot_id", lotId)
      .order("posted_at", { ascending: false })
      .returns<MovementRow[]>(),
    supabase
      .from("inventory_restriction_register")
      .select("*")
      .eq("lot_id", lotId)
      .order("created_at", { ascending: false })
      .returns<RestrictionRow[]>(),
    supabase
      .from("inventory_reservation_register")
      .select("*")
      .eq("lot_id", lotId)
      .order("created_at", { ascending: false })
      .returns<ReservationRow[]>(),
  ]);

  let supplierName: string | null = null;
  if (lot.supplier_id) {
    const { data } = await supabase
      .from("suppliers")
      .select("legal_name")
      .eq("id", lot.supplier_id)
      .maybeSingle<{ legal_name: string }>();
    supplierName = data?.legal_name ?? null;
  }

  let goodsReceiptReference: string | null = null;
  if (lot.goods_receipt_id) {
    const { data } = await supabase
      .from("goods_receipts")
      .select("reference")
      .eq("id", lot.goods_receipt_id)
      .maybeSingle<{ reference: string }>();
    goodsReceiptReference = data?.reference ?? null;
  }

  let productionBatchReference: string | null = null;
  if (lot.production_batch_id) {
    const { data } = await supabase
      .from("production_batches")
      .select("reference")
      .eq("id", lot.production_batch_id)
      .maybeSingle<{ reference: string }>();
    productionBatchReference = data?.reference ?? null;
  }

  return {
    lot,
    movements: movements ?? [],
    restrictions: restrictions ?? [],
    reservations: reservations ?? [],
    source: { supplierName, goodsReceiptReference, productionBatchReference },
  };
}

export type MovementFilters = {
  search?: string;
  movementType?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export async function listMovements(filters: MovementFilters = {}): Promise<RegisterPage<MovementRow>> {
  await requirePermission("inventory.stock.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, filters.pageSize ?? 50));

  let query = supabase
    .from("inventory_movement_register")
    .select("*", { count: "exact" })
    .order("posted_at", { ascending: false });

  if (filters.movementType) query = query.eq("movement_type", filters.movementType);
  if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
  if (filters.from) query = query.gte("movement_date", filters.from);
  if (filters.to) query = query.lte("movement_date", filters.to);
  if (filters.search) {
    const term = filters.search.replace(/[%,]/g, "").trim();
    if (term) {
      query = query.or(
        `movement_reference.ilike.%${term}%,lot_reference.ilike.%${term}%,product_name.ilike.%${term}%,source_reference.ilike.%${term}%`,
      );
    }
  }

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Movements could not be loaded. ${error.message}`);

  const total = count ?? 0;
  return { rows: data ?? [], page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getLedgerIntegrity(): Promise<Database["public"]["Views"]["inventory_ledger_integrity"]["Row"]> {
  await requirePermission("inventory.stock.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inventory_ledger_integrity")
    .select("*")
    .maybeSingle<Database["public"]["Views"]["inventory_ledger_integrity"]["Row"]>();
  if (error) throw new AppError("DATABASE_ERROR", `The ledger check could not be run. ${error.message}`);
  if (!data) throw new AppError("DATABASE_ERROR", "The ledger check returned nothing.");
  return data;
}

export async function listRestrictions(activeOnly = true): Promise<RestrictionRow[]> {
  await requirePermission("inventory.restriction.view");
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("inventory_restriction_register")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (activeOnly) query = query.in("status", ["active", "partially_released"]);
  const { data, error } = await query.returns<RestrictionRow[]>();
  if (error) throw new AppError("DATABASE_ERROR", `Restrictions could not be loaded. ${error.message}`);
  return data ?? [];
}

export async function listReservations(activeOnly = true): Promise<ReservationRow[]> {
  await requirePermission("inventory.reservation.view");
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("inventory_reservation_register")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (activeOnly) query = query.in("status", ["active", "partially_released"]);
  const { data, error } = await query.returns<ReservationRow[]>();
  if (error) throw new AppError("DATABASE_ERROR", `Reservations could not be loaded. ${error.message}`);
  return data ?? [];
}

export type CreateLotInput = {
  productId: string;
  unitId: string;
  warehouseId: string;
  locationId?: string | null;
  receivedDate: string;
  expiryDate?: string | null;
  manufactureDate?: string | null;
  grade?: string | null;
  notes?: string | null;
  /** Opening quantity, posted as a single `opening_balance` movement in the same transaction. */
  openingQuantity?: string | null;
};

/**
 * Registers a lot, optionally with an opening quantity.
 *
 * Opening balances are the one place where stock enters without a source document, so they are an explicit
 * act with their own permission and their own movement type rather than a magic column. The quantity is
 * posted as a movement for exactly that reason: it appears in the register like everything else, and it can
 * be reversed like everything else.
 */
export async function createLot(input: CreateLotInput, meta: RequestMeta = {}): Promise<{ id: string; lotReference: string }> {
  await requirePermission("inventory.lot.create");
  const supabase = await createSupabaseServerClient();

  const { data: lot, error } = await supabase
    .from("inventory_lots")
    .insert({
      product_id: input.productId,
      unit_id: input.unitId,
      warehouse_id: input.warehouseId,
      location_id: input.locationId ?? null,
      source_type: "opening_balance",
      received_date: input.receivedDate,
      manufacture_date: input.manufactureDate ?? null,
      expiry_date: input.expiryDate ?? null,
      grade: input.grade ?? null,
      notes: input.notes ?? null,
    } as never)
    .select("id, lot_reference")
    .single<{ id: string; lot_reference: string }>();

  if (error || !lot) throw inventoryError(error ?? new Error("The lot was not created."));

  const opening = input.openingQuantity?.trim();
  if (opening && Number(opening) > 0) {
    await requirePermission("inventory.stock.post");
    const { error: movementError } = await supabase.from("inventory_movements").insert({
      lot_id: lot.id,
      product_id: input.productId,
      unit_id: input.unitId,
      warehouse_id: input.warehouseId,
      location_id: input.locationId ?? null,
      movement_type: "opening_balance",
      direction: "in",
      quantity: numeric(opening),
      idempotency_key: `opening:${lot.id}`,
      source_module: "inventory",
      source_type: "opening_balance",
      source_id: lot.id,
      source_reference: lot.lot_reference,
      movement_date: input.receivedDate,
      reason: "Opening balance recorded when the lot was registered",
    } as never);
    if (movementError) throw inventoryError(movementError);
  }

  await recordInventoryAudit(
    {
      action: "inventory.lot.created",
      entityType: "inventory_lot",
      entityId: lot.id,
      description: `Registered lot ${lot.lot_reference}${opening ? ` with an opening quantity of ${opening}` : ""}`,
      newValues: { lot_reference: lot.lot_reference, opening_quantity: opening ?? null },
    },
    meta,
  );

  return { id: lot.id, lotReference: lot.lot_reference };
}

/**
 * Applies a restriction through the Phase 5 seam.
 *
 * The service does not decide whether the restriction is meaningful — the database refuses a quantity
 * larger than what is available and returns the real restriction row. If the call fails, the caller is told
 * exactly that; nothing here reports a hold that was not recorded.
 */
export async function applyRestriction(
  input: {
    lotId: string;
    quantity: string;
    restrictionType: string;
    reasonCode: string;
    reason: string;
    expiresAt?: string | null;
    idempotencyKey?: string | null;
  },
  meta: RequestMeta = {},
): Promise<{ id: string; reference: string; status: string }> {
  await requirePermission("inventory.restriction.manage");

  const rows = await callInventoryRpc<
    { id: string; restriction_reference: string; status: string }[]
  >("inventory_apply_restriction", {
    p_lot_id: input.lotId,
    p_quantity: numeric(input.quantity),
    p_reason_code: input.reasonCode,
    p_source_module: "inventory",
    p_source_type: "manual_restriction",
    p_reason: input.reason,
    p_restriction_type: input.restrictionType,
    p_expires_at: input.expiresAt ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  const restriction = rows[0];
  if (!restriction) throw new AppError("VALIDATION_ERROR", "The database did not return a restriction.");

  await recordInventoryAudit(
    {
      action: "inventory.restriction.applied",
      entityType: "inventory_restriction",
      entityId: restriction.id,
      description: `Applied a ${input.restrictionType} of ${input.quantity} on lot ${input.lotId}`,
      severity: "warning",
      newValues: { ...restriction, quantity: input.quantity, reason: input.reason },
    },
    meta,
  );

  return { id: restriction.id, reference: restriction.restriction_reference, status: restriction.status };
}

export async function releaseRestriction(
  input: { restrictionId: string; quantity: string; reason: string },
  meta: RequestMeta = {},
): Promise<{ id: string; status: string }> {
  await requirePermission("inventory.restriction.release");

  const rows = await callInventoryRpc<{ id: string; status: string }[]>("inventory_release_restriction", {
    p_restriction_id: input.restrictionId,
    p_quantity: numeric(input.quantity),
    p_reason: input.reason,
  });

  const restriction = rows[0];
  if (!restriction) throw new AppError("VALIDATION_ERROR", "The database did not return a restriction.");

  await recordInventoryAudit(
    {
      action: "inventory.restriction.released",
      entityType: "inventory_restriction",
      entityId: restriction.id,
      description: `Released ${input.quantity} from restriction ${restriction.id}`,
      severity: "notice",
      newValues: { ...restriction, released_quantity: input.quantity, reason: input.reason },
    },
    meta,
  );

  return restriction;
}

export async function reserveStock(
  input: {
    lotId: string;
    quantity: string;
    reservedForModule: string;
    reservedForType: string;
    reservedForReference?: string | null;
    notes?: string | null;
  },
  meta: RequestMeta = {},
): Promise<{ id: string; reference: string; status: string }> {
  await requirePermission("inventory.reservation.manage");

  const rows = await callInventoryRpc<{ id: string; reference: string; status: string }[]>(
    "inventory_reserve_stock",
    {
      p_lot_id: input.lotId,
      p_quantity: numeric(input.quantity),
      p_reserved_for_module: input.reservedForModule,
      p_reserved_for_type: input.reservedForType,
      p_reserved_for_reference: input.reservedForReference ?? null,
      p_notes: input.notes ?? null,
    },
  );

  const reservation = rows[0];
  if (!reservation) throw new AppError("VALIDATION_ERROR", "The database did not return a reservation.");

  await recordInventoryAudit(
    {
      action: "inventory.reservation.created",
      entityType: "inventory_reservation",
      entityId: reservation.id,
      description: `Reserved ${input.quantity} of lot ${input.lotId} for ${input.reservedForModule}/${input.reservedForType}`,
      newValues: { ...reservation, quantity: input.quantity },
    },
    meta,
  );

  return reservation;
}

export async function releaseReservation(
  input: { reservationId: string; quantity: string; reason: string },
  meta: RequestMeta = {},
): Promise<{ id: string; status: string }> {
  await requirePermission("inventory.reservation.release");

  const rows = await callInventoryRpc<{ id: string; status: string }[]>("inventory_release_reservation", {
    p_reservation_id: input.reservationId,
    p_quantity: numeric(input.quantity),
    p_reason: input.reason,
  });

  const reservation = rows[0];
  if (!reservation) throw new AppError("VALIDATION_ERROR", "The database did not return a reservation.");

  await recordInventoryAudit(
    {
      action: "inventory.reservation.released",
      entityType: "inventory_reservation",
      entityId: reservation.id,
      description: `Released ${input.quantity} from reservation ${reservation.id}: ${input.reason}`,
      newValues: { ...reservation, released_quantity: input.quantity },
    },
    meta,
  );

  return reservation;
}

/** Lots the caller may pick from, for the select controls on the transfer and issue forms. */
export async function listSelectableLots(warehouseId?: string): Promise<
  { id: string; label: string; available: number }[]
> {
  await requirePermission("inventory.stock.view");
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("inventory_availability")
    .select("lot_id, lot_reference, product_code, product_name, unit_code, available_quantity, warehouse_name")
    .gt("available_quantity", 0)
    .order("lot_reference", { ascending: true })
    .limit(300);
  if (warehouseId) query = query.eq("warehouse_id", warehouseId);

  const { data, error } = await query.returns<
    {
      lot_id: string;
      lot_reference: string;
      product_code: string;
      product_name: string;
      unit_code: string;
      available_quantity: number;
      warehouse_name: string;
    }[]
  >();
  if (error) throw new AppError("DATABASE_ERROR", `Lots could not be loaded. ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.lot_id,
    label: `${row.lot_reference} · ${row.product_code} ${row.product_name} · ${row.warehouse_name} · ${row.available_quantity} ${row.unit_code} available`,
    available: Number(row.available_quantity),
  }));
}

/** Warehouses for select controls. */
export async function listWarehouses(): Promise<{ id: string; name: string }[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("warehouses")
    .select("id, name")
    .order("name")
    .returns<{ id: string; name: string }[]>();
  if (error) throw new AppError("DATABASE_ERROR", `Warehouses could not be loaded. ${error.message}`);
  return data ?? [];
}

/** Products for select controls. */
export async function listProducts(): Promise<{ id: string; label: string; unitId: string }[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, code, name, base_unit_id")
    .eq("status", "active")
    .order("name")
    .returns<{ id: string; code: string; name: string; base_unit_id: string }[]>();
  if (error) throw new AppError("DATABASE_ERROR", `Products could not be loaded. ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    label: `${row.code} · ${row.name}`,
    unitId: row.base_unit_id,
  }));
}

/** Units of measure for select controls. Configuration is expressed in units, so the picker needs codes. */
export async function listUnits(): Promise<{ id: string; label: string }[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("units_of_measure")
    .select("id, code, name")
    .order("code")
    .returns<{ id: string; code: string; name: string }[]>();
  if (error) throw new AppError("DATABASE_ERROR", `Units could not be loaded. ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id, label: `${row.code} · ${row.name}` }));
}

export type { AvailabilityRow, MovementRow, StockSummaryRow, LotRow, RestrictionRow, ReservationRow };
