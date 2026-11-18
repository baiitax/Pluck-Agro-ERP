import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AuditSeverity } from "@/types/database.types";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import { resolveCurrentPrincipal } from "@/services/auth/resolve-principal";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { PermissionCode } from "@/lib/permissions/definitions";
import { requirePermission } from "@/services/authorization";

/**
 * Shared plumbing for the inventory and production services.
 *
 * Three invariants live here so no service can forget them:
 *
 *  1. **Quantity is never computed in TypeScript.** Balances, availability and in-transit quantities are
 *     read from the database views, which recompute them from posted movements on every read. There is no
 *     arithmetic on stock anywhere in this layer — a bug here must not be able to invent a quantity.
 *  2. **Every write records an audit event**, in the `inventory` or `production` category, and the write
 *     fails closed if the audit cannot be recorded.
 *  3. **Numeric values travel as strings.** NUMERIC columns are typed `number` in the generated types
 *     because that is what PostgREST returns, but a JavaScript number cannot hold every NUMERIC. Inputs are
 *     passed as JSON strings so PostgreSQL casts them exactly.
 */

export type InventoryAuditAction =
  | "inventory.lot.created"
  | "inventory.movement.posted"
  | "inventory.transfer.created"
  | "inventory.transfer.approved"
  | "inventory.transfer.dispatched"
  | "inventory.transfer.received"
  | "inventory.count.started"
  | "inventory.count.recorded"
  | "inventory.count.posted"
  | "inventory.adjustment.created"
  | "inventory.adjustment.posted"
  | "inventory.reservation.created"
  | "inventory.reservation.released"
  | "inventory.restriction.applied"
  | "inventory.restriction.released"
  | "inventory.receipt_handoff.consumed"
  | "production.plan.created"
  | "production.plan.submitted"
  | "production.plan.approved"
  | "production.plan.material_reserved"
  | "production.batch.started"
  | "production.batch.material_issued"
  | "production.batch.output_recorded"
  | "production.batch.closed"
  | "production.batch.logged"
  | "production.configuration.updated";

export type InventoryAuditInput = {
  action: InventoryAuditAction;
  entityType: string;
  entityId: string | null;
  description: string;
  severity?: AuditSeverity;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export async function recordInventoryAudit(
  input: InventoryAuditInput,
  meta: RequestMeta = {},
): Promise<void> {
  const resolution = await resolveCurrentPrincipal();
  const actor = resolution.status === "authenticated" ? resolution.principal.user.id : null;
  const actorEmployeeId =
    resolution.status === "authenticated" ? (resolution.principal.employee?.id ?? null) : null;

  const isProduction = input.action.startsWith("production.");

  await recordAuditEvent({
    actorUserId: actor,
    actorEmployeeId,
    action: input.action,
    eventCategory: isProduction ? "production" : "inventory",
    severity: input.severity ?? "notice",
    module: isProduction ? "production" : "inventory",
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

/** Sends a decimal to PostgreSQL without passing through a binary float. */
export function numeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value) as unknown as number;
}

/**
 * Calls an inventory/production function and normalises its failure.
 *
 * The database functions refuse in plain language ("Cannot issue 400 of lot X: only 300 is available"),
 * so their message is the message a person sees. Anything else is passed through `toAppError`, which
 * keeps the code and details intact.
 */
export async function callInventoryRpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw inventoryError(error);
  return data as T;
}

/**
 * Turns a database refusal into an AppError that keeps the database's own sentence.
 *
 * This is deliberate rather than lazy: the triggers and functions in this schema raise messages written
 * for a storekeeper ("Cannot reserve 40 in lot PA-LOT-2026-000123: only 30 is available"). Replacing them
 * with a generic "a business rule rejected this change" would throw away the only part of the error that
 * tells someone what to do next. The `code` still decides whether it reads as a permission problem or a
 * rule problem, so the interface can treat the two differently.
 */
export function inventoryError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "The inventory operation failed.";

  if (code === "42501" || code === "insufficient_privilege") {
    return new AppError("FORBIDDEN", message);
  }
  if (code === "23505" || code === "unique_violation") {
    return new AppError("CONFLICT", message);
  }
  if (code === "23514" || code === "23503" || code === "check_violation" || code === "foreign_key_violation") {
    return new AppError("VALIDATION_ERROR", message);
  }
  return new AppError("VALIDATION_ERROR", message);
}

export async function requireInventoryPermission(permission: PermissionCode): Promise<void> {
  await requirePermission(permission);
}

export type InventorySettings = {
  negativeStockAllowed: boolean;
  lotTrackingRequired: boolean;
  receivedStockRequiresInspection: boolean;
  stockCountRequiresApproval: boolean;
  adjustmentRequiresApproval: boolean;
  reservationExpiryDays: number | null;
  productionIssueRequiresStock: boolean;
  productionOutputRequiresInspection: boolean;
};

/**
 * Reads the configurable inventory policy.
 *
 * The fallbacks below are the conservative reading and only apply when a row is missing: no negative
 * stock, approvals required, inspection required. They are not the control — the database functions read
 * the same rows and refuse independently of whatever the interface believes.
 */
export async function getInventorySettings(): Promise<InventorySettings> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("inventory_settings")
    .select("key, value_text, value_numeric, value_boolean")
    .returns<
      { key: string; value_text: string | null; value_numeric: number | null; value_boolean: boolean | null }[]
    >();

  const rows = new Map((data ?? []).map((row) => [row.key, row]));
  const bool = (key: string, fallback: boolean) => rows.get(key)?.value_boolean ?? fallback;
  const num = (key: string): number | null => {
    const value = rows.get(key)?.value_numeric;
    return value === null || value === undefined ? null : Number(value);
  };

  return {
    negativeStockAllowed: bool("negative_stock_allowed", false),
    lotTrackingRequired: bool("lot_tracking_required", true),
    receivedStockRequiresInspection: bool("received_stock_requires_inspection", true),
    stockCountRequiresApproval: bool("stock_count_requires_approval", true),
    adjustmentRequiresApproval: bool("adjustment_requires_approval", true),
    reservationExpiryDays: num("reservation_expiry_days"),
    productionIssueRequiresStock: bool("production_issue_requires_stock", true),
    productionOutputRequiresInspection: bool("production_output_requires_inspection", true),
  };
}

/**
 * Advisory reference preview for a form.
 *
 * The real number is assigned inside the insert by the database, and the two can differ if somebody else
 * saves first. The form says "assigned on save" when the preview cannot be read rather than showing a
 * number that may not be the one used.
 */
export async function peekInventoryReference(entity: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("inventory_numbering")
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

/** Pagination for the register pages, which are all ordered by a timestamp descending. */
export type RegisterPage<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
