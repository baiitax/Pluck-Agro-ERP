import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAuditEvent } from "@/services/audit/record-audit-event";

/**
 * Runs after a successful credential exchange.
 *
 * Records last_login_at on the profile through the privileged client because the profile
 * table intentionally has no self-update policy for auth columns, and records the audit event.
 * Failures here must not block a legitimate login.
 */
export async function completeLogin(params: {
  userId: string;
  email: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", params.userId);

    await recordAuditEvent({
      actorUserId: params.userId,
      action: "auth.login_succeeded",
      eventCategory: "authentication",
      severity: "info",
      module: "auth",
      entityType: "profile",
      entityId: params.userId,
      description: `Successful sign-in for ${params.email}.`,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });
  } catch (error) {
    console.error("[pluck-erp] post-login bookkeeping failed", error);
  }
}

export async function recordFailedLogin(params: {
  email: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await recordAuditEvent({
      actorUserId: null,
      action: "auth.login_failed",
      eventCategory: "authentication",
      severity: "warning",
      module: "auth",
      description: `Failed sign-in attempt for ${params.email}.`,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });
  } catch (error) {
    console.error("[pluck-erp] failed-login audit write failed", error);
  }
}
