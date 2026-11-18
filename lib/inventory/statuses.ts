/**
 * Inventory and production vocabulary for the interface.
 *
 * The rules — which status may move to which, who may move it, whether a reason is required — live in
 * the database (`inventory_status_transitions`, seeded by 0058). This module holds only what a page
 * needs in order to render a status honestly: a label, a tone, and the ordered lists used by filters.
 *
 * A unit test asserts these lists match the migrations, so a status added to SQL without being added
 * here fails the build rather than appearing as raw snake_case in front of a storekeeper.
 */
import type { BadgeTone } from "@/components/ui/badge";

export const INVENTORY_LOT_STATUSES = ["open", "depleted", "closed"] as const;

export const TRANSFER_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "dispatched",
  "received",
  "cancelled",
] as const;

export const STOCK_COUNT_STATUSES = [
  "draft",
  "counting",
  "counted",
  "submitted",
  "approved",
  "rejected",
  "posted",
  "cancelled",
] as const;

export const STOCK_ADJUSTMENT_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "posted",
  "cancelled",
] as const;

export const RESERVATION_STATUSES = ["active", "partially_released", "released", "expired", "cancelled"] as const;

export const RESTRICTION_STATUSES = ["active", "partially_released", "released", "cancelled"] as const;

export const RESTRICTION_TYPES = ["hold", "quarantine", "recall", "count_freeze", "pending_inspection"] as const;

export const MOVEMENT_TYPES = [
  "receipt_in",
  "return_to_supplier",
  "issue_to_production",
  "production_output",
  "by_product_output",
  "waste_output",
  "transfer_out",
  "transfer_in",
  "adjustment_in",
  "adjustment_out",
  "count_gain",
  "count_loss",
  "reversal",
  "opening_balance",
  "customer_return",
  "disposal",
  "rework_in",
  "rework_out",
] as const;

export const PLAN_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export const BATCH_STATUSES = ["draft", "in_progress", "completed", "closed", "aborted", "cancelled"] as const;

const LABELS: Record<string, string> = {
  // lots and documents
  open: "Open",
  depleted: "Depleted",
  closed: "Closed",
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  dispatched: "Dispatched",
  partially_received: "Partly received",
  received: "Received",
  counting: "Counting",
  counted: "Counted",
  posted: "Posted",
  in_progress: "In progress",
  completed: "Completed",
  aborted: "Aborted",
  active: "Active",
  partially_released: "Partly released",
  released: "Released",
  expired: "Expired",
  // restriction types
  hold: "Hold",
  quarantine: "Quarantine",
  recall: "Recall",
  count_freeze: "Count freeze",
  pending_inspection: "Pending inspection",
  // movement types
  receipt_in: "Receipt in",
  return_to_supplier: "Return to supplier",
  issue_to_production: "Issue to production",
  production_output: "Production output",
  by_product_output: "By-product output",
  waste_output: "Waste output",
  transfer_out: "Transfer out",
  transfer_in: "Transfer in",
  adjustment_in: "Adjustment in",
  adjustment_out: "Adjustment out",
  count_gain: "Count gain",
  count_loss: "Count loss",
  reversal: "Reversal",
  opening_balance: "Opening balance",
  customer_return: "Customer return",
  disposal: "Disposal",
  rework_in: "Rework in",
  rework_out: "Rework out",
};

const TONES: Record<string, BadgeTone> = {
  draft: "neutral",
  submitted: "info",
  counting: "info",
  counted: "info",
  in_progress: "info",
  active: "info",
  approved: "success",
  received: "success",
  posted: "success",
  completed: "success",
  released: "success",
  open: "success",
  dispatched: "warning",
  partially_received: "warning",
  partially_released: "warning",
  pending_inspection: "warning",
  hold: "warning",
  quarantine: "danger",
  rejected: "danger",
  aborted: "danger",
  recall: "danger",
  count_freeze: "warning",
  depleted: "neutral",
  expired: "neutral",
  cancelled: "neutral",
  closed: "neutral",
};

export function labelForInventoryStatus(status: string | null | undefined): string {
  if (!status) return "—";
  return LABELS[status] ?? status.replace(/_/g, " ");
}

export function inventoryStatusTone(status: string | null | undefined): BadgeTone {
  if (!status) return "neutral";
  return TONES[status] ?? "neutral";
}

/** Signed display for a directional movement, so a reader never has to remember which way it went. */
export function formatMovementQuantity(direction: string, quantity: number | string): string {
  const value = typeof quantity === "string" ? quantity : String(quantity);
  return direction === "out" ? `−${value}` : `+${value}`;
}
