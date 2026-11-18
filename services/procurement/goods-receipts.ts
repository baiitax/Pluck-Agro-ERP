import "server-only";

import type { Json } from "@/types/database.types";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { z } from "zod";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { goodsReceiptCreateSchema } from "@/lib/validation/procurement.schemas";
import { requirePermission } from "@/services/authorization";
import {
  decideProcurement,
  getProcurementSettings,
  numeric,
  peekProcurementReference,
  recordProcurementAudit,
} from "./shared";

/**
 * Goods receipts.
 *
 * The distinction the whole module is built on: **received is not accepted**. Every line keeps the
 * received quantity split into accepted, rejected and quarantined parts, and only the accepted part
 * can ever become inventory — and even that only when Phase 5 records the handoff event this module
 * emits. Nothing here writes a stock balance, because procurement is not the stock ledger.
 *
 * Posting is a single, one-time act performed by the database function `post_goods_receipt`, which
 * locks the order lines, re-checks outstanding quantity and writes both the immutable posting record
 * and the outbox event in one transaction. This service calls it and nothing else.
 */

export type GoodsReceiptFilters = {
  search?: string;
  status?: string;
  purchaseOrderId?: string;
  page?: number;
  pageSize?: number;
};

export async function getGoodsReceipts(filters: GoodsReceiptFilters = {}) {
  await requirePermission("procurement.goods_receipt.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  const from = (page - 1) * pageSize;

  let query = supabase.from("report_goods_receipt_register").select("*", { count: "exact" });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.purchaseOrderId) query = query.eq("purchase_order_reference", filters.purchaseOrderId);
  if (filters.search) {
    const term = filters.search.replace(/[%,()*]/g, " ").trim();
    if (term) {
      query = query.or(
        `reference.ilike.%${term}%,supplier_delivery_note_number.ilike.%${term}%,purchase_order_reference.ilike.%${term}%,supplier_name.ilike.%${term}%`,
      );
    }
  }

  const { data, error, count } = await query
    .order("receipt_date", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw new AppError("DATABASE_ERROR", `The goods receipt register could not be loaded. ${error.message}`);
  return { rows: (data ?? []) as unknown[], total: count ?? 0, page, pageSize };
}

export async function getGoodsReceiptDetail(id: string) {
  await requirePermission("procurement.goods_receipt.view");
  const supabase = await createSupabaseServerClient();

  const { data: receipt } = await supabase.from("goods_receipts").select("*").eq("id", id).maybeSingle();
  if (!receipt) throw new AppError("NOT_FOUND", "That goods receipt does not exist, or you cannot see it.");

  const [order, supplier, warehouse, items, inspections, postings, history, approvals, documents, outbox] =
    await Promise.all([
      supabase
        .from("purchase_orders")
        .select("id, reference, status, currency_code, total_amount, supplier_id, supplier_name_snapshot, expected_delivery_date")
        .eq("id", receipt.purchase_order_id)
        .maybeSingle(),
      supabase.from("suppliers").select("id, legal_name, reference").eq("id", receipt.supplier_id).maybeSingle(),
      supabase.from("warehouses").select("id, name").eq("id", receipt.warehouse_id).maybeSingle(),
      supabase
        .from("goods_receipt_items")
        .select("*, purchase_order_item:purchase_order_items(id, line_number, product_code_snapshot, unit_code_snapshot, quantity, unit_price)")
        .eq("goods_receipt_id", id)
        .order("line_number"),
      supabase.from("report_goods_receipt_inspections").select("*").eq("goods_receipt_id", id).order("inspected_at"),
      supabase.from("goods_receipt_postings").select("*").eq("goods_receipt_id", id).maybeSingle(),
      supabase
        .from("report_procurement_status_history")
        .select("*")
        .eq("entity_type", "goods_receipt")
        .eq("entity_id", id)
        .order("created_at"),
      supabase
        .from("report_approval_decisions")
        .select("*")
        .eq("entity_type", "goods_receipt")
        .eq("entity_id", id)
        .order("created_at"),
      supabase
        .from("procurement_documents")
        .select("id, title, document_type, file_name, mime_type, file_size_bytes, uploaded_at, storage_path")
        .eq("entity_type", "goods_receipt")
        .eq("entity_id", id),
      supabase
        .from("procurement_integration_outbox")
        .select("id, event_type, status, idempotency_key, attempts, last_error, created_at, dispatched_at")
        .eq("entity_type", "goods_receipt")
        .eq("entity_id", id),
    ]);

  return {
    receipt,
    order: order.data ?? null,
    supplier: supplier.data ?? null,
    warehouse: warehouse.data ?? null,
    items: (items.data ?? []) as unknown as {
      id: string;
      line_number: number;
      product_description: string;
      unit_code_snapshot: string;
      ordered_quantity: number;
      previously_received_quantity: number;
      received_quantity: number;
      accepted_quantity: number;
      rejected_quantity: number;
      quarantined_quantity: number;
      rejection_reason: string | null;
      observations: string | null;
      purchase_order_item: { line_number: number; unit_price: number } | null;
    }[],
    inspections: inspections.data ?? [],
    posting: postings.data ?? null,
    history: history.data ?? [],
    approvals: approvals.data ?? [],
    documents: documents.data ?? [],
    outbox: outbox.data ?? [],
    settings: await getProcurementSettings(),
  };
}

export type GoodsReceiptInput = z.infer<typeof goodsReceiptCreateSchema>;

export async function createGoodsReceipt(input: GoodsReceiptInput, meta: RequestMeta = {}) {
  await requirePermission("procurement.goods_receipt.create");
  const supabase = await createSupabaseServerClient();

  const items = input.items.map((item) => ({
    purchase_order_item_id: item.purchaseOrderItemId,
    received_quantity: item.receivedQuantity,
    accepted_quantity: item.acceptedQuantity ?? "0",
    rejected_quantity: item.rejectedQuantity ?? "0",
    quarantined_quantity: item.quarantinedQuantity ?? "0",
    rejection_reason: item.rejectionReason ?? "",
    packaging_details: item.packagingDetails ?? "",
    observations: item.observations ?? "",
  })) as unknown as Json;

  const { data, error } = await supabase.rpc("procurement_create_goods_receipt", {
    p_purchase_order_id: input.purchaseOrderId,
    p_warehouse_id: input.warehouseId,
    p_receipt_date: input.receiptDate,
    p_items: items,
    p_supplier_delivery_note_number: input.supplierDeliveryNoteNumber ?? null,
    p_delivery_reference: input.deliveryReference ?? null,
    p_location_id: input.locationId || null,
    p_receiving_employee_id: input.receivingEmployeeId || null,
    p_vehicle_reference: input.vehicleReference ?? null,
    p_transporter_name: input.transporterName ?? null,
    p_observations: input.observations ?? null,
  });

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);
  const row = (data ?? [])[0];
  if (!row) throw new AppError("UNEXPECTED_ERROR", "The goods receipt was not recorded.");

  await recordProcurementAudit(
    {
      action: "procurement.goods_receipt.created",
      entityType: "goods_receipt",
      entityId: row.id,
      description: `Goods receipt ${row.reference} recorded against purchase order ${input.purchaseOrderId}.`,
      newValues: { lines: input.items.length, delivery_note: input.supplierDeliveryNoteNumber ?? null },
    },
    meta,
  );

  return row;
}

export async function submitGoodsReceipt(id: string, meta: RequestMeta = {}) {
  await requirePermission("procurement.goods_receipt.submit");
  const supabase = await createSupabaseServerClient();

  const { data: receipt } = await supabase
    .from("goods_receipts")
    .select("reference")
    .eq("id", id)
    .maybeSingle();
  if (!receipt) throw new AppError("NOT_FOUND", "That goods receipt no longer exists.");

  const { error } = await supabase
    .from("goods_receipts")
    .update({ status: "submitted" })
    .eq("id", id);
  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.goods_receipt.submitted",
      entityType: "goods_receipt",
      entityId: id,
      description: `Goods receipt ${receipt.reference} submitted for review.`,
    },
    meta,
  );

  return { id, reference: receipt.reference };
}

export async function decideGoodsReceipt(params: {
  id: string;
  decision: "approve" | "reject" | "return" | "cancel";
  reference: string;
  comment?: string | null;
  meta?: RequestMeta;
}) {
  return decideProcurement({
    entityType: "goods_receipt",
    entityId: params.id,
    decision: params.decision,
    comment: params.comment ?? null,
    reference: params.reference,
    auditAction: "procurement.goods_receipt.updated" as never,
    revalidate: ["/procurement", "/procurement/goods-receipts", `/procurement/goods-receipts/${params.id}`],
    meta: params.meta,
  });
}

/**
 * Posts a receipt.
 *
 * The idempotency key is generated once per posting form submission and reused on retry, so a
 * double-click or a network retry cannot post the same delivery twice. If the receipt was already
 * posted, the database returns the original posting reference instead of writing a second one.
 */
export async function postGoodsReceipt(params: {
  id: string;
  reference: string;
  idempotencyKey: string;
  allowExcess: boolean;
  meta?: RequestMeta;
}) {
  await requirePermission("procurement.goods_receipt.post");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("post_goods_receipt", {
    p_receipt_id: params.id,
    p_idempotency_key: params.idempotencyKey,
    p_allow_excess: params.allowExcess,
  });

  if (error) {
    throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);
  }

  const row = (data ?? [])[0];
  if (!row) throw new AppError("UNEXPECTED_ERROR", "The receipt was not posted.");

  await recordProcurementAudit(
    {
      action: "procurement.goods_receipt.posted",
      entityType: "goods_receipt",
      entityId: params.id,
      description: row.already_posted
        ? `Goods receipt ${params.reference} was already posted as ${row.posting_reference}; nothing was posted again.`
        : `Goods receipt ${params.reference} posted as ${row.posting_reference}. Accepted stock is awaiting the inventory handoff.`,
      severity: row.already_posted ? "notice" : "warning",
      metadata: {
        posting_reference: row.posting_reference,
        already_posted: row.already_posted,
        outbox_event_id: row.outbox_event_id,
        allow_excess: params.allowExcess,
      },
    },
    params.meta,
  );

  return row;
}

export async function recordInspection(
  input: {
    goodsReceiptId: string;
    goodsReceiptItemId?: string;
    inspectionType: "quantity_and_condition" | "quality" | "documentation" | "other";
    result: "pending" | "passed" | "failed" | "partial";
    quantityInspected?: string;
    findings: string;
  },
  reference: string,
  meta: RequestMeta = {},
) {
  await requirePermission("procurement.goods_receipt.review");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("goods_receipt_inspections")
    .insert({
      goods_receipt_id: input.goodsReceiptId,
      goods_receipt_item_id: input.goodsReceiptItemId || null,
      inspection_type: input.inspectionType,
      result: input.result,
      quantity_inspected: numeric(input.quantityInspected),
      findings: input.findings,
      inspected_by: null,
    })
    .select("id")
    .single();

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.goods_receipt.inspected",
      entityType: "goods_receipt",
      entityId: input.goodsReceiptId,
      description: `Inspection recorded on ${reference}: ${input.result}.`,
      severity: input.result === "failed" ? "warning" : "notice",
      metadata: { inspection_type: input.inspectionType, findings: input.findings },
    },
    meta,
  );

  return data;
}

/**
 * Open orders with quantity outstanding, used to start a receipt.
 *
 * The outstanding figure comes from the `purchase_order_receipt_status` view, which derives it from
 * posted and approved receipts — it is never typed in.
 */
export async function getReceivableOrders() {
  await requirePermission("procurement.goods_receipt.create");
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("purchase_order_summary")
    .select("*")
    .in("status", ["issued", "partially_received"])
    .gt("outstanding_quantity", 0)
    .order("expected_delivery_date", { ascending: true });

  return (data ?? []) as unknown as {
    purchase_order_id: string;
    reference: string;
    supplier_id: string;
    supplier_name_snapshot: string;
    status: string;
    expected_delivery_date: string | null;
    outstanding_quantity: number;
    currency_code: string;
    is_overdue: boolean;
  }[];
}

/** The order's lines with the quantity still outstanding, for the receipt form. */
export async function getReceivableOrder(orderId: string) {
  await requirePermission("procurement.goods_receipt.create");
  const supabase = await createSupabaseServerClient();

  const { data: order } = await supabase
    .from("purchase_orders")
    .select("id, reference, status, supplier_id, supplier_name_snapshot, currency_code, delivery_warehouse_id, delivery_location_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) throw new AppError("NOT_FOUND", "That purchase order does not exist, or you cannot see it.");

  const [items, warehouses, locations, employees, settings] = await Promise.all([
    supabase
      .from("purchase_order_items")
      .select("id, line_number, product_id, product_description, product_code_snapshot, unit_id, unit_code_snapshot, quantity, unit_price")
      .eq("purchase_order_id", orderId)
      .order("line_number"),
    supabase.from("warehouses").select("id, name").order("name"),
    supabase.from("warehouse_locations").select("id, name, warehouse_id").order("name"),
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("employment_status", "active")
      .order("first_name"),
    getProcurementSettings(),
  ]);

  const status = await supabase
    .from("purchase_order_receipt_status")
    .select("*")
    .eq("purchase_order_id", orderId)
    .returns<{ purchase_order_item_id: string; outstanding_quantity: number; received_quantity: number }[]>();

  const outstanding = new Map((status.data ?? []).map((row) => [row.purchase_order_item_id, row]));
  const itemsWithBalance = (items.data ?? []).map((item) => {
    const position = outstanding.get(item.id);
    return {
      ...item,
      received_quantity: position?.received_quantity ?? 0,
      outstanding_quantity: position?.outstanding_quantity ?? item.quantity,
    };
  });

  if (!["issued", "partially_received"].includes(order.status)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Purchase order ${order.reference} is ${order.status}. Only an issued or partly received order can be received against.`,
    );
  }

  return {
    order,
    items: itemsWithBalance,
    warehouses: warehouses.data ?? [],
    locations: locations.data ?? [],
    employees: employees.data ?? [],
    settings,
    nextReference: await peekProcurementReference("goods_receipt"),
  };
}
