import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import { resolveCurrentPrincipal } from "@/services/auth/resolve-principal";
import type { AuditSeverity } from "@/types/database.types";
import type { RequestMeta } from "@/services/employees/manage-employee";

/**
 * Shared plumbing for every master-data service.
 *
 * Two invariants live here so no individual service can forget them:
 *  1. A write always records an audit event in the `master_data` category, with a stable
 *     `master_data.*` action name, and fails closed if the audit write fails.
 *  2. A failed database constraint is translated into a message a human can act on, instead of
 *     surfacing a raw PostgreSQL error.
 */

export type MasterAuditInput = {
  action: MasterAuditAction;
  entityType: string;
  entityId: string | null;
  description: string;
  severity?: AuditSeverity;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type MasterAuditAction =
  | "master_data.created"
  | "master_data.updated"
  | "master_data.activated"
  | "master_data.deactivated"
  | "master_data.blocked"
  | "master_data.unblocked"
  | "master_data.archived"
  | "master_data.verified"
  | "master_data.merged"
  | "master_data.banking_changed"
  | "master_data.credit_changed"
  | "master_data.duplicate_resolved"
  | "master_data.import_staged"
  | "master_data.import_executed"
  | "master_data.conversion_changed"
  | "master_data.exchange_rate_changed";

const STATUS_ACTIONS: Record<string, MasterAuditAction> = {
  active: "master_data.activated",
  inactive: "master_data.deactivated",
  blocked: "master_data.blocked",
  archived: "master_data.archived",
  discontinued: "master_data.deactivated",
  verified: "master_data.verified",
};

const CRITICAL_STATUSES = new Set(["blocked", "archived"]);

export function auditActionForStatus(status: string): MasterAuditAction {
  return STATUS_ACTIONS[status] ?? "master_data.updated";
}

export function severityForStatus(status: string): AuditSeverity {
  return CRITICAL_STATUSES.has(status) ? "critical" : "notice";
}

/** Writes a master-data audit event for the current actor. Throws if the audit write fails. */
export async function recordMasterAudit(
  input: MasterAuditInput,
  meta: RequestMeta = {},
): Promise<void> {
  // Attribution only — the permission for the operation was already enforced by the caller, and
  // auditing must never fail because of an unrelated check.
  const resolution = await resolveCurrentPrincipal();
  const actor = resolution.status === "authenticated" ? resolution.principal.user.id : null;
  const actorEmployeeId = resolution.status === "authenticated" ? (resolution.principal.employee?.id ?? null) : null;

  await recordAuditEvent({
    actorUserId: actor,
    actorEmployeeId,
    action: input.action,
    eventCategory: "master_data",
    severity: input.severity ?? "notice",
    module: "master_data",
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
 * Turns a database error into a message the person in front of the screen can act on.
 * Constraint and trigger messages in this schema are written for humans on purpose; this function
 * passes them through rather than flattening everything into "Something went wrong".
 */
export function translateDatabaseError(error: { code?: string; message: string }, entityLabel: string): AppError {
  if (error.code === "23505" || error.code === "unique_violation") {
    return new AppError("CONFLICT", `That ${entityLabel} already exists. Check the code or reference and try again.`);
  }
  if (error.code === "23503" || error.code === "foreign_key_violation") {
    return new AppError("VALIDATION_ERROR", "A selected record no longer exists. Refresh the page and try again.");
  }
  if (error.code === "23514" || error.code === "check_violation") {
    return new AppError("VALIDATION_ERROR", humaniseConstraintMessage(error.message));
  }
  if (error.code === "42501" || error.code === "insufficient_privilege") {
    return new AppError("FORBIDDEN", humaniseConstraintMessage(error.message));
  }
  return new AppError("DATABASE_ERROR", `${entityLabel} could not be saved. ${error.message}`);
}

function humaniseConstraintMessage(message: string): string {
  // PostgreSQL prefix noise removed; the trigger messages themselves are already user-facing.
  return message
    .replace(/^new row for relation "[^"]+" violates check constraint "[^"]+"\s*/i, "")
    .replace(/^ERROR:\s*/i, "")
    .trim();
}

/** Returns the next business reference without consuming it (for form previews). */
export async function peekNextReference(entity: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("master_data_entities")
    .select("prefix, padding, last_value")
    .eq("entity", entity)
    .maybeSingle<{ prefix: string; padding: number; last_value: number }>();
  if (error || !data) return "Assigned on save";
  return `${data.prefix}-${String(data.last_value + 1).padStart(data.padding, "0")}`;
}

/**
 * Sends a decimal to PostgreSQL without passing through a binary float.
 *
 * NUMERIC columns are typed `number` in `types/database.types.ts` because that is what the
 * generated Supabase types do, but a JavaScript number cannot represent every NUMERIC value:
 * 0.45359237 is fine, 1234567890.123456789 is not. PostgREST accepts a JSON string for a numeric
 * column and PostgreSQL casts it exactly, so the value is passed as text and the type is narrowed
 * here, once, instead of scattering `as never` through the services.
 */
export function numeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value) as unknown as number;
}
