import "server-only";

import type { Json } from "@/types/database.types";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { z } from "zod";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { comparisonCreateSchema, quotationCreateSchema, selectionSchema } from "@/lib/validation/procurement.schemas";
import { requirePermission } from "@/services/authorization";
import { getProcurementSettings, numeric, peekProcurementReference, recordProcurementAudit } from "./shared";

/**
 * Supplier quotations, comparison and selection.
 *
 * The one rule this module is built around: **the lowest price does not win by itself**. A comparison
 * records every offer with the totals and lead times it was judged on; a selection is a separate,
 * attributable decision that names the quotation chosen and states why. When none of the compared
 * offers is the cheapest, the justification becomes mandatory — enforced by the database, not here.
 */

export type QuotationFilters = {
  search?: string;
  status?: string;
  supplierId?: string;
  page?: number;
  pageSize?: number;
};

export async function getQuotations(filters: QuotationFilters = {}) {
  await requirePermission("procurement.quotation.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("supplier_quotations")
    .select(
      "*, supplier:suppliers(id, reference, legal_name, status, verification_status), requisition:purchase_requisitions(id, reference, status)",
      { count: "exact" },
    );

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.supplierId) query = query.eq("supplier_id", filters.supplierId);
  if (filters.search) {
    const term = filters.search.replace(/[%,()*]/g, " ").trim();
    if (term) query = query.or(`reference.ilike.%${term}%,supplier_quotation_reference.ilike.%${term}%`);
  }

  const { data, error, count } = await query
    .order("quotation_date", { ascending: false })
    .range(from, from + pageSize - 1)
    .returns<Record<string, unknown>[]>();

  if (error) throw new AppError("DATABASE_ERROR", `The quotation list could not be loaded. ${error.message}`);

  const rows = (data ?? []) as unknown as {
    id: string;
    supplier_id: string;
    line_count?: number;
  }[];

  // Line counts in one query; a quotation with no lines is a data problem worth seeing.
  const counts = new Map<string, number>();
  if (rows.length > 0) {
    const { data: items } = await supabase
      .from("supplier_quotation_items")
      .select("quotation_id")
      .in("quotation_id", rows.map((row) => row.id))
      .returns<{ quotation_id: string }[]>();
    for (const item of items ?? []) counts.set(item.quotation_id, (counts.get(item.quotation_id) ?? 0) + 1);
  }

  return {
    rows: rows.map((row) => ({ ...row, line_count: counts.get(row.id) ?? 0 })),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function getQuotationDetail(id: string) {
  await requirePermission("procurement.quotation.view");
  const supabase = await createSupabaseServerClient();

  const { data: quotation } = await supabase.from("supplier_quotations").select("*").eq("id", id).maybeSingle();
  if (!quotation) throw new AppError("NOT_FOUND", "That quotation does not exist, or you cannot see it.");

  const [items, supplier, requisition, comparisons] = await Promise.all([
    supabase
      .from("supplier_quotation_items")
      .select("*, product:products(id, code, name), unit:units_of_measure(id, code, name)")
      .eq("quotation_id", id)
      .order("line_number")
      .returns<{ line_number: number; product_description: string; quantity: number; unit_price: number }[]>(),
    supabase
      .from("suppliers")
      .select("id, reference, legal_name, status, verification_status, preferred_currency_code")
      .eq("id", quotation.supplier_id)
      .maybeSingle(),
    quotation.requisition_id
      ? supabase
          .from("purchase_requisitions")
          .select("id, reference, status, currency_code")
          .eq("id", quotation.requisition_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("supplier_quotation_comparison_quotes")
      .select("comparison_id, comparison:supplier_quotation_comparisons(id, title, comparison_date)")
      .eq("quotation_id", id)
      .returns<{ comparison_id: string }[]>(),
  ]);

  return {
    quotation,
    items: items.data ?? [],
    supplier: supplier.data ?? null,
    requisition: requisition.data ?? null,
    comparisonIds: (comparisons.data ?? []).map((row) => row.comparison_id),
  };
}

export type QuotationInput = z.infer<typeof quotationCreateSchema>;

/** Records a quotation as received from the supplier. */
export async function createQuotation(input: QuotationInput, meta: RequestMeta = {}) {
  await requirePermission("procurement.quotation.create");
  const supabase = await createSupabaseServerClient();

  const items = input.items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
    unit_id: item.unitId,
    unit_price: item.unitPrice,
    discount_amount: item.discountAmount ?? "",
    notes: item.notes ?? "",
  })) as unknown as Json;

  const { data, error } = await supabase.rpc("procurement_create_quotation", {
    p_supplier_id: input.supplierId,
    p_quotation_date: input.quotationDate,
    p_currency_code: input.currencyCode,
    p_items: items,
    p_requisition_id: input.requisitionId || null,
    p_quotation_request_id: input.quotationRequestId || null,
    p_supplier_quotation_reference: input.supplierQuotationReference ?? null,
    p_valid_until: input.validUntil || null,
    p_payment_terms_id: input.paymentTermsId || null,
    p_delivery_terms_id: input.deliveryTermsId || null,
    p_delivery_lead_time_days: input.deliveryLeadTimeDays ? Number(input.deliveryLeadTimeDays) : null,
    p_proposed_delivery_date: input.proposedDeliveryDate || null,
    p_discount_amount: numeric(input.discountAmount ?? "0"),
    p_delivery_charges: numeric(input.deliveryCharges ?? "0"),
    p_other_charges: numeric(input.otherCharges ?? "0"),
    p_charge_notes: input.chargeNotes ?? null,
    p_remarks: input.remarks ?? null,
  });

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);
  const row = (data ?? [])[0];
  if (!row) throw new AppError("UNEXPECTED_ERROR", "The quotation was not recorded.");

  await recordProcurementAudit(
    {
      action: "procurement.quotation.recorded",
      entityType: "supplier_quotation",
      entityId: row.id,
      description: `Quotation ${row.reference} recorded for supplier ${input.supplierId}.`,
      newValues: { lines: input.items.length, currency: input.currencyCode },
    },
    meta,
  );

  return row;
}

export async function updateQuotation(id: string, input: QuotationInput, meta: RequestMeta = {}) {
  await requirePermission("procurement.quotation.update");
  const supabase = await createSupabaseServerClient();

  const items = input.items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
    unit_id: item.unitId,
    unit_price: item.unitPrice,
    discount_amount: item.discountAmount ?? "",
    notes: item.notes ?? "",
  })) as unknown as Json;

  const { data, error } = await supabase.rpc("procurement_update_quotation", {
    p_id: id,
    p_valid_until: input.validUntil || null,
    p_items: items,
    p_delivery_lead_time_days: input.deliveryLeadTimeDays ? Number(input.deliveryLeadTimeDays) : null,
    p_proposed_delivery_date: input.proposedDeliveryDate || null,
    p_discount_amount: numeric(input.discountAmount ?? "0"),
    p_delivery_charges: numeric(input.deliveryCharges ?? "0"),
    p_other_charges: numeric(input.otherCharges ?? "0"),
    p_charge_notes: input.chargeNotes ?? null,
    p_remarks: input.remarks ?? null,
  });

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);
  const row = (data ?? [])[0];
  if (!row) throw new AppError("UNEXPECTED_ERROR", "The quotation was not updated.");

  await recordProcurementAudit(
    {
      action: "procurement.quotation.updated",
      entityType: "supplier_quotation",
      entityId: id,
      description: `Quotation ${row.reference} corrected while still open.`,
    },
    meta,
  );

  return row;
}

/** Creates a quotation request (an invitation to quote) for a requisition. */
export async function createQuotationRequest(input: {
  requisitionId: string;
  responseDueDate: string;
  scopeDescription: string;
  supplierIds: string[];
  notes?: string;
}, meta: RequestMeta = {}) {
  await requirePermission("procurement.quotation.create");
  if (input.supplierIds.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Select at least one supplier to invite.");
  }
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("supplier_quotation_requests")
    .insert({
      requisition_id: input.requisitionId,
      request_date: new Date().toISOString().slice(0, 10),
      response_due_date: input.responseDueDate,
      scope_description: input.scopeDescription,
      notes: input.notes ?? null,
      requested_by: null,
    })
    .select("id, reference")
    .single();

  if (error) throw new AppError("VALIDATION_ERROR", error.message);

  const { error: linkError } = await supabase.from("supplier_quotation_requests_suppliers").insert(
    input.supplierIds.map((supplierId) => ({ request_id: data.id, supplier_id: supplierId })),
  );
  if (linkError) throw new AppError("VALIDATION_ERROR", linkError.message);

  await recordProcurementAudit(
    {
      action: "procurement.quotation.requested",
      entityType: "supplier_quotation_request",
      entityId: data.id,
      description: `Quotation request ${data.reference} sent to ${input.supplierIds.length} supplier(s).`,
    },
    meta,
  );

  return data;
}

// ---------------------------------------------------------------- comparisons

export async function getComparisons(filters: { page?: number } = {}) {
  await requirePermission("procurement.quotation.compare");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;
  const from = (page - 1) * pageSize;

  const { data, error, count } = await supabase
    .from("supplier_quotation_comparisons")
    .select("*, requisition:purchase_requisitions(id, reference), quotes:supplier_quotation_comparison_quotes(count)", {
      count: "exact",
    })
    .order("comparison_date", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw new AppError("DATABASE_ERROR", `Comparisons could not be loaded. ${error.message}`);
  return { rows: (data ?? []) as unknown[], total: count ?? 0, page, pageSize };
}

export type ComparisonInput = z.infer<typeof comparisonCreateSchema>;

/**
 * Builds a comparison from a set of quotations.
 *
 * The totals and lead times are frozen into `supplier_quotation_comparison_quotes`, so the record of
 * what was compared survives a later correction to the quotation itself. `is_lowest_price` is
 * computed by the view — it is information for the decider, never a decision.
 */
export async function createComparison(input: ComparisonInput, meta: RequestMeta = {}) {
  await requirePermission("procurement.quotation.compare");
  const supabase = await createSupabaseServerClient();

  const { data: quotes, error: quoteError } = await supabase
    .from("supplier_quotations")
    .select("id, supplier_id, total_amount, currency_code, delivery_lead_time_days, valid_until, status")
    .in("id", input.quotationIds)
    .returns<
      {
        id: string;
        supplier_id: string;
        total_amount: number;
        currency_code: string;
        delivery_lead_time_days: number | null;
        valid_until: string | null;
        status: string;
      }[]
    >();

  if (quoteError) throw new AppError("DATABASE_ERROR", quoteError.message);
  if (!quotes || quotes.length < 2) {
    throw new AppError("VALIDATION_ERROR", "Choose at least two quotations that still exist.");
  }

  const currencies = new Set(quotes.map((quote) => quote.currency_code));
  if (currencies.size > 1) {
    // Comparing across currencies is only meaningful with an explicit rate basis, which the company
    // has not configured. Refusing is more honest than quietly adding unlike amounts.
    throw new AppError(
      "VALIDATION_ERROR",
      `These quotations are in ${[...currencies].join(", ")}. A comparison needs one currency; convert them first with a recorded rate.`,
    );
  }

  const { data: comparison, error } = await supabase
    .from("supplier_quotation_comparisons")
    .insert({
      requisition_id: input.requisitionId || null,
      title: input.title,
      currency_note: input.currencyNote ?? null,
      notes: input.notes ?? null,
      created_by: null,
    })
    .select("id, title")
    .single();

  if (error) throw new AppError("VALIDATION_ERROR", error.message);

  const { error: quotesError } = await supabase.from("supplier_quotation_comparison_quotes").insert(
    quotes.map((quote) => ({
      comparison_id: comparison.id,
      quotation_id: quote.id,
      total_at_comparison: numeric(quote.total_amount) as number,
      currency_code: quote.currency_code,
      lead_time_days_at_comparison: quote.delivery_lead_time_days,
      validity_at_comparison: quote.valid_until,
    })),
  );
  if (quotesError) throw new AppError("VALIDATION_ERROR", quotesError.message);

  await recordProcurementAudit(
    {
      action: "procurement.quotation.compared",
      entityType: "supplier_quotation_comparison",
      entityId: comparison.id,
      description: `Comparison "${comparison.title}" built from ${quotes.length} quotations.`,
      metadata: { quotation_ids: quotes.map((quote) => quote.id) },
    },
    meta,
  );

  return comparison;
}

export async function getComparisonDetail(id: string) {
  await requirePermission("procurement.quotation.compare");
  const supabase = await createSupabaseServerClient();

  const { data: comparison } = await supabase
    .from("supplier_quotation_comparisons")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!comparison) throw new AppError("NOT_FOUND", "That comparison does not exist, or you cannot see it.");

  const [offers, selection, requisition, settings] = await Promise.all([
    supabase
      .from("report_quotation_comparison")
      .select("*")
      .eq("comparison_id", id)
      .order("total_at_comparison")
      .returns<
        {
          quotation_id: string;
          quotation_reference: string;
          supplier_name: string;
          supplier_status: string;
          verification_status: string;
          total_at_comparison: number;
          currency_code: string;
          lead_time_days_at_comparison: number | null;
          validity_at_comparison: string | null;
          is_lowest_price: boolean;
          is_selected: boolean | null;
          selection_justification: string | null;
          selected_was_lowest: boolean | null;
        }[]
      >(),
    supabase
      .from("supplier_quotation_selections")
      .select("*")
      .eq("comparison_id", id)
      .maybeSingle(),
    comparison.requisition_id
      ? supabase
          .from("purchase_requisitions")
          .select("id, reference, status, currency_code, purpose")
          .eq("id", comparison.requisition_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getProcurementSettings(),
  ]);

  return {
    comparison,
    offers: offers.data ?? [],
    selection: selection.data ?? null,
    requisition: requisition.data ?? null,
    settings,
  };
}

export type SelectionInput = z.infer<typeof selectionSchema>;

/**
 * Records the supplier selection decision.
 *
 * Justification is always stored; whether it is mandatory is decided by policy
 * (`quotation_selection_requires_justification`), and the lowest-price comparison is snapshotted
 * alongside so the record shows whether a cheaper offer was passed over.
 */
export async function recordSelection(input: SelectionInput, meta: RequestMeta = {}) {
  await requirePermission("procurement.quotation.select");
  const supabase = await createSupabaseServerClient();

  const { data: comparison } = await supabase
    .from("supplier_quotation_comparisons")
    .select("id, title, requisition_id")
    .eq("id", input.comparisonId)
    .maybeSingle();
  if (!comparison) throw new AppError("NOT_FOUND", "That comparison no longer exists.");

  const { data: offer } = await supabase
    .from("supplier_quotation_comparison_quotes")
    .select("quotation_id, quotation:supplier_quotations(id, supplier_id, reference, total_amount)")
    .eq("comparison_id", input.comparisonId)
    .eq("quotation_id", input.selectedQuotationId)
    .maybeSingle<{
      quotation_id: string;
      quotation: { id: string; supplier_id: string; reference: string; total_amount: number } | null;
    }>();

  if (!offer?.quotation) {
    throw new AppError("VALIDATION_ERROR", "That quotation is not part of this comparison.");
  }

  const { data: existing } = await supabase
    .from("supplier_quotation_selections")
    .select("id")
    .eq("comparison_id", input.comparisonId)
    .maybeSingle();
  if (existing) {
    throw new AppError(
      "CONFLICT",
      "A selection has already been recorded for this comparison. A change of supplier decision needs a new comparison.",
    );
  }

  const { data, error } = await supabase
    .from("supplier_quotation_selections")
    .insert({
      comparison_id: input.comparisonId,
      selected_quotation_id: offer.quotation.id,
      selected_supplier_id: offer.quotation.supplier_id,
      requisition_id: comparison.requisition_id,
      justification: input.justification,
      decided_by: null,
    })
    .select("id, selected_was_lowest, lowest_price_quotation_id")
    .single();

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  // The chosen quotation becomes the selected one; the others are recorded as not selected.
  await supabase
    .from("supplier_quotations")
    .update({ status: "selected" })
    .eq("id", offer.quotation.id)
    .in("status", ["draft", "received", "under_evaluation"]);

  await recordProcurementAudit(
    {
      action: "procurement.quotation.selected",
      entityType: "supplier_quotation_selection",
      entityId: input.comparisonId,
      description: `Quotation ${offer.quotation.reference} selected${
        data.selected_was_lowest ? "" : " over a lower-priced offer"
      }.`,
      severity: data.selected_was_lowest ? "notice" : "warning",
      metadata: {
        justification: input.justification,
        selected_was_lowest: data.selected_was_lowest,
        lowest_price_quotation_id: data.lowest_price_quotation_id,
      },
    },
    meta,
  );

  return data;
}

/** Form options for recording a quotation. */
export async function getQuotationFormOptions() {
  await requirePermission("procurement.quotation.create");
  const supabase = await createSupabaseServerClient();

  const [suppliers, requisitions, products, units, paymentTerms, deliveryTerms] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, reference, legal_name, status, verification_status")
      .eq("status", "active")
      .order("legal_name"),
    supabase
      .from("purchase_requisitions")
      .select("id, reference, status, currency_code")
      .in("status", ["approved", "submitted", "under_review", "processing"])
      .order("requisition_date", { ascending: false }),
    supabase.from("products").select("id, code, name, base_unit_id, status").eq("status", "active").order("name"),
    supabase.from("units_of_measure").select("id, code, name").order("code"),
    supabase.from("payment_terms").select("id, name").order("name"),
    supabase.from("delivery_terms").select("id, name").order("name"),
  ]);

  return {
    suppliers: suppliers.data ?? [],
    requisitions: requisitions.data ?? [],
    products: products.data ?? [],
    units: units.data ?? [],
    paymentTerms: paymentTerms.data ?? [],
    deliveryTerms: deliveryTerms.data ?? [],
    nextReference: await peekProcurementReference("supplier_quotation"),
  };
}

/** Quotations that can be put into a comparison (two or more are needed). */
export async function getComparableQuotations(requisitionId?: string) {
  await requirePermission("procurement.quotation.compare");
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("supplier_quotations")
    .select(
      "id, reference, supplier_id, total_amount, currency_code, status, quotation_date, delivery_lead_time_days, supplier:suppliers(legal_name), requisition:purchase_requisitions(reference)",
    )
    .in("status", ["draft", "received", "under_evaluation"]);

  if (requisitionId) query = query.eq("requisition_id", requisitionId);

  const { data } = await query.order("quotation_date", { ascending: false });
  return (data ?? []) as unknown as {
    id: string;
    reference: string;
    supplier_id: string;
    total_amount: number;
    currency_code: string;
    status: string;
    quotation_date: string;
    delivery_lead_time_days: number | null;
    supplier: { legal_name: string } | null;
    requisition: { reference: string } | null;
  }[];
}
