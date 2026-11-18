import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { highestLimit } from "@/lib/governance/authority";
import { validateDelegation, wouldCreateDelegationCycle, type ValidationIssue } from "@/lib/governance/delegation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  delegationCreateSchema,
  delegationDecisionSchema,
  delegationRevokeSchema,
} from "@/lib/validation/schemas";
import { requirePermission } from "@/services/authorization";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { ApprovalDelegation } from "@/types/database.types";

export type DelegationWithPeople = ApprovalDelegation & {
  delegator: { id: string; employee_number: string; first_name: string; last_name: string } | null;
  delegate: { id: string; employee_number: string; first_name: string; last_name: string } | null;
  department: { id: string; name: string } | null;
};

const SELECT =
  "*, delegator:employees!approval_delegations_delegator_employee_id_fkey(id, employee_number, first_name, last_name), delegate:employees!approval_delegations_delegate_employee_id_fkey(id, employee_number, first_name, last_name), department:departments!approval_delegations_department_id_fkey(id, name)";

export async function getDelegations(): Promise<DelegationWithPeople[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("approval_delegations")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .returns<DelegationWithPeople[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

function assertNoIssues(issues: ValidationIssue[]): void {
  if (issues.length === 0) return;
  throw new AppError("VALIDATION_ERROR", issues.map((issue) => issue.message).join(" "), {
    details: Object.fromEntries(issues.map((issue) => [issue.field, [issue.message]])),
  });
}

/**
 * Creates a delegation request.
 *
 * Hard rules (mirrored in the database):
 *  - a person cannot delegate to themselves;
 *  - the delegated limit cannot exceed the delegator's own configured authority;
 *  - the window must be valid;
 *  - delegations cannot form a cycle.
 *
 * A new delegation starts as `pending_approval`; it grants nothing until approved.
 */
export async function createDelegation(
  input: unknown,
  meta: RequestMeta = {},
): Promise<ApprovalDelegation> {
  const actor = await requirePermission("governance.delegations.configure");
  const payload = delegationCreateSchema.parse(input);
  const supabase = await createSupabaseServerClient();

  const { data: delegatorAuthorities, error: authorityError } = await supabase
    .from("approval_authorities")
    .select("*")
    .eq("employee_id", payload.delegatorEmployeeId)
    .eq("module", payload.module.trim().toLowerCase())
    .eq("transaction_type", payload.transactionType.trim())
    .eq("currency_code", payload.currencyCode)
    .returns<{ maximum_amount: number; is_active: boolean; effective_from: string; effective_until: string | null }[]>();
  if (authorityError) throw new Error(authorityError.message);

  const delegatorMaxLimit = highestLimit(delegatorAuthorities ?? []);

  assertNoIssues(
    validateDelegation({
      delegatorEmployeeId: payload.delegatorEmployeeId,
      delegateEmployeeId: payload.delegateEmployeeId,
      effectiveFrom: payload.effectiveFrom,
      effectiveUntil: payload.effectiveUntil,
      delegatedLimit: payload.delegatedLimit,
      delegatorMaxLimit,
    }),
  );

  const { data: live, error: liveError } = await supabase
    .from("approval_delegations")
    .select("delegator_employee_id, delegate_employee_id, status")
    .eq("status", "approved")
    .returns<{ delegator_employee_id: string; delegate_employee_id: string; status: "approved" }[]>();
  if (liveError) throw new Error(liveError.message);

  if (wouldCreateDelegationCycle(
    { delegatorEmployeeId: payload.delegatorEmployeeId, delegateEmployeeId: payload.delegateEmployeeId },
    live ?? [],
  )) {
    throw new AppError(
      "CONFLICT",
      "This delegation would create a loop (the proposed delegate already delegates back to the delegator).",
    );
  }

  const { data, error } = await supabase
    .from("approval_delegations")
    .insert({
      delegator_employee_id: payload.delegatorEmployeeId,
      delegate_employee_id: payload.delegateEmployeeId,
      module: payload.module.trim().toLowerCase(),
      transaction_type: payload.transactionType.trim(),
      department_id: payload.departmentId || null,
      currency_code: payload.currencyCode,
      delegated_limit: payload.delegatedLimit,
      effective_from: payload.effectiveFrom,
      effective_until: payload.effectiveUntil,
      reason: payload.reason,
      status: "pending_approval",
      created_by: actor.user.id,
    })
    .select("*")
    .single<ApprovalDelegation>();

  if (error) {
    if (error.code === "23505") {
      throw new AppError("CONFLICT", "An active delegation already exists for this delegate, module and currency.");
    }
    if (error.code === "23514") {
      throw new AppError("VALIDATION_ERROR", "The database rejected this delegation. Check the limit and dates.");
    }
    throw new Error(error.message);
  }

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "delegation.created",
    eventCategory: "governance",
    severity: "warning",
    module: "governance",
    entityType: "approval_delegation",
    entityId: data.id,
    description: `Created a delegation request (${data.module}/${data.transaction_type}) up to ${data.currency_code} ${data.delegated_limit}.`,
    newValues: {
      delegator_employee_id: data.delegator_employee_id,
      delegate_employee_id: data.delegate_employee_id,
      delegated_limit: data.delegated_limit,
      effective_from: data.effective_from,
      effective_until: data.effective_until,
      status: data.status,
    },
    metadata: { reason: payload.reason, delegator_max_limit: delegatorMaxLimit },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/governance/delegations");
  return data;
}

export async function decideDelegation(
  input: unknown,
  meta: RequestMeta = {},
): Promise<ApprovalDelegation> {
  const actor = await requirePermission("governance.delegations.approve");
  const payload = delegationDecisionSchema.parse(input);
  const supabase = await createSupabaseServerClient();

  const { data: existing, error: readError } = await supabase
    .from("approval_delegations")
    .select("*")
    .eq("id", payload.id)
    .maybeSingle<ApprovalDelegation>();
  if (readError) throw new Error(readError.message);
  if (!existing) throw new AppError("NOT_FOUND", "That delegation does not exist.");
  if (existing.status !== "pending_approval") {
    throw new AppError("CONFLICT", `Only pending delegations can be decided; this one is ${existing.status}.`);
  }
  if (existing.created_by === actor.user.id) {
    throw new AppError("FORBIDDEN", "You cannot approve a delegation you created yourself.");
  }

  const { data, error } = await supabase
    .from("approval_delegations")
    .update({
      status: payload.decision,
      approved_by: payload.decision === "approved" ? actor.user.id : null,
      approved_at: new Date().toISOString(),
      revocation_reason: payload.decision === "rejected" ? payload.reason : null,
    })
    .eq("id", payload.id)
    .select("*")
    .single<ApprovalDelegation>();
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: `delegation.${payload.decision}`,
    eventCategory: "governance",
    severity: payload.decision === "approved" ? "warning" : "notice",
    module: "governance",
    entityType: "approval_delegation",
    entityId: data.id,
    description: `${payload.decision === "approved" ? "Approved" : "Rejected"} delegation for ${existing.module}/${existing.transaction_type}. Reason: ${payload.reason}`,
    oldValues: { status: existing.status },
    newValues: { status: data.status },
    metadata: { reason: payload.reason },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/governance/delegations");
  return data;
}

export async function revokeDelegation(
  input: unknown,
  meta: RequestMeta = {},
): Promise<ApprovalDelegation> {
  const actor = await requirePermission("governance.delegations.revoke");
  const payload = delegationRevokeSchema.parse(input);
  const supabase = await createSupabaseServerClient();

  const { data: existing, error: readError } = await supabase
    .from("approval_delegations")
    .select("*")
    .eq("id", payload.id)
    .maybeSingle<ApprovalDelegation>();
  if (readError) throw new Error(readError.message);
  if (!existing) throw new AppError("NOT_FOUND", "That delegation does not exist.");
  if (existing.status !== "approved" && existing.status !== "pending_approval") {
    throw new AppError("CONFLICT", `A ${existing.status} delegation cannot be revoked.`);
  }

  const { data, error } = await supabase
    .from("approval_delegations")
    .update({
      status: "revoked",
      revoked_by: actor.user.id,
      revoked_at: new Date().toISOString(),
      revocation_reason: payload.reason,
    })
    .eq("id", payload.id)
    .select("*")
    .single<ApprovalDelegation>();
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "delegation.revoked",
    eventCategory: "governance",
    severity: "warning",
    module: "governance",
    entityType: "approval_delegation",
    entityId: data.id,
    description: `Revoked delegation for ${existing.module}/${existing.transaction_type}. Reason: ${payload.reason}`,
    oldValues: { status: existing.status },
    newValues: { status: data.status },
    metadata: { reason: payload.reason },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/governance/delegations");
  return data;
}
