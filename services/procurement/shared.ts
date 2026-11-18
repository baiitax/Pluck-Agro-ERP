import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PermissionCode } from "@/lib/permissions/definitions";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import { requirePermission } from "@/services/authorization";
import { resolveCurrentPrincipal } from "@/services/auth/resolve-principal";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { AuditSeverity } from "@/types/database.types";

/**
 * Shared plumbing for the procurement services.
 *
 * Three invariants live here so no individual service can forget them:
 *  1. Every write records an audit event in the `procurement` category and fails closed if the audit
 *     write fails — an unauditable procurement change is not an acceptable outcome.
 *  2. A decision (approve/reject/issue/post/cancel) goes through the database function
 *     `procurement_decide`, which checks permission, approval authority and segregation of duties in
 *     the same transaction as the status change. No service writes a status column directly.
 *  3. A database refusal is translated into a message a person can act on. The trigger messages in
 *     this schema are written in plain language for exactly that reason.
 */

export type ProcurementAuditAction =
  | "procurement.requisition.created"
  | "procurement.requisition.updated"
  | "procurement.requisition.submitted"
  | "procurement.requisition.converted"
  | "procurement.quotation.requested"
  | "procurement.quotation.recorded"
  | "procurement.quotation.updated"
  | "procurement.quotation.compared"
  | "procurement.quotation.selected"
  | "procurement.purchase_order.created"
  | "procurement.purchase_order.updated"
  | "procurement.purchase_order.submitted"
  | "procurement.purchase_order.issued"
  | "procurement.purchase_order.amended"
  | "procurement.purchase_order.closed"
  | "procurement.goods_receipt.created"
  | "procurement.goods_receipt.updated"
  | "procurement.goods_receipt.submitted"
  | "procurement.goods_receipt.inspected"
  | "procurement.goods_receipt.posted"
  | "procurement.supplier_advance.created"
  | "procurement.supplier_advance.payment_confirmed"
  | "procurement.supplier_advance.applied"
  | "procurement.reconciliation.recorded"
  | "procurement.document.registered"
  | "procurement.comment.added"
  | "procurement.notification.read";

export type ProcurementAuditInput = {
  action: ProcurementAuditAction;
  entityType: string;
  entityId: string | null;
  description: string;
  severity?: AuditSeverity;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

/** Records a procurement audit event for the current actor. Throws if the audit write fails. */
export async function recordProcurementAudit(input: ProcurementAuditInput, meta: RequestMeta = {}): Promise<void> {
  const resolution = await resolveCurrentPrincipal();
  const actor = resolution.status === "authenticated" ? resolution.principal.user.id : null;
  const actorEmployeeId =
    resolution.status === "authenticated" ? (resolution.principal.employee?.id ?? null) : null;

  await recordAuditEvent({
    actorUserId: actor,
    actorEmployeeId,
    action: input.action,
    eventCategory: "procurement",
    severity: input.severity ?? "notice",
    module: "procurement",
    entityType: input.entityType,
    entityId: input.entityId,
    description: input.description,
    oldValues: (input.oldValues ?? null) as never,
    newValues: (input.newValues ?? null) as never,
    metadata: (input.metadata ?? null) as never,
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });
}

/**
 * Sends a decimal to PostgreSQL without passing through a binary float.
 *
 * NUMERIC columns are typed `number` in the generated types because that is what PostgREST returns,
 * but a JavaScript number cannot represent every NUMERIC value. PostgREST accepts a JSON string for
 * a numeric column and PostgreSQL casts it exactly, so quantities and prices travel as text and are
 * narrowed here, once, instead of scattering casts through the services.
 */
export function numeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value) as unknown as number;
}

/** Advisory reference preview for a form. The database assigns the real number on insert. */
export async function peekProcurementReference(entity: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("procurement_numbering")
    .select("prefix, padding, include_year, last_period, last_value")
    .eq("entity", entity)
    .maybeSingle<{
      prefix: string;
      padding: number;
      include_year: boolean;
      last_period: string | null;
      last_value: number;
    }>();

  if (error || !data) return "Assigned on save";

  const period = String(new Date().getUTCFullYear());
  const nextValue = (data.last_period === period ? data.last_value : 0) + 1;
  const parts = [data.prefix];
  if (data.include_year) parts.push(period);
  parts.push(String(nextValue).padStart(data.padding, "0"));
  return parts.join("-");
}

export type ProcurementSettingKey =
  | "requisition_requires_approval"
  | "quotation_selection_requires_justification"
  | "po_amendment_requires_approval"
  | "receipt_requires_review"
  | "allow_multiple_requisitions_per_po"
  | "excess_receipt_tolerance_percent"
  | "document_max_size_bytes";

export type ProcurementSettings = {
  requisitionRequiresApproval: boolean;
  quotationSelectionRequiresJustification: boolean;
  poAmendmentRequiresApproval: boolean;
  receiptRequiresReview: boolean;
  allowMultipleRequisitionsPerPo: boolean;
  excessReceiptTolerancePercent: string;
  documentMaxSizeBytes: number;
};

/**
 * Reads the configurable procurement policy.
 *
 * The defaults below are used only when a row is missing, and they are the conservative reading:
 * approvals required, justification required, no excess tolerance. They are not hard-coded limits —
 * the amounts and thresholds that matter live in `approval_authorities` and are configured by an
 * administrator, never in TypeScript.
 */
export async function getProcurementSettings(): Promise<ProcurementSettings> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("procurement_settings")
    .select("key, value_text, value_numeric, value_boolean")
    .returns<{ key: string; value_text: string | null; value_numeric: number | null; value_boolean: boolean | null }[]>();

  const rows = new Map((data ?? []).map((row) => [row.key, row]));
  const bool = (key: string, fallback: boolean) => rows.get(key)?.value_boolean ?? fallback;
  const num = (key: string, fallback: string) =>
    rows.get(key)?.value_numeric === null || rows.get(key)?.value_numeric === undefined
      ? fallback
      : String(rows.get(key)!.value_numeric);

  return {
    requisitionRequiresApproval: bool("requisition_requires_approval", true),
    quotationSelectionRequiresJustification: bool("quotation_selection_requires_justification", true),
    poAmendmentRequiresApproval: bool("po_amendment_requires_approval", true),
    receiptRequiresReview: bool("receipt_requires_review", true),
    allowMultipleRequisitionsPerPo: bool("allow_multiple_requisitions_per_po", true),
    excessReceiptTolerancePercent: num("excess_receipt_tolerance_percent", "0"),
    documentMaxSizeBytes: Number(num("document_max_size_bytes", "10485760")),
  };
}

/** Whether the caller's configured authority covers this amount. Drives honest button states. */
export async function authorityCovers(
  transactionType: string,
  amount: number | null,
  currency: string | null,
): Promise<boolean> {
  if (amount === null || !currency) return false;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("procurement_authority_covers", {
    p_module: "procurement",
    p_transaction_type: transactionType,
    p_amount: amount,
    p_currency: currency,
  });
  if (error) return false;
  return data === true;
}

export type Decision = "approve" | "reject" | "return" | "issue" | "post" | "cancel" | "confirm_payment";

export type DecisionOutcome = {
  entityType: string;
  entityId: string;
  previousStatus: string;
  newStatus: string;
  authorityId: string | null;
  sodRuleId: string | null;
};

/**
 * Records a procurement decision through the one database path that enforces the governance rules,
 * then audits it and refreshes the affected pages.
 *
 * Deliberately not implemented as "update the status column": that would let any caller with a
 * table-level grant skip the authority and separation-of-duties checks.
 */
export async function decideProcurement(params: {
  entityType: "purchase_requisition" | "purchase_order" | "purchase_order_amendment" | "goods_receipt" | "supplier_advance";
  entityId: string;
  decision: Decision;
  comment?: string | null;
  reference: string;
  auditAction: ProcurementAuditAction;
  revalidate: string[];
  meta?: RequestMeta;
}): Promise<DecisionOutcome> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("procurement_decide", {
    p_entity_type: params.entityType,
    p_entity_id: params.entityId,
    p_decision: params.decision,
    p_comment: params.comment ?? null,
  });

  if (error) {
    throw new AppError(
      error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR",
      error.message.replace(/^ERROR:\s*/i, "").trim(),
    );
  }

  const row = (data ?? [])[0];
  if (!row) throw new AppError("UNEXPECTED_ERROR", "The decision was not recorded. Nothing was changed.");

  await recordProcurementAudit(
    {
      action: params.auditAction,
      entityType: params.entityType,
      entityId: params.entityId,
      description: `${params.reference}: ${params.decision.replace(/_/g, " ")} (${row.previous_status} → ${row.new_status}).`,
      severity: params.decision === "reject" ? "warning" : "notice",
      metadata: {
        decision: params.decision,
        previous_status: row.previous_status,
        new_status: row.new_status,
        authority_id: row.authority_id,
        sod_rule_id: row.sod_rule_id,
        comment: params.comment ?? null,
      },
    },
    params.meta,
  );

  for (const path of params.revalidate) revalidatePath(path);

  return {
    entityType: row.entity_type,
    entityId: row.entity_id,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    authorityId: row.authority_id,
    sodRuleId: row.sod_rule_id,
  };
}

/** Notifies holders of a permission about a document that now needs them. Best-effort. */
export async function notifyApprovers(params: {
  permission: PermissionCode;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  href: string;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("procurement_notify_approvers", {
    p_permission: params.permission,
    p_title: params.title,
    p_body: params.body,
    p_entity_type: params.entityType,
    p_entity_id: params.entityId,
    p_href: params.href,
  });
}

/**
 * Turns a database error into a message the person in front of the screen can act on.
 *
 * Constraint and trigger messages in this schema are written for humans on purpose; this function
 * passes them through rather than flattening everything into "Something went wrong".
 */
export function translateProcurementError(
  error: { code?: string; message: string },
  entityLabel: string,
): AppError {
  const humanised = error.message
    .replace(/^new row for relation "[^"]+" violates check constraint "[^"]+"\s*/i, "")
    .replace(/^ERROR:\s*/i, "")
    .trim();

  if (error.code === "23505") {
    return new AppError("CONFLICT", `That ${entityLabel} is already recorded. ${humanised}`);
  }
  if (error.code === "23503") {
    return new AppError("VALIDATION_ERROR", "A selected record no longer exists. Refresh the page and try again.");
  }
  if (error.code === "23514") {
    return new AppError("VALIDATION_ERROR", humanised || `The ${entityLabel} was refused by a data rule.`);
  }
  if (error.code === "42501") {
    return new AppError("FORBIDDEN", humanised);
  }
  if (error.code === "P0002") {
    return new AppError("NOT_FOUND", humanised || `The ${entityLabel} no longer exists.`);
  }
  return new AppError("DATABASE_ERROR", `${entityLabel} could not be saved. ${humanised || error.message}`);
}

/** Requires a permission and returns the principal, for services that also need the actor. */
export async function requireProcurementPermission(permission: PermissionCode) {
  return requirePermission(permission);
}

/** Escapes a value for use inside a PostgREST `or()` filter. */
export function escapeFilterValue(value: string): string {
  return value.replace(/[%,()*]/g, " ").trim();
}

export type ListFilters = {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

export function pagination(filters: ListFilters): { page: number; pageSize: number; from: number; to: number } {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}
