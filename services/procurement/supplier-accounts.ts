import "server-only";

import type { RequestMeta } from "@/services/employees/manage-employee";
import type { z } from "zod";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  advanceApplicationSchema,
  advanceCreateSchema,
  advancePaymentSchema,
  reconciliationSchema,
  transactionReferenceSchema,
} from "@/lib/validation/procurement.schemas";
import { requirePermission } from "@/services/authorization";
import { decideProcurement, numeric, peekProcurementReference, recordProcurementAudit } from "./shared";

/**
 * Supplier advances, credits, statements and the supplier ledger.
 *
 * The financial honesty rules this module implements:
 *   * an advance is never an expense — it is an asset until it is applied to a document Finance
 *     confirms, and only *confirmed* applications reduce the outstanding balance;
 *   * treasury confirmation is recorded with a reference by a person who has the treasury
 *     permission. This module never invents a payment, and it never marks anything paid by itself;
 *   * the supply-chain position distinguishes ordered value, received value, invoiced amount, paid
 *     amount, advance balance and confirmed payable. A purchase order is a commitment, not a debt;
 *   * payment details (account and payment references) are restricted to holders of
 *     `procurement.supplier_advance_payment.view`, and RLS enforces that independently.
 */

export type AdvanceFilters = {
  search?: string;
  status?: string;
  supplierId?: string;
  page?: number;
  pageSize?: number;
};

export async function getAdvanceRegister(filters: AdvanceFilters = {}) {
  await requirePermission("procurement.supplier_advance.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  const from = (page - 1) * pageSize;

  let query = supabase.from("report_supplier_advances").select("*", { count: "exact" });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.search) {
    const term = filters.search.replace(/[%,()*]/g, " ").trim();
    if (term) query = query.or(`reference.ilike.%${term}%,supplier_name.ilike.%${term}%`);
  }

  const { data, error, count } = await query
    .order("transaction_date", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw new AppError("DATABASE_ERROR", `The advance register could not be loaded. ${error.message}`);
  return { rows: (data ?? []) as unknown[], total: count ?? 0, page, pageSize };
}

export async function getAdvanceDetail(id: string) {
  await requirePermission("procurement.supplier_advance.view");
  const supabase = await createSupabaseServerClient();

  const { data: advance } = await supabase.from("supplier_advances").select("*").eq("id", id).maybeSingle();
  if (!advance) throw new AppError("NOT_FOUND", "That advance does not exist, or you cannot see it.");

  const [applications, paymentDetails, supplier, history, approvals, reports, documents, bankAccounts] = await Promise.all([
    supabase
      .from("supplier_advance_applications")
      .select("*")
      .eq("advance_id", id)
      .order("applied_at"),
    // This read is refused by RLS for anyone without the sensitive permission; the row is absent
    // rather than masked, which is the only honest way to hide a bank reference.
    supabase.from("supplier_advance_payment_details").select("*").eq("advance_id", id).maybeSingle(),
    supabase.from("suppliers").select("id, reference, legal_name, status").eq("id", advance.supplier_id).maybeSingle(),
    supabase
      .from("report_procurement_status_history")
      .select("*")
      .eq("entity_type", "supplier_advance")
      .eq("entity_id", id)
      .order("created_at"),
    supabase
      .from("report_approval_decisions")
      .select("*")
      .eq("entity_type", "supplier_advance")
      .eq("entity_id", id)
      .order("created_at"),
    supabase.from("report_supplier_advance_applications").select("*").eq("advance_id", id),
    supabase
      .from("procurement_documents")
      .select("id, title, document_type, file_name, uploaded_at")
      .eq("entity_type", "supplier_advance")
      .eq("entity_id", id),
    // The supplier's accounts, which RLS already limits to holders of master_data.supplier_banking.view.
    // Only the last four digits leave this function: the payment form needs to identify the account, not
    // reproduce it, so a screenshot of the screen cannot be used to move money.
    supabase
      .from("supplier_bank_accounts")
      .select("id, bank_name, account_holder_name, account_number, currency_code, verification_status")
      .eq("supplier_id", advance.supplier_id)
      .eq("is_active", true)
      .order("bank_name"),
  ]);

  // Whether the caller may see payment details at all — used to explain the absence honestly.
  const { data: canViewPayment } = await supabase.rpc("has_permission", {
    permission_code: "procurement.supplier_advance_payment.view",
  });

  return {
    advance,
    applications: applications.data ?? [],
    paymentDetails: paymentDetails.data ?? null,
    supplier: supplier.data ?? null,
    history: history.data ?? [],
    approvals: approvals.data ?? [],
    applicationsReport: reports.data ?? [],
    documents: documents.data ?? [],
    bankAccounts: (bankAccounts.data ?? []).map((account) => ({
      id: account.id,
      label: `${account.bank_name} · ${account.account_holder_name} · ending ${account.account_number.slice(-4)} (${account.currency_code})`,
      verification_status: account.verification_status,
    })),
    canViewPayment: canViewPayment === true,
  };
}

export type AdvanceInput = z.infer<typeof advanceCreateSchema>;

export async function createAdvance(input: AdvanceInput, meta: RequestMeta = {}) {
  await requirePermission("procurement.supplier_advance.create");
  const supabase = await createSupabaseServerClient();

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, legal_name, status")
    .eq("id", input.supplierId)
    .maybeSingle();
  if (!supplier) throw new AppError("VALIDATION_ERROR", "That supplier no longer exists.");

  const { data, error } = await supabase
    .from("supplier_advances")
    .insert({
      supplier_id: input.supplierId,
      supplier_name_snapshot: supplier.legal_name,
      advance_reference: input.advanceReference ?? null,
      transaction_date: input.transactionDate,
      amount: numeric(input.amount) as number,
      currency_code: input.currencyCode,
      payment_method: input.paymentMethod,
      purchase_order_id: input.purchaseOrderId || null,
      purpose: input.purpose ?? null,
      created_by: null,
    })
    .select("id, reference")
    .single();

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.supplier_advance.created",
      entityType: "supplier_advance",
      entityId: data.id,
      description: `Advance ${data.reference} recorded for ${supplier.legal_name}: ${input.currencyCode} ${input.amount}. No payment has been confirmed.`,
      newValues: { amount: input.amount, currency: input.currencyCode, method: input.paymentMethod },
    },
    meta,
  );

  return data;
}

export async function submitAdvance(id: string, reference: string, meta: RequestMeta = {}) {
  await requirePermission("procurement.supplier_advance.submit");
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("supplier_advances").update({ status: "submitted" }).eq("id", id);
  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.supplier_advance.created",
      entityType: "supplier_advance",
      entityId: id,
      description: `Advance ${reference} submitted for approval.`,
    },
    meta,
  );

  return { id, reference };
}

export async function decideAdvance(params: {
  id: string;
  decision: "approve" | "reject" | "cancel";
  reference: string;
  comment?: string | null;
  meta?: RequestMeta;
}) {
  return decideProcurement({
    entityType: "supplier_advance",
    entityId: params.id,
    decision: params.decision,
    comment: params.comment ?? null,
    reference: params.reference,
    auditAction: "procurement.supplier_advance.created",
    revalidate: ["/procurement/supplier-advances", `/procurement/supplier-advances/${params.id}`],
    meta: params.meta,
  });
}

/**
 * Moves an approved advance to "payment pending", which is the desk that asks Treasury to pay it.
 * The transition needs the approval permission, so it is not something a requester can do alone.
 */
export async function markAdvancePaymentPending(id: string, reference: string, meta: RequestMeta = {}) {
  await requirePermission("procurement.supplier_advance.approve");
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("supplier_advances")
    .update({ status: "payment_pending" })
    .eq("id", id);
  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.supplier_advance.created",
      entityType: "supplier_advance",
      entityId: id,
      description: `Advance ${reference} passed to treasury for payment. Nothing has been paid yet.`,
    },
    meta,
  );

  return { id, reference };
}

export type AdvancePaymentInput = z.infer<typeof advancePaymentSchema>;

/**
 * Records treasury's confirmation that an advance was actually paid, with its payment reference.
 *
 * This is deliberately a separate act from approving the advance and from application: the system
 * never assumes a payment happened. The database refuses `paid` without a treasury reference.
 */
export async function confirmAdvancePayment(input: AdvancePaymentInput, reference: string, meta: RequestMeta = {}) {
  await requirePermission("procurement.supplier_advance.approve");
  const supabase = await createSupabaseServerClient();

  const { error: detailsError } = await supabase.from("supplier_advance_payment_details").upsert(
    {
      advance_id: input.advanceId,
      paying_bank_account_id: input.payingBankAccountId || null,
      paying_account_note: input.payingAccountNote ?? null,
      payment_reference: input.paymentReference,
      approved_amount: null,
      notes: input.notes ?? null,
      created_by: null,
    },
    { onConflict: "advance_id" },
  );
  if (detailsError) {
    throw new AppError(detailsError.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", detailsError.message);
  }

  const { data: updated, error } = await supabase
    .from("supplier_advances")
    .update({
      status: "paid",
      treasury_confirmed_by: null,
      treasury_confirmed_at: new Date().toISOString(),
      treasury_confirmation_reference: input.treasuryConfirmationReference,
    })
    .eq("id", input.advanceId)
    .select("id, amount, outstanding_amount, currency_code")
    .single();

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.supplier_advance.payment_confirmed",
      entityType: "supplier_advance",
      entityId: input.advanceId,
      description: `Treasury confirmed payment of advance ${reference} (treasury ref ${input.treasuryConfirmationReference}).`,
      severity: "warning",
      newValues: {
        payment_reference: input.paymentReference,
        treasury_confirmation_reference: input.treasuryConfirmationReference,
        amount: updated.amount,
        currency: updated.currency_code,
      },
    },
    meta,
  );

  return updated;
}

export type AdvanceApplicationInput = z.infer<typeof advanceApplicationSchema>;

/** Applies part of a paid advance to a document. Application is not confirmation. */
export async function applyAdvance(input: AdvanceApplicationInput, reference: string, meta: RequestMeta = {}) {
  await requirePermission("procurement.supplier_advance.approve");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("supplier_advance_applications")
    .insert({
      advance_id: input.advanceId,
      target_type: input.targetType,
      target_reference: input.targetReference,
      applied_amount: numeric(input.appliedAmount) as number,
      notes: input.notes ?? null,
      created_by: null,
    })
    .select("id, applied_amount, confirmation_status")
    .single();

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.supplier_advance.applied",
      entityType: "supplier_advance",
      entityId: input.advanceId,
      description: `Advance ${reference}: ${input.appliedAmount} proposed against ${input.targetReference}. Awaiting confirmation.`,
      newValues: { target_type: input.targetType, target_reference: input.targetReference, applied: input.appliedAmount },
    },
    meta,
  );

  return data;
}

/** Confirms an application. Only now does it reduce the advance balance. */
export async function confirmAdvanceApplication(applicationId: string, advanceReference: string, meta: RequestMeta = {}) {
  await requirePermission("procurement.supplier_advance.approve");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("supplier_advance_applications")
    .update({ confirmation_status: "confirmed", confirmed_by: null, confirmed_at: new Date().toISOString() })
    .eq("id", applicationId)
    .select("id, advance_id, applied_amount, target_reference")
    .single();

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.supplier_advance.applied",
      entityType: "supplier_advance",
      entityId: data.advance_id,
      description: `Application of ${data.applied_amount} against ${data.target_reference} confirmed on advance ${advanceReference}.`,
      severity: "warning",
    },
    meta,
  );

  return data;
}

// ---------------------------------------------------------------- supplier position

export async function getSupplierPositions(filters: { search?: string; page?: number } = {}) {
  await requirePermission("procurement.reconciliation.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;
  const from = (page - 1) * pageSize;

  let query = supabase.from("report_supplier_balance_position").select("*", { count: "exact" });
  if (filters.search) {
    const term = filters.search.replace(/[%,()*]/g, " ").trim();
    if (term) query = query.or(`legal_name.ilike.%${term}%,reference.ilike.%${term}%`);
  }

  const { data, error, count } = await query
    .order("legal_name")
    .range(from, from + pageSize - 1);

  if (error) throw new AppError("DATABASE_ERROR", `The supplier position could not be loaded. ${error.message}`);
  return { rows: (data ?? []) as unknown[], total: count ?? 0, page, pageSize };
}

export async function getSupplierPosition(supplierId: string) {
  await requirePermission("procurement.reconciliation.view");
  const supabase = await createSupabaseServerClient();

  const [supplier, positions, ledger, references, reconciliations, orders, receipts, advances] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, reference, legal_name, status, verification_status, preferred_currency_code")
      .eq("id", supplierId)
      .maybeSingle(),
    supabase.from("supplier_balances").select("*").eq("supplier_id", supplierId),
    supabase
      .from("supplier_ledger")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("activity_date", { ascending: false })
      .limit(100),
    supabase
      .from("supplier_transaction_references")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("transaction_date", { ascending: false }),
    supabase
      .from("supplier_reconciliations")
      .select("*")
      .eq("supplier_id", supplierId)
      .order("period_end", { ascending: false }),
    supabase
      .from("purchase_order_summary")
      .select("purchase_order_id, reference, status, total_amount, currency_code, order_date, outstanding_quantity")
      .eq("supplier_id", supplierId)
      .order("order_date", { ascending: false })
      .limit(50),
    supabase
      .from("report_goods_receipt_register")
      .select("id, reference, receipt_date, status, accepted_quantity, rejected_quantity, quarantined_quantity")
      .eq("supplier_name", (await supabase.from("suppliers").select("legal_name").eq("id", supplierId).maybeSingle()).data?.legal_name ?? "—")
      .order("receipt_date", { ascending: false })
      .limit(50),
    supabase
      .from("supplier_advances")
      .select("id, reference, transaction_date, amount, outstanding_amount, currency_code, status")
      .eq("supplier_id", supplierId)
      .order("transaction_date", { ascending: false }),
  ]);

  if (!supplier.data) throw new AppError("NOT_FOUND", "That supplier does not exist, or you cannot see it.");

  return {
    supplier: supplier.data,
    positions: positions.data ?? [],
    ledger: ledger.data ?? [],
    references: references.data ?? [],
    reconciliations: reconciliations.data ?? [],
    orders: orders.data ?? [],
    receipts: receipts.data ?? [],
    advances: advances.data ?? [],
  };
}

export type TransactionReferenceInput = z.infer<typeof transactionReferenceSchema>;

/**
 * Records a supplier-side document reference (an invoice, a payment, a credit note) that Finance
 * owns. Procurement stores the reference so the supplier statement can be reconciled; it does not
 * create a debt, and it does not post anything to the ledger.
 */
export async function recordTransactionReference(input: TransactionReferenceInput, meta: RequestMeta = {}) {
  await requirePermission("procurement.reconciliation.manage");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("supplier_transaction_references")
    .insert({
      supplier_id: input.supplierId,
      transaction_type: input.transactionType,
      transaction_reference: input.transactionReference,
      transaction_date: input.transactionDate,
      amount: numeric(input.amount) as number,
      currency_code: input.currencyCode,
      source: "manual_entry",
      notes: input.notes ?? null,
      created_by: null,
    })
    .select("id, transaction_reference, transaction_type")
    .single();

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.reconciliation.recorded",
      entityType: "supplier_transaction_reference",
      entityId: data.id,
      description: `Supplier document ${input.transactionReference} (${input.transactionType}) recorded for reconciliation. This is a reference, not a financial posting.`,
      newValues: { amount: input.amount, currency: input.currencyCode, type: input.transactionType },
    },
    meta,
  );

  return data;
}

export type ReconciliationInput = z.infer<typeof reconciliationSchema>;

export async function prepareReconciliation(input: ReconciliationInput, meta: RequestMeta = {}) {
  await requirePermission("procurement.reconciliation.manage");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("supplier_reconciliations")
    .insert({
      supplier_id: input.supplierId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      currency_code: input.currencyCode,
      notes: input.notes ?? null,
      prepared_at: new Date().toISOString(),
    })
    .select("id, reference, difference_amount")
    .single();

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.reconciliation.recorded",
      entityType: "supplier_reconciliation",
      entityId: data.id,
      description: `Supplier reconciliation ${data.reference} prepared for ${input.periodStart} to ${input.periodEnd}.`,
    },
    meta,
  );

  return data;
}

/** Form options for recording an advance. */
export async function getAdvanceFormOptions() {
  await requirePermission("procurement.supplier_advance.create");
  const supabase = await createSupabaseServerClient();

  const [suppliers, purchaseOrders] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, reference, legal_name, status, preferred_currency_code")
      .eq("status", "active")
      .order("legal_name"),
    supabase
      .from("purchase_orders")
      .select("id, reference, supplier_id, status, total_amount, currency_code")
      .in("status", ["issued", "partially_received"])
      .order("order_date", { ascending: false })
      .limit(100),
  ]);

  return {
    suppliers: suppliers.data ?? [],
    purchaseOrders: purchaseOrders.data ?? [],
    nextReference: await peekProcurementReference("supplier_advance"),
  };
}
