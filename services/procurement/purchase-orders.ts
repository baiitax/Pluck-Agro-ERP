import "server-only";

import type { Json } from "@/types/database.types";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { z } from "zod";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { amendmentCreateSchema, purchaseOrderCreateSchema } from "@/lib/validation/procurement.schemas";
import { requirePermission } from "@/services/authorization";
import {
  authorityCovers,
  decideProcurement,
  getProcurementSettings,
  notifyApprovers,
  numeric,
  peekProcurementReference,
  recordProcurementAudit,
} from "./shared";

/**
 * Purchase orders, their approval, issue, amendment and closure.
 *
 * Three boundaries are enforced by the database and respected here rather than restated:
 *   * approval and issue are separate acts — an approved order is not a commitment until issued;
 *   * an issued order is immutable, so a change is an amendment with its own approval;
 *   * received quantities are derived from posted receipts, never typed onto the order.
 */

export type PurchaseOrderFilters = {
  search?: string;
  status?: string;
  supplierId?: string;
  overdueOnly?: boolean;
  page?: number;
  pageSize?: number;
};

export type PurchaseOrderSummaryRow = {
  purchase_order_id: string;
  reference: string;
  supplier_id: string;
  supplier_name_snapshot: string;
  status: string;
  currency_code: string;
  total_amount: number;
  order_date: string;
  expected_delivery_date: string | null;
  issued_at: string | null;
  department_id: string | null;
  line_count: number;
  ordered_quantity: number;
  received_quantity: number;
  outstanding_quantity: number;
  rejected_quantity: number;
  quarantined_quantity: number;
  is_overdue: boolean;
};

export async function getPurchaseOrders(filters: PurchaseOrderFilters = {}) {
  await requirePermission("procurement.purchase_order.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  const from = (page - 1) * pageSize;

  let query = supabase.from("purchase_order_summary").select("*", { count: "exact" });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.supplierId) query = query.eq("supplier_id", filters.supplierId);
  if (filters.overdueOnly) query = query.eq("is_overdue", true);
  if (filters.search) {
    const term = filters.search.replace(/[%,()*]/g, " ").trim();
    if (term) query = query.or(`reference.ilike.%${term}%,supplier_name_snapshot.ilike.%${term}%`);
  }

  const { data, error, count } = await query
    .order("order_date", { ascending: false })
    .range(from, from + pageSize - 1)
    .returns<PurchaseOrderSummaryRow[]>();

  if (error) throw new AppError("DATABASE_ERROR", `The purchase order list could not be loaded. ${error.message}`);
  return { rows: data ?? [], total: count ?? 0, page, pageSize };
}

export async function getPurchaseOrderDetail(id: string) {
  await requirePermission("procurement.purchase_order.view");
  const supabase = await createSupabaseServerClient();

  const { data: order } = await supabase.from("purchase_orders").select("*").eq("id", id).maybeSingle();
  if (!order) throw new AppError("NOT_FOUND", "That purchase order does not exist, or you cannot see it.");

  const [items, supplier, department, officer, history, approvals, versions, amendments, receipts, quotations, requisitions, documents, comments] =
    await Promise.all([
      supabase
        .from("purchase_order_items")
        .select("*, product:products(id, code, name), unit:units_of_measure(id, code, name)")
        .eq("purchase_order_id", id)
        .order("line_number")
        .returns<
          {
            id: string;
            line_number: number;
            product_description: string;
            product_code_snapshot: string;
            unit_code_snapshot: string;
            quantity: number;
            unit_price: number;
            line_total: number;
            discount_amount: number;
            additional_charges: number;
            tax_amount: number;
            specification_notes: string | null;
          }[]
        >(),
      supabase
        .from("suppliers")
        .select("id, reference, legal_name, status, verification_status, preferred_currency_code")
        .eq("id", order.supplier_id)
        .maybeSingle(),
      order.department_id
        ? supabase.from("departments").select("id, name").eq("id", order.department_id).maybeSingle()
        : Promise.resolve({ data: null }),
      order.procurement_officer_employee_id
        ? supabase
            .from("employees")
            .select("id, first_name, last_name")
            .eq("id", order.procurement_officer_employee_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("report_procurement_status_history")
        .select("*")
        .eq("entity_type", "purchase_order")
        .eq("entity_id", id)
        .order("created_at"),
      supabase
        .from("report_approval_decisions")
        .select("*")
        .eq("entity_type", "purchase_order")
        .eq("entity_id", id)
        .order("created_at"),
      supabase
        .from("report_purchase_order_versions")
        .select("*")
        .eq("purchase_order_id", id)
        .order("version"),
      supabase
        .from("purchase_order_amendments")
        .select("*, items:purchase_order_amendment_items(*)")
        .eq("purchase_order_id", id)
        .order("requested_at", { ascending: false }),
      supabase
        .from("goods_receipts")
        .select("id, reference, receipt_date, status, posting_reference, posted_at")
        .eq("purchase_order_id", id)
        .order("receipt_date", { ascending: false }),
      order.selected_quotation_id
        ? supabase
            .from("supplier_quotations")
            .select("id, reference, total_amount, currency_code, quotation_date")
            .eq("id", order.selected_quotation_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("purchase_order_requisition_links")
        .select("requisition:purchase_requisitions(id, reference, status)")
        .eq("purchase_order_id", id),
      supabase
        .from("procurement_documents")
        .select("id, title, document_type, file_name, mime_type, file_size_bytes, uploaded_at, storage_path")
        .eq("entity_type", "purchase_order")
        .eq("entity_id", id),
      supabase
        .from("procurement_comments")
        .select("id, body, visibility, created_at")
        .eq("entity_type", "purchase_order")
        .eq("entity_id", id)
        .order("created_at"),
    ]);

  const receiptStatus = await supabase
    .from("purchase_order_receipt_status")
    .select("*")
    .eq("purchase_order_id", id)
    .returns<
      {
        purchase_order_item_id: string;
        ordered_quantity: number;
        received_quantity: number;
        accepted_quantity: number;
        rejected_quantity: number;
        quarantined_quantity: number;
        outstanding_quantity: number;
      }[]
    >();

  const [settings, covers, paymentTerms, deliveryTerms, warehouses] = await Promise.all([
    getProcurementSettings(),
    authorityCovers("purchase_order", order.total_amount, order.currency_code),
    // Amendment targets: an operator changes a term by picking it, never by typing an identifier.
    supabase.from("payment_terms").select("id, name").order("name"),
    supabase.from("delivery_terms").select("id, name").order("name"),
    supabase.from("warehouses").select("id, name").eq("is_active", true).order("name"),
  ]);

  return {
    order,
    items: items.data ?? [],
    supplier: supplier.data ?? null,
    department: department.data ?? null,
    officer: officer.data ?? null,
    history: history.data ?? [],
    approvals: approvals.data ?? [],
    versions: versions.data ?? [],
    amendments: (amendments.data ?? []) as unknown as {
      id: string;
      reference: string;
      status: string;
      reason: string;
      base_version: number;
      resulting_version: number | null;
      previous_total: number | null;
      new_total: number | null;
      requested_at: string;
      applied_at: string | null;
      items: unknown[];
    }[],
    receipts: receipts.data ?? [],
    quotation: quotations.data ?? null,
    requisitions: (requisitions.data ?? []) as unknown as { requisition: { id: string; reference: string; status: string } | null }[],
    documents: documents.data ?? [],
    comments: comments.data ?? [],
    receiptStatus: receiptStatus.data ?? [],
    settings,
    authorityCovers: covers,
    amendmentOptions: {
      paymentTerms: paymentTerms.data ?? [],
      deliveryTerms: deliveryTerms.data ?? [],
      warehouses: warehouses.data ?? [],
    },
  };
}

export type PurchaseOrderInput = z.infer<typeof purchaseOrderCreateSchema>;

function itemsJson(input: PurchaseOrderInput): Json {
  return input.items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
    unit_id: item.unitId,
    unit_price: item.unitPrice,
    discount_amount: item.discountAmount ?? "",
    additional_charges: item.additionalCharges ?? "",
    tax_category_id: item.taxCategoryId ?? "",
    tax_amount: item.taxAmount ?? "",
    specification_notes: item.specificationNotes ?? "",
    requisition_item_id: item.requisitionItemId ?? "",
  })) as unknown as Json;
}

export async function createPurchaseOrder(input: PurchaseOrderInput, meta: RequestMeta = {}) {
  await requirePermission("procurement.purchase_order.create");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("procurement_create_purchase_order", {
    p_supplier_id: input.supplierId,
    p_order_date: input.orderDate,
    p_currency_code: input.currencyCode,
    p_items: itemsJson(input),
    p_selected_quotation_id: input.selectedQuotationId || null,
    p_selection_id: input.selectionId || null,
    p_expected_delivery_date: input.expectedDeliveryDate || null,
    p_exchange_rate: input.exchangeRate ? numeric(input.exchangeRate) : null,
    p_exchange_rate_type: null,
    p_base_currency_code: null,
    p_payment_terms_id: input.paymentTermsId || null,
    p_delivery_terms_id: input.deliveryTermsId || null,
    p_delivery_warehouse_id: input.deliveryWarehouseId || null,
    p_delivery_location_id: input.deliveryLocationId || null,
    p_delivery_address: input.deliveryAddress ?? null,
    p_procurement_officer_employee_id: input.procurementOfficerEmployeeId || null,
    p_department_id: input.departmentId || null,
    p_requisition_ids: input.requisitionIds && input.requisitionIds.length > 0 ? input.requisitionIds : null,
    p_internal_remarks: input.internalRemarks ?? null,
    p_supplier_instructions: input.supplierInstructions ?? null,
  });

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);
  const row = (data ?? [])[0];
  if (!row) throw new AppError("UNEXPECTED_ERROR", "The purchase order was not created.");

  await recordProcurementAudit(
    {
      action: "procurement.purchase_order.created",
      entityType: "purchase_order",
      entityId: row.id,
      description: `Draft purchase order ${row.reference} created for supplier ${input.supplierId}.`,
      newValues: { lines: input.items.length, currency: input.currencyCode, supplier_id: input.supplierId },
    },
    meta,
  );

  return row;
}

export async function submitPurchaseOrder(id: string, meta: RequestMeta = {}) {
  await requirePermission("procurement.purchase_order.submit");
  const supabase = await createSupabaseServerClient();

  const { data: order } = await supabase
    .from("purchase_orders")
    .select("reference, status, total_amount, currency_code")
    .eq("id", id)
    .maybeSingle();
  if (!order) throw new AppError("NOT_FOUND", "That purchase order no longer exists.");

  const { error } = await supabase
    .from("purchase_orders")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.purchase_order.submitted",
      entityType: "purchase_order",
      entityId: id,
      description: `Purchase order ${order.reference} submitted for approval.`,
    },
    meta,
  );

  await notifyApprovers({
    permission: "procurement.purchase_order.approve",
    title: `Purchase order ${order.reference} needs approval`,
    body: `${order.currency_code} ${Number(order.total_amount).toLocaleString()} is awaiting a decision.`,
    entityType: "purchase_order",
    entityId: id,
    href: `/procurement/purchase-orders/${id}`,
  });

  return { id, reference: order.reference };
}

export type PurchaseOrderDecision = "approve" | "reject" | "issue" | "cancel" | "close";

export async function decidePurchaseOrder(params: {
  id: string;
  decision: PurchaseOrderDecision;
  reference: string;
  comment?: string | null;
  meta?: RequestMeta;
}) {
  if (params.decision === "close") {
    // Closing is a lifecycle move with its own permission, not an approval decision.
    await requirePermission("procurement.purchase_order.close");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("purchase_orders")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", params.id);
    if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

    await recordProcurementAudit(
      {
        action: "procurement.purchase_order.closed",
        entityType: "purchase_order",
        entityId: params.id,
        description: `Purchase order ${params.reference} closed with quantities outstanding.`,
        metadata: { reason: params.comment ?? null },
      },
      params.meta,
    );
    return null;
  }

  return decideProcurement({
    entityType: "purchase_order",
    entityId: params.id,
    decision: params.decision,
    comment: params.comment ?? null,
    reference: params.reference,
    auditAction:
      params.decision === "issue"
        ? "procurement.purchase_order.issued"
        : params.decision === "approve"
          ? "procurement.purchase_order.issued"
          : "procurement.purchase_order.updated",
    revalidate: ["/procurement", "/procurement/purchase-orders", `/procurement/purchase-orders/${params.id}`],
    meta: params.meta,
  });
}

// ---------------------------------------------------------------- amendments

export type AmendmentInput = z.infer<typeof amendmentCreateSchema>;

export async function raiseAmendment(
  orderId: string,
  orderReference: string,
  input: AmendmentInput,
  meta: RequestMeta = {},
) {
  await requirePermission("procurement.purchase_order.amend");
  const supabase = await createSupabaseServerClient();

  const items = input.items.map((item) => ({
    purchase_order_item_id: item.purchaseOrderItemId ?? "",
    change_type: item.changeType,
    field_name: item.fieldName ?? "",
    previous_value: item.previousValue ?? "",
    new_value: item.newValue,
    product_id: item.productId ?? "",
    quantity: item.quantity ?? "",
    unit_id: item.unitId ?? "",
    unit_price: item.unitPrice ?? "",
  })) as unknown as Json;

  const { data, error } = await supabase.rpc("procurement_create_amendment", {
    p_purchase_order_id: orderId,
    p_reason: input.reason,
    p_items: items,
  });

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);
  const row = (data ?? [])[0];
  if (!row) throw new AppError("UNEXPECTED_ERROR", "The amendment was not created.");

  await recordProcurementAudit(
    {
      action: "procurement.purchase_order.amended",
      entityType: "purchase_order_amendment",
      entityId: row.id,
      description: `Amendment ${row.reference} raised against ${orderReference} (version ${row.base_version}).`,
      metadata: { reason: input.reason, changes: input.items.length },
    },
    meta,
  );

  return row;
}

export async function decideAmendment(params: {
  id: string;
  decision: "approve" | "reject" | "cancel";
  reference: string;
  comment?: string | null;
  meta?: RequestMeta;
}) {
  return decideProcurement({
    entityType: "purchase_order_amendment",
    entityId: params.id,
    decision: params.decision,
    comment: params.comment ?? null,
    reference: params.reference,
    auditAction: "procurement.purchase_order.amended",
    revalidate: ["/procurement/purchase-orders"],
    meta: params.meta,
  });
}

/**
 * Applies an approved amendment to the order.
 *
 * `confirmReceivedImpact` is only meaningful when the amendment would reduce a quantity below what
 * has already been received; the database refuses that without the flag and without approval
 * authority, and this function passes the operator's explicit confirmation through.
 */
export async function applyAmendment(params: {
  amendmentId: string;
  reference: string;
  confirmReceivedImpact: boolean;
  meta?: RequestMeta;
}) {
  await requirePermission("procurement.purchase_order.amend");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("apply_purchase_order_amendment", {
    p_amendment_id: params.amendmentId,
    p_confirm_received_impact: params.confirmReceivedImpact,
  });
  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  const row = (data ?? [])[0];
  if (!row) throw new AppError("UNEXPECTED_ERROR", "The amendment was not applied.");

  await recordProcurementAudit(
    {
      action: "procurement.purchase_order.amended",
      entityType: "purchase_order_amendment",
      entityId: params.amendmentId,
      description: `Amendment ${params.reference} applied: order now version ${row.version}, total ${row.total_amount}.`,
      severity: params.confirmReceivedImpact ? "warning" : "notice",
      oldValues: { previous_total: row.previous_total },
      newValues: { total_amount: row.total_amount, version: row.version },
    },
    params.meta,
  );

  return row;
}

export type PurchaseOrderSelectionSource = {
  id: string;
  justification: string;
  selected_supplier_id: string;
  quotation: {
    id: string;
    reference: string;
    currency_code: string;
    payment_terms_id: string | null;
    delivery_terms_id: string | null;
    requisition_id: string | null;
    items: {
      product_id: string;
      quantity: number;
      unit_id: string;
      unit_price: number;
      product_description: string;
    }[];
  } | null;
};

/** Form options for raising an order, optionally prefilled from a selection. */
export async function getPurchaseOrderFormOptions(selectionId?: string) {
  await requirePermission("procurement.purchase_order.create");
  const supabase = await createSupabaseServerClient();

  const [suppliers, products, units, warehouses, locations, paymentTerms, deliveryTerms, departments, employees, taxCategories] =
    await Promise.all([
      supabase
        .from("suppliers")
        .select("id, reference, legal_name, status, verification_status, preferred_currency_code")
        .eq("status", "active")
        .order("legal_name"),
      supabase.from("products").select("id, code, name, base_unit_id, status").eq("status", "active").order("name"),
      supabase.from("units_of_measure").select("id, code, name").order("code"),
      supabase.from("warehouses").select("id, name").order("name"),
      supabase.from("warehouse_locations").select("id, name, warehouse_id").order("name"),
      supabase.from("payment_terms").select("id, name").order("name"),
      supabase.from("delivery_terms").select("id, name").order("name"),
      supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("employees")
        .select("id, first_name, last_name")
        .eq("employment_status", "active")
        .order("first_name"),
      supabase.from("tax_categories").select("id, name, code").order("name"),
    ]);

  let selection: PurchaseOrderSelectionSource | null = null;

  if (selectionId) {
    const { data } = await supabase
      .from("supplier_quotation_selections")
      .select(
        "id, justification, selected_supplier_id, quotation:supplier_quotations(id, reference, currency_code, payment_terms_id, delivery_terms_id, requisition_id, items:supplier_quotation_items(product_id, quantity, unit_id, unit_price, product_description))",
      )
      .eq("id", selectionId)
      .maybeSingle();
    selection = (data ?? null) as unknown as PurchaseOrderSelectionSource | null;
  }

  return {
    suppliers: suppliers.data ?? [],
    products: products.data ?? [],
    units: units.data ?? [],
    warehouses: warehouses.data ?? [],
    locations: locations.data ?? [],
    paymentTerms: paymentTerms.data ?? [],
    deliveryTerms: deliveryTerms.data ?? [],
    departments: departments.data ?? [],
    employees: employees.data ?? [],
    taxCategories: taxCategories.data ?? [],
    selection,
    nextReference: await peekProcurementReference("purchase_order"),
    settings: await getProcurementSettings(),
  };
}

/** Selections that have not yet produced an order — the normal starting point for a new order. */
export async function getConvertibleSelections() {
  await requirePermission("procurement.purchase_order.create");
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("supplier_quotation_selections")
    .select(
      "id, decided_at, justification, selected_supplier_id, requisition_id, quotation:supplier_quotations(id, reference, total_amount, currency_code), supplier:suppliers(legal_name)",
    )
    .order("decided_at", { ascending: false })
    .limit(50);

  const withOrders = await supabase.from("purchase_orders").select("selection_id").not("selection_id", "is", null);
  const used = new Set((withOrders.data ?? []).map((row) => row.selection_id));

  return ((data ?? []) as unknown as { id: string }[]).filter((row) => !used.has(row.id));
}
