import "server-only";

import type { RequestMeta } from "@/services/employees/manage-employee";
import type { z } from "zod";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { commentSchema, documentSchema } from "@/lib/validation/procurement.schemas";
import { requirePermission } from "@/services/authorization";
import { getProcurementSettings, recordProcurementAudit } from "./shared";

/**
 * Procurement dashboard.
 *
 * Every figure below is a count or a sum returned by the database. There are no placeholder cards,
 * no "sample" numbers and no target-versus-actual lines that the company has not set. Where a metric
 * cannot be computed honestly — a payable without an invoice, an acceptance rate for receipts nobody
 * has posted — the dashboard says so instead of showing a zero.
 */

export type DashboardMetric = {
  label: string;
  value: string;
  hint: string;
  tone: "neutral" | "brand" | "pending" | "danger";
};

export async function getProcurementDashboard() {
  await requirePermission("procurement.dashboard.view");
  const supabase = await createSupabaseServerClient();

  const [
    requisitions,
    orders,
    receipts,
    advances,
    quotes,
    quality,
    overdue,
    outbox,
    notifications,
  ] = await Promise.all([
    supabase.from("purchase_requisitions").select("status"),
    supabase.from("purchase_orders").select("status, currency_code, total_amount"),
    supabase.from("goods_receipts").select("status"),
    supabase.from("supplier_advances").select("status, currency_code, amount, outstanding_amount"),
    supabase.from("supplier_quotations").select("status"),
    supabase.from("procurement_data_quality").select("*").returns<
      { entity_type: string; indicator: string; description: string; severity: string; record_count: number }[]
    >(),
    supabase
      .from("purchase_order_summary")
      .select("purchase_order_id, reference, supplier_name_snapshot, expected_delivery_date, outstanding_quantity, currency_code, status")
      .eq("is_overdue", true)
      .limit(5),
    supabase
      .from("procurement_integration_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);

  const countBy = (rows: { status: string }[] | null, status: string) =>
    (rows ?? []).filter((row) => row.status === status).length;

  const requisitionRows = requisitions.data ?? [];
  const orderRows = orders.data ?? [];
  const receiptRows = receipts.data ?? [];
  const advanceRows = advances.data ?? [];
  const quoteRows = quotes.data ?? [];

  // Committed spend, kept per currency. Adding naira to dollars would be a worse answer than three
  // separate ones, so each currency is reported on its own.
  const committed = new Map<string, number>();
  for (const order of orderRows) {
    if (["cancelled", "rejected", "draft"].includes(order.status)) continue;
    committed.set(order.currency_code, (committed.get(order.currency_code) ?? 0) + Number(order.total_amount));
  }

  const advanceBalance = new Map<string, number>();
  for (const advance of advanceRows) {
    if (!["paid", "partially_applied"].includes(advance.status)) continue;
    advanceBalance.set(
      advance.currency_code,
      (advanceBalance.get(advance.currency_code) ?? 0) + Number(advance.outstanding_amount),
    );
  }

  const metrics: DashboardMetric[] = [
    {
      label: "Requisitions awaiting a decision",
      value: String(countBy(requisitionRows, "submitted") + countBy(requisitionRows, "under_review")),
      hint: `${requisitionRows.length} requisition(s) recorded in total`,
      tone: "pending",
    },
    {
      label: "Orders awaiting approval",
      value: String(countBy(orderRows, "submitted") + countBy(orderRows, "under_review")),
      hint: `${countBy(orderRows, "draft")} still in draft`,
      tone: "pending",
    },
    {
      label: "Issued orders outstanding",
      value: String(countBy(orderRows, "issued") + countBy(orderRows, "partially_received")),
      hint: `${countBy(orderRows, "fully_received")} fully received`,
      tone: "brand",
    },
    {
      label: "Receipts awaiting review",
      value: String(countBy(receiptRows, "submitted") + countBy(receiptRows, "under_review")),
      hint: `${countBy(receiptRows, "posted")} posted and handed to inventory`,
      tone: "pending",
    },
    {
      label: "Quotations open",
      value: String(
        countBy(quoteRows, "received") + countBy(quoteRows, "under_evaluation") + countBy(quoteRows, "draft"),
      ),
      hint: `${countBy(quoteRows, "selected")} selected and carried into an order`,
      tone: "neutral",
    },
    {
      label: "Advances awaiting treasury",
      value: String(countBy(advanceRows, "approved") + countBy(advanceRows, "payment_pending")),
      hint: "Approved is not paid: treasury confirmation is recorded separately",
      tone: "pending",
    },
    {
      label: "Inventory handoff events pending",
      value: String(outbox.count ?? 0),
      hint: "Posted receipts whose accepted quantity has not yet been picked up by inventory",
      tone: (outbox.count ?? 0) > 0 ? "pending" : "neutral",
    },
    {
      label: "Unread notifications",
      value: String(notifications.count ?? 0),
      hint: "In-app only; no email or WhatsApp delivery is attempted",
      tone: "neutral",
    },
  ];

  return {
    metrics,
    committed: [...committed.entries()].map(([currency, total]) => ({ currency, total })),
    advanceBalances: [...advanceBalance.entries()].map(([currency, total]) => ({ currency, total })),
    overdue: overdue.data ?? [],
    quality: (quality.data ?? []).filter((row) => row.record_count > 0),
  };
}

// ---------------------------------------------------------------- documents & comments

export type DocumentInput = z.infer<typeof documentSchema>;

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
]);

/**
 * Registers a document against a procurement transaction.
 *
 * The file itself is *not* uploaded: no storage bucket is configured for this project, so the
 * register records metadata and an optional external path and says `metadata_only` rather than
 * pretending the file is retrievable. The metadata rules (permitted types, maximum size from
 * configuration) are still enforced, because they are the same rules that will apply once a bucket
 * exists.
 */
export async function registerDocument(input: DocumentInput, meta: RequestMeta = {}) {
  await requirePermission("procurement.document.upload");
  const settings = await getProcurementSettings();
  const supabase = await createSupabaseServerClient();

  if (!ALLOWED_MIME.has(input.mimeType)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `That file type (${input.mimeType}) is not accepted. Use PDF, JPEG, PNG, WebP, CSV, XLSX or DOCX.`,
    );
  }
  const size = Number(input.fileSizeBytes);
  if (!Number.isFinite(size) || size <= 0) throw new AppError("VALIDATION_ERROR", "Record the file size in bytes.");
  if (size > settings.documentMaxSizeBytes) {
    throw new AppError(
      "VALIDATION_ERROR",
      `That file is larger than the ${Math.round(settings.documentMaxSizeBytes / 1_048_576)} MB limit set in procurement settings.`,
    );
  }

  const { data, error } = await supabase
    .from("procurement_documents")
    .insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      entity_reference: null,
      document_type: input.documentType,
      title: input.title,
      file_name: input.fileName,
      mime_type: input.mimeType,
      file_size_bytes: size,
      storage_path: input.storagePath ?? null,
      notes: input.notes ?? null,
      uploaded_by: null,
    })
    .select("id, title")
    .single();

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.document.registered",
      entityType: input.entityType,
      entityId: input.entityId,
      description: `Document "${input.title}" (${input.documentType}) registered against ${input.entityType}. Metadata only — no file storage is configured.`,
      newValues: { file_name: input.fileName, mime_type: input.mimeType, size },
    },
    meta,
  );

  return data;
}

export type CommentInput = z.infer<typeof commentSchema>;

export async function addComment(input: CommentInput, meta: RequestMeta = {}) {
  await requirePermission("procurement.document.view");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("procurement_comments")
    .insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      body: input.body,
      visibility: input.visibility,
      author_profile_id: null,
    })
    .select("id")
    .single();

  if (error) throw new AppError(error.code === "42501" ? "FORBIDDEN" : "VALIDATION_ERROR", error.message);

  await recordProcurementAudit(
    {
      action: "procurement.comment.added",
      entityType: input.entityType,
      entityId: input.entityId,
      description: `Comment added (${input.visibility}).`,
      metadata: { length: input.body.length },
    },
    meta,
  );

  return data;
}

/** The document register, across every procurement transaction. */
export async function getDocumentRegister(filters: { page?: number; entityType?: string } = {}) {
  await requirePermission("procurement.document.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;
  const from = (page - 1) * pageSize;

  let query = supabase.from("report_procurement_documents").select("*", { count: "exact" });
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);

  const { data, error, count } = await query.order("uploaded_at", { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `The document register could not be loaded. ${error.message}`);

  return { rows: (data ?? []) as unknown[], total: count ?? 0, page, pageSize };
}

// ---------------------------------------------------------------- notifications

export async function getNotifications(limit = 25) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as unknown as {
    id: string;
    module: string;
    event_type: string;
    title: string;
    body: string | null;
    href: string | null;
    severity: string;
    read_at: string | null;
    created_at: string;
  }[];
}

export async function markNotificationRead(id: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new AppError("DATABASE_ERROR", error.message);
}

// ---------------------------------------------------------------- legacy readiness

/**
 * Legacy migration readiness (spec §10).
 *
 * This counts what a future import would face. It does not connect to the legacy database, and it
 * never guesses a mapping: an unmatched legacy row is reported as unmatched.
 */
export async function getLegacyReadiness() {
  await requirePermission("procurement.legacy.view");
  const supabase = await createSupabaseServerClient();

  const [imports, rows, existingRefs] = await Promise.all([
    supabase.from("procurement_legacy_imports").select("*").order("created_at", { ascending: false }),
    supabase.from("procurement_legacy_import_rows").select("match_status"),
    supabase.from("legacy_record_references").select("id, source_system", { count: "exact", head: true }),
  ]);

  const byStatus = new Map<string, number>();
  for (const row of rows.data ?? []) {
    byStatus.set(row.match_status, (byStatus.get(row.match_status) ?? 0) + 1);
  }

  return {
    imports: imports.data ?? [],
    rowCounts: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
    totalLegacyReferences: existingRefs.count ?? 0,
    connectedToLegacy: false,
  };
}

/** The approval trail across procurement documents. */
export async function getApprovalTrail(filters: { page?: number; entityType?: string } = {}) {
  await requirePermission("procurement.approval.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;
  const from = (page - 1) * pageSize;

  let query = supabase.from("report_approval_decisions").select("*", { count: "exact" });
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);

  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `The approval trail could not be loaded. ${error.message}`);

  return { rows: (data ?? []) as unknown[], total: count ?? 0, page, pageSize };
}
