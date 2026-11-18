import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";

/**
 * The procurement reports.
 *
 * Every report is a view. Nothing is aggregated in TypeScript, so a report cannot disagree with the
 * documents behind it, and `security_invoker` on each view means a report never shows a row the
 * caller could not have opened directly.
 *
 * Each definition states four things the reader needs in order to trust the number:
 *   * what the rows are;
 *   * which date the filter applies to;
 *   * the currency basis;
 *   * what the report cannot tell them.
 */

export type ReportDefinition = {
  id: string;
  title: string;
  description: string;
  /** Underlying view name. */
  view: string;
  /** Column a date filter is applied to, when the report has one. */
  dateColumn?: string;
  currencyColumn?: string;
  group: "requisitions" | "orders" | "receiving" | "sourcing" | "suppliers" | "governance";
  limitations: string;
  columns: { key: string; label: string; kind?: "money" | "quantity" | "date" | "datetime" | "bool" }[];
};

export const PROCUREMENT_REPORTS: ReportDefinition[] = [
  {
    id: "requisition-register",
    title: "Requisition register",
    description: "Every purchase requisition with its lines, requested quantity and how much has been allocated to orders.",
    view: "report_requisition_register",
    dateColumn: "requisition_date",
    currencyColumn: "currency_code",
    group: "requisitions",
    limitations:
      "Estimated values are the requester's estimate, not a price. A requisition with zero allocated quantity has not been ordered yet.",
    columns: [
      { key: "reference", label: "Reference" },
      { key: "status", label: "Status" },
      { key: "priority", label: "Priority" },
      { key: "requisition_date", label: "Raised", kind: "date" },
      { key: "required_delivery_date", label: "Required by", kind: "date" },
      { key: "department_name", label: "Department" },
      { key: "requesting_employee", label: "Requested by" },
      { key: "estimated_total", label: "Estimated value", kind: "money" },
      { key: "currency_code", label: "Currency" },
      { key: "requested_quantity", label: "Requested qty", kind: "quantity" },
      { key: "allocated_quantity", label: "Allocated qty", kind: "quantity" },
      { key: "approval_hours", label: "Approval hours" },
    ],
  },
  {
    id: "purchase-order-register",
    title: "Purchase order register",
    description: "Committed orders with ordered, received and outstanding quantities and the percentage received.",
    view: "report_purchase_order_register",
    dateColumn: "order_date",
    currencyColumn: "currency_code",
    group: "orders",
    limitations:
      "Total amount is the agreed value of the order. It is a commitment, not an invoice and not a payable.",
    columns: [
      { key: "reference", label: "Reference" },
      { key: "status", label: "Status" },
      { key: "supplier_name", label: "Supplier" },
      { key: "order_date", label: "Ordered", kind: "date" },
      { key: "expected_delivery_date", label: "Expected", kind: "date" },
      { key: "total_amount", label: "Total", kind: "money" },
      { key: "currency_code", label: "Currency" },
      { key: "ordered_quantity", label: "Ordered qty", kind: "quantity" },
      { key: "received_quantity", label: "Received qty", kind: "quantity" },
      { key: "outstanding_quantity", label: "Outstanding qty", kind: "quantity" },
      { key: "received_percent", label: "Received %" },
      { key: "is_overdue", label: "Overdue", kind: "bool" },
    ],
  },
  {
    id: "outstanding-deliveries",
    title: "Outstanding deliveries",
    description: "Issued or partly received orders that still have quantity outstanding, with days past the expected date.",
    view: "report_outstanding_deliveries",
    dateColumn: "expected_delivery_date",
    currencyColumn: "currency_code",
    group: "orders",
    limitations:
      "An order with no expected delivery date cannot be counted as late. Outstanding quantity excludes rejected and quarantined goods.",
    columns: [
      { key: "reference", label: "Order" },
      { key: "supplier_name", label: "Supplier" },
      { key: "status", label: "Status" },
      { key: "expected_delivery_date", label: "Expected", kind: "date" },
      { key: "outstanding_quantity", label: "Outstanding qty", kind: "quantity" },
      { key: "days_past_expected", label: "Days late" },
      { key: "is_overdue", label: "Overdue", kind: "bool" },
    ],
  },
  {
    id: "goods-receipt-register",
    title: "Goods receipt register",
    description: "Every delivery received, with its split into accepted, rejected and quarantined quantity and its posting reference.",
    view: "report_goods_receipt_register",
    dateColumn: "receipt_date",
    group: "receiving",
    limitations:
      "A receipt that is not posted has moved no stock. Accepted quantity becomes inventory only when the inventory handoff event is consumed (Phase 5).",
    columns: [
      { key: "reference", label: "Receipt" },
      { key: "status", label: "Status" },
      { key: "receipt_date", label: "Received", kind: "date" },
      { key: "purchase_order_reference", label: "Order" },
      { key: "supplier_name", label: "Supplier" },
      { key: "supplier_delivery_note_number", label: "Delivery note" },
      { key: "received_quantity", label: "Received qty", kind: "quantity" },
      { key: "accepted_quantity", label: "Accepted qty", kind: "quantity" },
      { key: "rejected_quantity", label: "Rejected qty", kind: "quantity" },
      { key: "quarantined_quantity", label: "Quarantined qty", kind: "quantity" },
      { key: "posting_reference", label: "Posting reference" },
      { key: "posted_at", label: "Posted", kind: "datetime" },
    ],
  },
  {
    id: "receipt-discrepancies",
    title: "Receipt discrepancies",
    description: "Line-level view of short deliveries, excess deliveries and rejected or quarantined goods with the reason stated.",
    view: "report_receipt_discrepancies",
    dateColumn: "receipt_date",
    group: "receiving",
    limitations:
      "A discrepancy is recorded only where the receiver noticed it. An accepted line with no comment means it was counted and passed, not that it was inspected in a laboratory.",
    columns: [
      { key: "reference", label: "Receipt" },
      { key: "receipt_date", label: "Received", kind: "date" },
      { key: "purchase_order_reference", label: "Order" },
      { key: "supplier_name", label: "Supplier" },
      { key: "product_name", label: "Product" },
      { key: "received_quantity", label: "Received qty", kind: "quantity" },
      { key: "accepted_quantity", label: "Accepted qty", kind: "quantity" },
      { key: "rejected_quantity", label: "Rejected qty", kind: "quantity" },
      { key: "quarantined_quantity", label: "Quarantined qty", kind: "quantity" },
      { key: "rejection_reason", label: "Reason" },
      { key: "is_excess_delivery", label: "Excess", kind: "bool" },
      { key: "is_short_delivery", label: "Short", kind: "bool" },
    ],
  },
  {
    id: "quotation-comparison",
    title: "Quotation comparison",
    description: "Each compared offer with the total it was judged on, the lowest-price marker, and the selection that followed.",
    view: "report_quotation_comparison",
    dateColumn: "comparison_date",
    currencyColumn: "currency_code",
    group: "sourcing",
    limitations:
      "`is_lowest_price` is information, not a recommendation. `is_selected` and its justification are the decision; a selection above the lowest price is recorded and visible here.",
    columns: [
      { key: "comparison_title", label: "Comparison" },
      { key: "comparison_date", label: "Date", kind: "date" },
      { key: "quotation_reference", label: "Quotation" },
      { key: "supplier_name", label: "Supplier" },
      { key: "total_at_comparison", label: "Total compared", kind: "money" },
      { key: "currency_code", label: "Currency" },
      { key: "lead_time_days_at_comparison", label: "Lead time (days)" },
      { key: "is_lowest_price", label: "Lowest price", kind: "bool" },
      { key: "is_selected", label: "Selected", kind: "bool" },
      { key: "selection_justification", label: "Justification" },
      { key: "selected_was_lowest", label: "Selected was lowest", kind: "bool" },
    ],
  },
  {
    id: "supplier-advances",
    title: "Supplier advances",
    description: "Advances paid to suppliers, what has been applied against documents and what remains outstanding.",
    view: "report_supplier_advances",
    dateColumn: "transaction_date",
    currencyColumn: "currency_code",
    group: "suppliers",
    limitations:
      "An advance is not an expense until it is applied and confirmed. `outstanding_amount` reduces only by confirmed applications.",
    columns: [
      { key: "reference", label: "Advance" },
      { key: "supplier_name", label: "Supplier" },
      { key: "transaction_date", label: "Date", kind: "date" },
      { key: "amount", label: "Advance", kind: "money" },
      { key: "outstanding_amount", label: "Outstanding", kind: "money" },
      { key: "currency_code", label: "Currency" },
      { key: "status", label: "Status" },
      { key: "payment_method", label: "Method" },
      { key: "treasury_confirmation_reference", label: "Treasury ref" },
      { key: "applied_amount", label: "Applied", kind: "money" },
    ],
  },
  {
    id: "supplier-procurement",
    title: "Supplier procurement activity",
    description: "Order count, ordered value, receipt count and advance count per supplier and currency.",
    view: "report_supplier_procurement",
    dateColumn: "last_order_date",
    currencyColumn: "currency_code",
    group: "suppliers",
    limitations:
      "A supplier with no orders shows no currency, because there is no amount to denominate. Values are never combined across currencies.",
    columns: [
      { key: "reference", label: "Reference" },
      { key: "legal_name", label: "Supplier" },
      { key: "status", label: "Status" },
      { key: "verification_status", label: "Verification" },
      { key: "currency_code", label: "Currency" },
      { key: "purchase_order_count", label: "Orders" },
      { key: "ordered_value", label: "Ordered value", kind: "money" },
      { key: "receipt_count", label: "Receipts" },
      { key: "advance_count", label: "Advances" },
      { key: "last_order_date", label: "Last order", kind: "date" },
    ],
  },
  {
    id: "procurement-expenditure",
    title: "Procurement expenditure",
    description: "Ordered value by month, supplier, department and product, denominated in the order currency.",
    view: "report_procurement_expenditure",
    dateColumn: "period_month",
    currencyColumn: "currency_code",
    group: "orders",
    limitations:
      "This is committed spend, by order date, in the order's own currency. It is not cash paid, not an accrual and not an accounting expense.",
    columns: [
      { key: "period_month", label: "Month", kind: "date" },
      { key: "currency_code", label: "Currency" },
      { key: "supplier_name", label: "Supplier" },
      { key: "department_name", label: "Department" },
      { key: "product_name", label: "Product" },
      { key: "ordered_value", label: "Ordered value", kind: "money" },
      { key: "ordered_quantity", label: "Ordered qty", kind: "quantity" },
    ],
  },
  {
    id: "approval-turnaround",
    title: "Approval turnaround",
    description: "Time between submission and the latest decision, per document.",
    view: "report_approval_turnaround",
    dateColumn: "submitted_at",
    group: "governance",
    limitations:
      "Turnaround measures elapsed clock time, not working time. A document with no decision yet has no turnaround figure.",
    columns: [
      { key: "entity_type", label: "Document type" },
      { key: "entity_reference", label: "Reference" },
      { key: "submitted_at", label: "Submitted", kind: "datetime" },
      { key: "decided_at", label: "Decided", kind: "datetime" },
      { key: "latest_decision", label: "Decision" },
      { key: "turnaround_hours", label: "Hours" },
    ],
  },
  {
    id: "purchase-order-amendments",
    title: "Purchase order amendments",
    description: "Every amendment with the order total before and after it, and the change it asked for.",
    view: "report_purchase_order_amendments",
    dateColumn: "requested_at",
    currencyColumn: "currency_code",
    group: "orders",
    limitations:
      "An amendment that is not applied has changed nothing on the order. `total_change` becomes the order's value only when the amendment is applied.",
    columns: [
      { key: "reference", label: "Amendment" },
      { key: "purchase_order_reference", label: "Order" },
      { key: "supplier_name", label: "Supplier" },
      { key: "status", label: "Status" },
      { key: "base_version", label: "Base version" },
      { key: "previous_total", label: "Before", kind: "money" },
      { key: "new_total", label: "After", kind: "money" },
      { key: "total_change", label: "Change", kind: "money" },
      { key: "currency_code", label: "Currency" },
      { key: "requested_at", label: "Raised", kind: "datetime" },
      { key: "applied_at", label: "Applied", kind: "datetime" },
    ],
  },
  {
    id: "requisition-traceability",
    title: "Requisition to order traceability",
    description: "One row per requisition line and the order line it was allocated to.",
    view: "report_requisition_traceability",
    group: "requisitions",
    limitations:
      "A blank purchase order means the quantity has not been ordered. Partial allocation is normal: one requisition may be split across several orders.",
    columns: [
      { key: "requisition_reference", label: "Requisition" },
      { key: "requisition_status", label: "Status" },
      { key: "line_number", label: "Line" },
      { key: "product_name", label: "Product" },
      { key: "requested_quantity", label: "Requested qty", kind: "quantity" },
      { key: "unit_code", label: "Unit" },
      { key: "purchase_order_reference", label: "Order" },
      { key: "purchase_order_status", label: "Order status" },
      { key: "allocated_quantity", label: "Allocated qty", kind: "quantity" },
      { key: "unallocated_quantity", label: "Unallocated qty", kind: "quantity" },
    ],
  },
  {
    id: "supplier-advance-applications",
    title: "Supplier advance applications",
    description: "Every application of an advance, marked with whether it reduces the balance.",
    view: "report_supplier_advance_applications",
    dateColumn: "applied_at",
    currencyColumn: "currency_code",
    group: "suppliers",
    limitations:
      "A pending application is a claim awaiting confirmation and does not change the advance balance.",
    columns: [
      { key: "advance_reference", label: "Advance" },
      { key: "supplier_name", label: "Supplier" },
      { key: "target_type", label: "Applied to" },
      { key: "target_reference", label: "Document" },
      { key: "applied_amount", label: "Applied", kind: "money" },
      { key: "confirmation_status", label: "Confirmation" },
      { key: "reduces_balance", label: "Reduces balance", kind: "bool" },
      { key: "applied_at", label: "Applied", kind: "datetime" },
      { key: "confirmed_at", label: "Confirmed", kind: "datetime" },
    ],
  },
  {
    id: "supplier-balance-position",
    title: "Supplier balance position",
    description: "Ordered value, received value, invoiced amount, paid amount, advance balance and unreconciled difference, per currency.",
    view: "report_supplier_balance_position",
    currencyColumn: "currency_code",
    group: "suppliers",
    limitations:
      "The confirmed payable is blank until a supplier invoice is recorded, because procurement cannot state a debt Finance has not raised. No figure here is an accounting balance.",
    columns: [
      { key: "reference", label: "Reference" },
      { key: "legal_name", label: "Supplier" },
      { key: "currency_code", label: "Currency" },
      { key: "ordered_amount", label: "Ordered", kind: "money" },
      { key: "received_value", label: "Received value", kind: "money" },
      { key: "invoiced_amount", label: "Invoiced", kind: "money" },
      { key: "paid_amount", label: "Paid", kind: "money" },
      { key: "advance_balance", label: "Advance balance", kind: "money" },
      { key: "confirmed_payable", label: "Confirmed payable", kind: "money" },
      { key: "unreconciled_difference", label: "Unreconciled", kind: "money" },
    ],
  },
  {
    id: "approval-decisions",
    title: "Approval decisions",
    description: "Every procurement decision with the authority it was taken under and any segregation-of-duties rule involved.",
    view: "report_approval_decisions",
    dateColumn: "created_at",
    currencyColumn: "currency_code",
    group: "governance",
    limitations:
      "The authority shown is the one matched at the moment of the decision. A later change to the authority configuration does not restate it.",
    columns: [
      { key: "entity_type", label: "Document type" },
      { key: "entity_reference", label: "Reference" },
      { key: "decision", label: "Decision" },
      { key: "decided_by_name", label: "Decided by" },
      { key: "amount_at_decision", label: "Amount at decision", kind: "money" },
      { key: "currency_code", label: "Currency" },
      { key: "authority_transaction_type", label: "Authority" },
      { key: "authority_maximum", label: "Authority ceiling", kind: "money" },
      { key: "created_at", label: "Decided", kind: "datetime" },
      { key: "comment", label: "Comment" },
    ],
  },
  {
    id: "goods-receipt-inspections",
    title: "Goods receipt inspections",
    description: "Inspection findings recorded against deliveries.",
    view: "report_goods_receipt_inspections",
    dateColumn: "inspected_at",
    group: "receiving",
    limitations:
      "An inspection is evidence about a delivery; it does not change accepted, rejected or quarantined quantities. Those are set on the receipt line.",
    columns: [
      { key: "goods_receipt_reference", label: "Receipt" },
      { key: "receipt_date", label: "Received", kind: "date" },
      { key: "purchase_order_reference", label: "Order" },
      { key: "inspection_type", label: "Inspection" },
      { key: "result", label: "Result" },
      { key: "quantity_inspected", label: "Inspected qty", kind: "quantity" },
      { key: "findings", label: "Findings" },
      { key: "inspected_by_name", label: "Inspected by" },
      { key: "inspected_at", label: "Inspected", kind: "datetime" },
    ],
  },
  {
    id: "procurement-documents",
    title: "Procurement documents",
    description: "Document metadata attached to procurement transactions, with its storage state.",
    view: "report_procurement_documents",
    dateColumn: "uploaded_at",
    group: "governance",
    limitations:
      "`metadata_only` means the file itself is held outside the system: no storage bucket is configured, and this register does not claim otherwise.",
    columns: [
      { key: "entity_reference", label: "Document for" },
      { key: "document_type", label: "Type" },
      { key: "title", label: "Title" },
      { key: "file_name", label: "File" },
      { key: "mime_type", label: "Content type" },
      { key: "file_size_bytes", label: "Size (bytes)" },
      { key: "storage_state", label: "Storage" },
      { key: "uploaded_by_name", label: "Uploaded by" },
      { key: "uploaded_at", label: "Uploaded", kind: "datetime" },
    ],
  },
  {
    id: "purchase-order-versions",
    title: "Purchase order versions",
    description: "The immutable versions of each order, starting with the issued document.",
    view: "report_purchase_order_versions",
    dateColumn: "created_at",
    currencyColumn: "currency_code",
    group: "orders",
    limitations:
      "Version 1 is what the supplier was sent. Later versions exist only where an amendment was applied.",
    columns: [
      { key: "purchase_order_reference", label: "Order" },
      { key: "version", label: "Version" },
      { key: "status_at_snapshot", label: "Status" },
      { key: "total_amount", label: "Total", kind: "money" },
      { key: "currency_code", label: "Currency" },
      { key: "reason", label: "Reason" },
      { key: "created_at", label: "Snapshot taken", kind: "datetime" },
      { key: "created_by_name", label: "By" },
    ],
  },
  {
    id: "status-history",
    title: "Procurement status history",
    description: "The append-only status trail for every procurement document.",
    view: "report_procurement_status_history",
    dateColumn: "created_at",
    group: "governance",
    limitations: "Rows are never edited or deleted. A missing transition means it never happened.",
    columns: [
      { key: "entity_type", label: "Document type" },
      { key: "entity_reference", label: "Reference" },
      { key: "from_status", label: "From" },
      { key: "to_status", label: "To" },
      { key: "actor_name", label: "By" },
      { key: "reason", label: "Reason" },
      { key: "created_at", label: "When", kind: "datetime" },
    ],
  },
];

export type ReportFilters = {
  from?: string;
  to?: string;
  currency?: string;
  limit?: number;
};

export function getReportDefinition(id: string): ReportDefinition | undefined {
  return PROCUREMENT_REPORTS.find((report) => report.id === id);
}

/**
 * Runs one report.
 *
 * Date filtering is applied to the report's own date column, in the database, and the currency
 * filter is only offered where the report carries a currency — filtering a report that has no
 * currency by currency would silently return nothing.
 */
export async function runReport(id: string, filters: ReportFilters = {}) {
  await requirePermission("procurement.reports.view");
  const definition = getReportDefinition(id);
  if (!definition) throw new AppError("NOT_FOUND", "That report does not exist.");

  const supabase = await createSupabaseServerClient();
  let query = supabase.from(definition.view as never).select("*");

  if (definition.dateColumn && filters.from) {
    query = query.gte(definition.dateColumn, filters.from);
  }
  if (definition.dateColumn && filters.to) {
    query = query.lte(definition.dateColumn, filters.to);
  }
  if (definition.currencyColumn && filters.currency) {
    query = query.eq(definition.currencyColumn, filters.currency);
  }
  if (definition.dateColumn) {
    query = query.order(definition.dateColumn, { ascending: false });
  }

  const limit = Math.min(500, Math.max(10, filters.limit ?? 100));
  const { data, error } = await query.limit(limit);

  if (error) {
    throw new AppError("DATABASE_ERROR", `${definition.title} could not be produced. ${error.message}`);
  }

  return { definition, rows: (data ?? []) as unknown as Record<string, unknown>[] };
}

/** Data-quality indicators, shown beside the reports rather than inside them. */
export async function getProcurementDataQuality() {
  await requirePermission("procurement.reports.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("procurement_data_quality")
    .select("*")
    .order("severity", { ascending: false })
    .returns<{ entity_type: string; indicator: string; description: string; severity: string; record_count: number }[]>();

  if (error) throw new AppError("DATABASE_ERROR", `Data quality could not be loaded. ${error.message}`);
  return data ?? [];
}
