import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import { resolveCurrentPrincipal } from "@/services/auth/resolve-principal";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { AuditSeverity } from "@/types/database.types";

/**
 * Shared plumbing for the quality services.
 *
 * Three invariants live here so no quality service can forget them:
 *
 *  1. **No verdict is computed in TypeScript.** Conformance, the inspection summary and availability are decided by
 *     the database against the recorded limits. A service that calculated "this reading passes" would be a second
 *     implementation of the specification, and the two would drift.
 *  2. **Every write records an audit event** in the `quality` category, and the write fails closed if the audit
 *     cannot be recorded.
 *  3. **Measurements travel as strings.** NUMERIC columns are typed `number` by the generated types because that is
 *     what PostgREST returns, but a JavaScript number cannot hold every NUMERIC. Inputs are passed as JSON strings so
 *     PostgreSQL casts them exactly.
 */

export type QualityAuditAction =
  | "quality.parameter.created"
  | "quality.parameter.updated"
  | "quality.sampling_plan.created"
  | "quality.specification.created"
  | "quality.specification.updated"
  | "quality.specification.approved"
  | "quality.inspection.created"
  | "quality.inspection.submitted"
  | "quality.inspection.approved"
  | "quality.sample.collected"
  | "quality.result.recorded"
  | "quality.hold.placed"
  | "quality.hold.released"
  | "quality.disposition.recorded"
  | "quality.disposition.revoked"
  | "quality.ncr.raised"
  | "quality.ncr.updated"
  | "quality.ncr.closed"
  | "quality.capa.created"
  | "quality.capa.updated"
  | "quality.capa.verified"
  | "quality.certificate.issued"
  | "quality.certificate.voided";

export type QualityAuditInput = {
  action: QualityAuditAction;
  entityType: string;
  entityId: string | null;
  description: string;
  severity?: AuditSeverity;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export async function recordQualityAudit(input: QualityAuditInput, meta: RequestMeta = {}): Promise<void> {
  const resolution = await resolveCurrentPrincipal();
  const actor = resolution.status === "authenticated" ? resolution.principal.user.id : null;
  const actorEmployeeId =
    resolution.status === "authenticated" ? (resolution.principal.employee?.id ?? null) : null;

  await recordAuditEvent({
    actorUserId: actor,
    actorEmployeeId,
    action: input.action,
    eventCategory: "quality",
    severity: input.severity ?? "notice",
    module: "quality",
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
 * `undefined` rather than `null` for an empty value: an omitted column in an INSERT must stay omitted, and the
 * generated `Insert` types distinguish the two. RPC arguments coalesce `undefined` to the SQL default in the same way.
 */
export function numeric(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return String(value) as unknown as number;
}

export type RegisterPage<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/**
 * Calls a quality function and normalises its failure.
 *
 * The database functions refuse in plain language ("Inspection PA-QIN-2026-000007 cannot be submitted: no result
 * recorded for moisture"), so their sentence is the sentence a person sees. Anything else is passed through
 * `toAppError`, which keeps the code and details intact.
 */
export async function callQualityRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw qualityError(error);
  return data as T;
}

export function qualityError(error: { message: string; code?: string; details?: string | null }): AppError {
  const code = error.code ?? "";
  if (code === "42501" || /permission denied|requires permission/i.test(error.message)) {
    return new AppError("FORBIDDEN", error.message);
  }
  if (code === "23505" || /duplicate key/i.test(error.message)) {
    return new AppError("CONFLICT", error.message);
  }
  if (code === "P0002" || code === "PGRST116") {
    return new AppError("NOT_FOUND", error.message);
  }
  return new AppError("VALIDATION_ERROR", error.message);
}

export function pageOf<T>(rows: T[], page: number, pageSize: number, total: number): RegisterPage<T> {
  return { rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
