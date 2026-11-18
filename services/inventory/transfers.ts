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

type TransferRow = Database["public"]["Tables"]["inventory_transfers"]["Row"];
type TransferItemRow = Database["public"]["Tables"]["inventory_transfer_items"]["Row"];
type InTransitRow = Database["public"]["Views"]["inventory_in_transit"]["Row"];

/**
 * Stock transfers between warehouses.
 *
 * A transfer is two movements, not one: `transfer_out` leaves the source lot when the load is dispatched,
 * and `transfer_in` arrives in a *new* lot at the destination when it is received. Between those two
 * moments the quantity is neither here nor there in balance terms — it is visible in `inventory_in_transit`,
 * which is derived from the transfer document rather than from an "in transit" bucket somebody has to keep
 * up to date.
 *
 * The service never decides what is available: dispatch is refused by the database when the line's lot does
 * not hold enough *available* quantity, and the refusal names the lot.
 */

export type TransferListFilters = {
  status?: string;
  page?: number;
  pageSize?: number;
};

export type TransferSummary = TransferRow & {
  fromWarehouseName: string | null;
  toWarehouseName: string | null;
  lineCount: number;
};

export async function listTransfers(filters: TransferListFilters = {}): Promise<RegisterPage<TransferSummary>> {
  await requirePermission("inventory.transfer.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));

  let query = supabase
    .from("inventory_transfers")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status);

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Transfers could not be loaded. ${error.message}`);

  const rows = data ?? [];
  const warehouseIds = Array.from(
    new Set(rows.flatMap((row) => [row.from_warehouse_id, row.to_warehouse_id])),
  );
  const { data: warehouses } = warehouseIds.length
    ? await supabase
        .from("warehouses")
        .select("id, name")
        .in("id", warehouseIds)
        .returns<{ id: string; name: string }[]>()
    : { data: [] as { id: string; name: string }[] };
  const warehouseName = (id: string) => warehouses?.find((row) => row.id === id)?.name ?? null;

  const transferIds = rows.map((row) => row.id);
  const { data: lineRows } = transferIds.length
    ? await supabase
        .from("inventory_transfer_items")
        .select("transfer_id")
        .in("transfer_id", transferIds)
        .returns<{ transfer_id: string }[]>()
    : { data: [] as { transfer_id: string }[] };
  const lineCount = new Map<string, number>();
  for (const line of lineRows ?? []) {
    lineCount.set(line.transfer_id, (lineCount.get(line.transfer_id) ?? 0) + 1);
  }

  const total = count ?? 0;
  return {
    rows: rows.map((row) => ({
      ...row,
      fromWarehouseName: warehouseName(row.from_warehouse_id),
      toWarehouseName: warehouseName(row.to_warehouse_id),
      lineCount: lineCount.get(row.id) ?? 0,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type TransferDetail = {
  transfer: TransferRow & { fromWarehouseName: string | null; toWarehouseName: string | null };
  items: (TransferItemRow & {
    productCode: string | null;
    productName: string | null;
    unitCode: string | null;
    lotReference: string | null;
  })[];
  inTransit: InTransitRow[];
  /** What the database will refuse, described before the button is pressed. */
  blockers: string[];
};

export async function getTransferDetail(transferId: string): Promise<TransferDetail> {
  await requirePermission("inventory.transfer.view");
  const supabase = await createSupabaseServerClient();

  const { data: transfer, error } = await supabase
    .from("inventory_transfers")
    .select("*")
    .eq("id", transferId)
    .maybeSingle<TransferRow>();
  if (error) throw new AppError("DATABASE_ERROR", `That transfer could not be loaded. ${error.message}`);
  if (!transfer) throw new AppError("NOT_FOUND", "That transfer does not exist, or you cannot see it.");

  const [{ data: items }, { data: warehouses }, { data: inTransit }] = await Promise.all([
    supabase
      .from("inventory_transfer_items")
      .select(
        "*, product:products(code, name), unit:units_of_measure(code), lot:inventory_lots(lot_reference)",
      )
      .eq("transfer_id", transferId)
      .order("line_number")
      .returns<
        (TransferItemRow & {
          product: { code: string; name: string } | null;
          unit: { code: string } | null;
          lot: { lot_reference: string } | null;
        })[]
      >(),
    supabase
      .from("warehouses")
      .select("id, name")
      .in("id", [transfer.from_warehouse_id, transfer.to_warehouse_id])
      .returns<{ id: string; name: string }[]>(),
    supabase
      .from("inventory_in_transit")
      .select("*")
      .eq("transfer_id", transferId)
      .returns<InTransitRow[]>(),
  ]);

  const warehouseName = (id: string) => warehouses?.find((row) => row.id === id)?.name ?? null;

  const blockers: string[] = [];
  if (transfer.status === "draft") blockers.push("The transfer is a draft: submit it before dispatching.");
  if (transfer.status === "submitted") blockers.push("The transfer is awaiting approval.");
  if (transfer.status === "rejected") blockers.push("The transfer was rejected; amend the lines and resubmit.");
  if (!items || items.length === 0) blockers.push("The transfer has no lines.");

  return {
    transfer: {
      ...transfer,
      fromWarehouseName: warehouseName(transfer.from_warehouse_id),
      toWarehouseName: warehouseName(transfer.to_warehouse_id),
    },
    items: (items ?? []).map((item) => ({
      ...item,
      productCode: item.product?.code ?? null,
      productName: item.product?.name ?? null,
      unitCode: item.unit?.code ?? null,
      lotReference: item.lot?.lot_reference ?? null,
    })),
    inTransit: inTransit ?? [],
    blockers,
  };
}

export type CreateTransferInput = {
  fromWarehouseId: string;
  toWarehouseId: string;
  transferReason?: string | null;
  vehicleReference?: string | null;
  notes?: string | null;
  items: { lotId: string; quantity: string }[];
};

/**
 * Creates a draft transfer with its lines.
 *
 * Lines reference an existing lot: a transfer moves identified stock, and accepting a product without a lot
 * would mean the destination lot could not inherit the source's provenance. The destination lot is created
 * on receipt, inheriting supplier, expiry and grade from the source.
 */
export async function createTransfer(
  input: CreateTransferInput,
  meta: RequestMeta = {},
): Promise<{ id: string; reference: string }> {
  await requirePermission("inventory.transfer.create");

  if (input.items.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Add at least one lot to transfer.");
  }
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new AppError("VALIDATION_ERROR", "A transfer must move stock between two different warehouses.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: transfer, error } = await supabase
    .from("inventory_transfers")
    .insert({
      from_warehouse_id: input.fromWarehouseId,
      to_warehouse_id: input.toWarehouseId,
      transfer_reason: input.transferReason ?? null,
      vehicle_reference: input.vehicleReference ?? null,
      notes: input.notes ?? null,
    } as never)
    .select("id, reference")
    .single<{ id: string; reference: string }>();

  if (error || !transfer) throw inventoryError(error ?? new Error("The transfer was not created."));

  // The lot's own product and unit are read here rather than accepted from the form: a line that stated a
  // product different from its lot would be refused by the ledger trigger later, and the failure would
  // arrive at dispatch time when people are waiting.
  const lotIds = input.items.map((item) => item.lotId);
  const { data: lots, error: lotError } = await supabase
    .from("inventory_lots")
    .select("id, product_id, unit_id, warehouse_id, location_id")
    .in("id", lotIds)
    .returns<{ id: string; product_id: string; unit_id: string; warehouse_id: string; location_id: string | null }[]>();
  if (lotError) throw inventoryError(lotError);

  const byId = new Map((lots ?? []).map((lot) => [lot.id, lot]));
  const rows = input.items.map((item, index) => {
    const lot = byId.get(item.lotId);
    if (!lot) throw new AppError("VALIDATION_ERROR", "One of the selected lots could not be found.");
    if (lot.warehouse_id !== input.fromWarehouseId) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Every lot on a transfer must currently be held in the source warehouse.",
      );
    }
    return {
      transfer_id: transfer.id,
      line_number: index + 1,
      lot_id: lot.id,
      product_id: lot.product_id,
      unit_id: lot.unit_id,
      quantity: numeric(item.quantity),
    };
  });

  const { error: itemError } = await supabase.from("inventory_transfer_items").insert(rows as never);
  if (itemError) {
    // Leave nothing half-created: the header without lines would be an unauditable document.
    await supabase.from("inventory_transfers").delete().eq("id", transfer.id);
    throw inventoryError(itemError);
  }

  await recordInventoryAudit(
    {
      action: "inventory.transfer.created",
      entityType: "inventory_transfer",
      entityId: transfer.id,
      description: `Raised transfer ${transfer.reference} with ${rows.length} line(s)`,
      newValues: { reference: transfer.reference, line_count: rows.length },
    },
    meta,
  );

  return transfer;
}

export async function submitTransfer(transferId: string, meta: RequestMeta = {}): Promise<void> {
  await requirePermission("inventory.transfer.create");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("inventory_transfers")
    .update({ status: "submitted" } as never)
    .eq("id", transferId)
    .eq("status", "draft");
  if (error) throw inventoryError(error);

  await recordInventoryAudit(
    {
      action: "inventory.transfer.created",
      entityType: "inventory_transfer",
      entityId: transferId,
      description: "Submitted a stock transfer for approval",
    },
    meta,
  );
}

/** Approve or reject. The lifecycle trigger checks the permission and the reason requirement. */
export async function decideTransfer(
  input: { transferId: string; decision: "approved" | "rejected"; reason?: string | null },
  meta: RequestMeta = {},
): Promise<void> {
  await requirePermission("inventory.transfer.approve");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("inventory_transfers")
    .update({
      status: input.decision,
      status_reason: input.reason ?? null,
      approved_at: input.decision === "approved" ? new Date().toISOString() : null,
    } as never)
    .eq("id", input.transferId)
    .eq("status", "submitted");
  if (error) throw inventoryError(error);

  await recordInventoryAudit(
    {
      action: "inventory.transfer.approved",
      entityType: "inventory_transfer",
      entityId: input.transferId,
      description: `Transfer ${input.decision}${input.reason ? `: ${input.reason}` : ""}`,
      severity: input.decision === "rejected" ? "warning" : "notice",
    },
    meta,
  );
}

/**
 * Dispatch: posts `transfer_out` for every line.
 *
 * The function refuses when a line's lot does not have enough available quantity, which is the point — you
 * cannot dispatch stock that is restricted or promised elsewhere. The refusal is passed through unchanged
 * so the storekeeper sees which lot fell short and by how much.
 */
export async function dispatchTransfer(
  transferId: string,
  meta: RequestMeta = {},
): Promise<{ dispatchedLines: number }> {
  await requirePermission("inventory.transfer.execute");

  const rows = await callInventoryRpc<{ dispatched_lines: number }[]>("inventory_dispatch_transfer", {
    p_transfer_id: transferId,
  });

  await recordInventoryAudit(
    {
      action: "inventory.transfer.dispatched",
      entityType: "inventory_transfer",
      entityId: transferId,
      description: `Dispatched transfer with ${rows[0]?.dispatched_lines ?? 0} line(s); stock has left the source warehouse`,
      severity: "notice",
    },
    meta,
  );

  return { dispatchedLines: rows[0]?.dispatched_lines ?? 0 };
}

/** Receipt: creates the destination lots and posts `transfer_in`. Short receipts stay visible in transit. */
export async function receiveTransfer(
  transferId: string,
  meta: RequestMeta = {},
): Promise<{ receivedLines: number }> {
  await requirePermission("inventory.transfer.execute");

  const rows = await callInventoryRpc<{ received_lines: number }[]>("inventory_receive_transfer", {
    p_transfer_id: transferId,
  });

  await recordInventoryAudit(
    {
      action: "inventory.transfer.received",
      entityType: "inventory_transfer",
      entityId: transferId,
      description: `Received transfer with ${rows[0]?.received_lines ?? 0} line(s) at the destination warehouse`,
    },
    meta,
  );

  return { receivedLines: rows[0]?.received_lines ?? 0 };
}

/** Everything currently off the books between two warehouses. */
export async function listInTransit(): Promise<InTransitRow[]> {
  await requirePermission("inventory.transfer.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inventory_in_transit")
    .select("*")
    .gt("in_transit_quantity", 0)
    .order("dispatched_at", { ascending: true })
    .returns<InTransitRow[]>();
  if (error) throw new AppError("DATABASE_ERROR", `In-transit stock could not be loaded. ${error.message}`);
  return data ?? [];
}
