import "server-only";

import type { Json } from "@/types/database.types";
import type { RequestMeta } from "@/services/employees/manage-employee";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/services/authorization";
import { getProcurementSettings, peekProcurementReference, recordProcurementAudit } from "./shared";
import type { z } from "zod";
import type { requisitionCreateSchema } from "@/lib/validation/procurement.schemas";

/**
 * Purchase requisitions.
 *
 * A requisition is a request, not a commitment: nothing here creates spend. That is why the
 * department and requesting employee are mandatory and the estimated value is advisory — the
 * purchase order is where price becomes an agreement.
 */

export type RequisitionFilters = {
  search?: string;
  status?: string;
  priority?: string;
  departmentId?: string;
  page?: number;
  pageSize?: number;
};

export type RequisitionListRow = {
  id: string;
  reference: string;
  status: string;
  priority: string;
  requisition_date: string;
  required_delivery_date: string;
  estimated_total: number | null;
  currency_code: string;
  department_name: string | null;
  requesting_employee: string | null;
  line_count: number;
  requested_quantity: number;
  allocated_quantity: number;
  outstanding_quantity: number;
  submitted_at: string | null;
  approved_at: string | null;
};

export async function getRequisitions(filters: RequisitionFilters = {}) {
  await requirePermission("procurement.requisition.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  const from = (page - 1) * pageSize;

  let query = supabase.from("report_requisition_register").select("*", { count: "exact" });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.departmentId) query = query.eq("department_name", filters.departmentId);
  if (filters.search) {
    const term = filters.search.replace(/[%,()*]/g, " ").trim();
    if (term) {
      query = query.or(
        `reference.ilike.%${term}%,department_name.ilike.%${term}%,requesting_employee.ilike.%${term}%`,
      );
    }
  }

  const { data, error, count } = await query
    .order("requisition_date", { ascending: false })
    .range(from, from + pageSize - 1)
    .returns<RequisitionListRow[]>();

  if (error) throw new AppError("DATABASE_ERROR", `The requisition list could not be loaded. ${error.message}`);

  return { rows: data ?? [], total: count ?? 0, page, pageSize };
}

export type RequisitionDetail = Awaited<ReturnType<typeof getRequisitionDetail>>;

export async function getRequisitionDetail(id: string) {
  await requirePermission("procurement.requisition.view");
  const supabase = await createSupabaseServerClient();

  const { data: requisition, error } = await supabase
    .from("purchase_requisitions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new AppError("DATABASE_ERROR", error.message);
  if (!requisition) throw new AppError("NOT_FOUND", "That requisition does not exist, or you cannot see it.");

  const [items, department, employee, supplier, warehouse, history, approvals, allocations, documents, comments] =
    await Promise.all([
      supabase
        .from("purchase_requisition_items")
        .select("*, product:products(id, code, name), unit:units_of_measure(id, code, name)")
        .eq("requisition_id", id)
        .order("line_number")
        .returns<
          {
            id: string;
            line_number: number;
            product_id: string;
            product_description: string;
            quantity: number;
            unit_id: string;
            estimated_unit_price: number | null;
            specification_notes: string | null;
            product: { id: string; code: string; name: string } | null;
            unit: { id: string; code: string; name: string } | null;
          }[]
        >(),
      supabase.from("departments").select("id, name").eq("id", requisition.department_id).maybeSingle(),
      supabase
        .from("employees")
        .select("id, first_name, last_name, job_title")
        .eq("id", requisition.requesting_employee_id)
        .maybeSingle(),
      requisition.preferred_supplier_id
        ? supabase
            .from("suppliers")
            .select("id, reference, legal_name, status")
            .eq("id", requisition.preferred_supplier_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      requisition.suggested_warehouse_id
        ? supabase.from("warehouses").select("id, name").eq("id", requisition.suggested_warehouse_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("procurement_status_history")
        .select("id, from_status, to_status, reason, created_at, actor_employee_id")
        .eq("entity_type", "purchase_requisition")
        .eq("entity_id", id)
        .order("created_at")
        .returns<
          { id: string; from_status: string | null; to_status: string; reason: string | null; created_at: string }[]
        >(),
      supabase
        .from("report_approval_decisions")
        .select("*")
        .eq("entity_type", "purchase_requisition")
        .eq("entity_id", id)
        .order("created_at"),
      supabase
        .from("purchase_requisition_allocations")
        .select(
          "id, requisition_item_id, allocated_quantity, purchase_order_item_id, purchase_order_item:purchase_order_items(id, purchase_order_id, purchase_order:purchase_orders(id, reference, status))",
        )
        .in(
          "requisition_item_id",
          (
            await supabase.from("purchase_requisition_items").select("id").eq("requisition_id", id)
          ).data?.map((row) => row.id) ?? ["00000000-0000-0000-0000-000000000000"],
        ),
      supabase
        .from("procurement_documents")
        .select("id, title, document_type, file_name, mime_type, file_size_bytes, uploaded_at, storage_path")
        .eq("entity_type", "purchase_requisition")
        .eq("entity_id", id),
      supabase
        .from("procurement_comments")
        .select("id, body, visibility, created_at, author_profile_id")
        .eq("entity_type", "purchase_requisition")
        .eq("entity_id", id)
        .order("created_at"),
    ]);

  return {
    requisition,
    items: items.data ?? [],
    department: department.data ?? null,
    employee: employee.data ?? null,
    supplier: supplier.data ?? null,
    warehouse: warehouse.data ?? null,
    history: history.data ?? [],
    approvals: approvals.data ?? [],
    allocations: allocations.data ?? [],
    documents: documents.data ?? [],
    comments: comments.data ?? [],
    fulfilment: await supabase
      .from("purchase_requisition_fulfilment")
      .select("*")
      .eq("requisition_id", id)
      .maybeSingle()
      .then((result) => result.data ?? null),
  };
}

export type RequisitionInput = z.infer<typeof requisitionCreateSchema>;

function itemsJson(input: RequisitionInput): Json {
  return input.items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
    unit_id: item.unitId,
    estimated_unit_price: item.estimatedUnitPrice ?? "",
    specification_notes: item.specificationNotes ?? "",
  })) as unknown as Json;
}

function headerFields(input: RequisitionInput) {
  return {
    p_required_delivery_date: input.requiredDeliveryDate,
    p_purpose: input.purpose,
    p_priority: input.priority,
    p_currency_code: input.currencyCode,
    p_preferred_supplier_id: input.preferredSupplierId || null,
    p_suggested_warehouse_id: input.suggestedWarehouseId || null,
    p_justification: input.justification ?? null,
    p_notes: input.notes ?? null,
  };
}

export async function createRequisition(input: RequisitionInput, meta: RequestMeta = {}) {
  const principal = await requirePermission("procurement.requisition.create");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("procurement_create_requisition", {
    p_department_id: input.departmentId,
    p_requesting_employee_id: input.requestingEmployeeId,
    p_requisition_date: input.requisitionDate,
    ...headerFields(input),
    p_items: itemsJson(input),
  });

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);
  const row = (data ?? [])[0];
  if (!row) throw new AppError("UNEXPECTED_ERROR", "The requisition was not created. Nothing was saved.");

  await recordProcurementAudit(
    {
      action: "procurement.requisition.created",
      entityType: "purchase_requisition",
      entityId: row.id,
      description: `Requisition ${row.reference} raised by ${principal.profile.display_name}.`,
      newValues: { reference: row.reference, lines: input.items.length, purpose: input.purpose },
    },
    meta,
  );

  return row;
}

export async function updateRequisition(id: string, input: RequisitionInput, meta: RequestMeta = {}) {
  await requirePermission("procurement.requisition.update");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("procurement_update_requisition", {
    p_id: id,
    ...headerFields(input),
    p_items: itemsJson(input),
  });

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);
  const row = (data ?? [])[0];
  if (!row) throw new AppError("UNEXPECTED_ERROR", "The requisition was not updated.");

  await recordProcurementAudit(
    {
      action: "procurement.requisition.updated",
      entityType: "purchase_requisition",
      entityId: id,
      description: `Requisition ${row.reference} rewritten while still a working copy.`,
      newValues: { lines: input.items.length, purpose: input.purpose },
    },
    meta,
  );

  return row;
}

/** Submits a requisition for approval. Refuses an empty request, as the database does. */
export async function submitRequisition(id: string, meta: RequestMeta = {}) {
  await requirePermission("procurement.requisition.submit");
  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from("purchase_requisitions")
    .select("reference, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) throw new AppError("NOT_FOUND", "That requisition no longer exists.");

  const { error } = await supabase
    .from("purchase_requisitions")
    .update({ status: "submitted", submitted_at: new Date().toISOString(), submitted_by: null })
    .eq("id", id);

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.requisition.submitted",
      entityType: "purchase_requisition",
      entityId: id,
      description: `Requisition ${existing.reference} submitted for approval.`,
    },
    meta,
  );

  return { id, reference: existing.reference };
}

/** Form options for raising a requisition. Nothing is invented: empty lists render as empty. */
export async function getRequisitionFormOptions() {
  await requirePermission("procurement.requisition.create");
  const supabase = await createSupabaseServerClient();

  const [departments, employees, products, units, warehouses, suppliers, settings] = await Promise.all([
    supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("employees")
      .select("id, first_name, last_name, employee_number, department_id")
      .eq("employment_status", "active")
      .order("first_name"),
    supabase
      .from("products")
      .select("id, code, name, base_unit_id, status")
      .eq("status", "active")
      .order("name"),
    supabase.from("units_of_measure").select("id, code, name").order("code"),
    supabase.from("warehouses").select("id, name").order("name"),
    supabase
      .from("suppliers")
      .select("id, legal_name, status, verification_status")
      .eq("status", "active")
      .order("legal_name"),
    getProcurementSettings(),
  ]);

  return {
    departments: departments.data ?? [],
    employees: employees.data ?? [],
    products: products.data ?? [],
    units: units.data ?? [],
    warehouses: warehouses.data ?? [],
    suppliers: suppliers.data ?? [],
    nextReference: await peekProcurementReference("purchase_requisition"),
    settings,
  };
}

/** True when the caller may approve this requisition amount. Used to label the action honestly. */
export async function requisitionDecisionPreview(amount: number | null, currency: string | null) {
  const { authorityCovers } = await import("./shared");
  return authorityCovers("purchase_requisition", amount, currency);
}
