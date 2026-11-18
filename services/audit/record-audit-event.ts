import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AuditCategory, AuditSeverity, Json } from "@/types/database.types";

export type AuditEventInput = {
  actorUserId: string | null;
  /** Employee attribution, resolved server-side from the caller's profile. */
  actorEmployeeId?: string | null;
  action: string;
  eventCategory: AuditCategory;
  severity?: AuditSeverity;
  module: string;
  entityType?: string | null;
  entityId?: string | null;
  description?: string | null;
  oldValues?: Json | null;
  newValues?: Json | null;
  metadata?: Json | null;
  /** Correlation id so every write belonging to one request can be grouped. */
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

const SENSITIVE_KEY = /(password|passcode|token|secret|credential|authorization|api[_-]?key|service_role|salt|hash)/i;

/**
 * Recursively removes secrets from a payload before it is persisted.
 *
 * The database has a matching `private.redact_audit_payload()` helper for anything written by
 * SQL, but the application must not rely on it: an audit row containing a token is already a
 * breach. Passwords, tokens and session material are never accepted as input here in the first
 * place, and this is the belt-and-braces second line of defence.
 */
export function redactPayload(value: Json | null | undefined, depth = 0): Json | null {
  if (value === null || value === undefined) return null;
  if (depth > 6) return "«truncated»";
  if (Array.isArray(value)) return value.map((item) => redactPayload(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, Json> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key) ? "«redacted»" : redactPayload(entry as Json, depth + 1);
    }
    return output;
  }
  return value;
}

/**
 * Writes a trusted audit event.
 *
 * Called from server-side services AFTER authorization has been verified. Metadata is built
 * from server-side knowledge only — never from arbitrary browser payloads.
 */
export async function recordAuditEvent(event: AuditEventInput): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { error } = await admin.from("audit_logs").insert({
    actor_user_id: event.actorUserId,
    actor_employee_id: event.actorEmployeeId ?? null,
    action: event.action,
    event_category: event.eventCategory,
    severity: event.severity ?? "info",
    module: event.module,
    entity_type: event.entityType ?? null,
    entity_id: event.entityId ?? null,
    description: event.description ?? null,
    old_values: redactPayload(event.oldValues),
    new_values: redactPayload(event.newValues),
    metadata: redactPayload(event.metadata),
    request_id: event.requestId ?? null,
    ip_address: event.ipAddress ?? null,
    user_agent: event.userAgent ?? null,
  });

  if (error) {
    // Audit failure must never silently pass. Surface it so the caller can fail closed.
    console.error("[pluck-erp] audit write failed", error.message);
    throw new Error("Audit logging failed; the operation was not recorded.");
  }
}
