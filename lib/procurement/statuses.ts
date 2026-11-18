/**
 * Procurement lifecycle vocabulary.
 *
 * The *policy* — which move is legal, who may make it, whether a reason is required — lives in the
 * database (`procurement_status_transitions`). This module only holds what the interface needs to
 * render a status honestly: the ordered list, a human label and a tone.
 *
 * Keeping the lists here means the badge colours, the filters and the tests all read one source,
 * and a status added to a migration without being added here fails a unit test rather than
 * appearing as a raw snake_case string in production.
 */
import type { BadgeTone } from "@/components/ui/badge";

export const REQUISITION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "cancelled",
  "processing",
  "partially_fulfilled",
  "fulfilled",
] as const;

export const QUOTATION_STATUSES = [
  "draft",
  "received",
  "under_evaluation",
  "selected",
  "not_selected",
  "expired",
  "withdrawn",
  "rejected",
] as const;

export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "issued",
  "partially_received",
  "fully_received",
  "amendment_pending",
  "closed",
  "cancelled",
] as const;

export const GOODS_RECEIPT_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "returned",
  "posted",
  "cancelled",
] as const;

export const SUPPLIER_ADVANCE_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "payment_pending",
  "paid",
  "partially_applied",
  "fully_applied",
  "cancelled",
] as const;

/** Statuses after which no content may change. Used to decide whether a form is offered. */
export const REQUISITION_EDITABLE_STATUSES = ["draft", "rejected"] as const;
export const QUOTATION_EDITABLE_STATUSES = ["draft", "received", "under_evaluation"] as const;
export const PURCHASE_ORDER_EDITABLE_STATUSES = ["draft", "rejected"] as const;
export const GOODS_RECEIPT_EDITABLE_STATUSES = ["draft", "returned", "rejected"] as const;

const LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  processing: "Processing",
  partially_fulfilled: "Partially fulfilled",
  fulfilled: "Fulfilled",
  received: "Received",
  under_evaluation: "Under evaluation",
  selected: "Selected",
  not_selected: "Not selected",
  expired: "Expired",
  withdrawn: "Withdrawn",
  issued: "Issued",
  partially_received: "Partially received",
  fully_received: "Fully received",
  amendment_pending: "Amendment pending",
  closed: "Closed",
  returned: "Returned for correction",
  posted: "Posted",
  payment_pending: "Payment pending",
  paid: "Paid",
  partially_applied: "Partially applied",
  fully_applied: "Fully applied",
  // Receipt inspection outcomes
  pending: "Pending",
  passed: "Passed",
  failed: "Failed",
  partial: "Partial",
  not_required: "Not required",
  // Priorities and severities
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
  info: "Info",
  notice: "Notice",
  warning: "Warning",
  critical: "Critical",
  // Conditions
  unverified: "Unverified",
  verified: "Verified",
  active: "Active",
  inactive: "Inactive",
  blocked: "Blocked",
  archived: "Archived",
};

export function labelForStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return LABELS[status] ?? status.replace(/_/g, " ");
}

export function procurementStatusTone(status: string): BadgeTone {
  switch (status) {
    case "approved":
    case "issued":
    case "selected":
    case "paid":
    case "fully_applied":
    case "posted":
    case "fulfilled":
    case "fully_received":
    case "verified":
    case "active":
    case "passed":
      return "success";
    case "submitted":
    case "under_review":
    case "under_evaluation":
    case "processing":
    case "partially_received":
    case "partially_fulfilled":
    case "partially_applied":
    case "payment_pending":
    case "amendment_pending":
    case "received":
    case "pending":
    case "info":
      return "info";
    case "returned":
    case "warning":
    case "partial":
    case "notice":
    case "high":
      return "warning";
    case "rejected":
    case "cancelled":
    case "blocked":
    case "expired":
    case "withdrawn":
    case "failed":
    case "critical":
    case "urgent":
      return "danger";
    default:
      return "neutral";
  }
}

export function isEditable(status: string, editable: readonly string[]): boolean {
  return editable.includes(status);
}
