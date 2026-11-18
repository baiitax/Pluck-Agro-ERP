import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { evaluateSod, type SodOverrideLike, type SodRuleLike } from "@/lib/governance/sod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sodOverrideSchema, sodRuleCreateSchema, sodRuleUpdateSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/services/authorization";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { SodOverride, SodRule } from "@/types/database.types";

export async function getSodRules(): Promise<SodRule[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("segregation_of_duties_rules")
    .select("*")
    .order("module", { ascending: true })
    .order("name", { ascending: true })
    .returns<SodRule[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type SodOverrideWithNames = SodOverride & {
  rule: { id: string; name: string; code: string } | null;
  employee: { id: string; employee_number: string; first_name: string; last_name: string } | null;
};

export async function getSodOverrides(): Promise<SodOverrideWithNames[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sod_overrides")
    .select(
      "*, rule:segregation_of_duties_rules(id, name, code), employee:employees(id, employee_number, first_name, last_name)",
    )
    .order("granted_at", { ascending: false })
    .returns<SodOverrideWithNames[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createSodRule(input: unknown, meta: RequestMeta = {}): Promise<SodRule> {
  const actor = await requirePermission("governance.sod.configure");
  const payload = sodRuleCreateSchema.parse(input);

  if (payload.firstAction === payload.conflictingAction) {
    throw new AppError("VALIDATION_ERROR", "The two conflicting actions must be different.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("segregation_of_duties_rules")
    .insert({
      name: payload.name.trim(),
      code: payload.code,
      module: payload.module.trim().toLowerCase(),
      transaction_type: payload.transactionType.trim(),
      first_action: payload.firstAction.trim().toLowerCase(),
      conflicting_action: payload.conflictingAction.trim().toLowerCase(),
      enforcement_level: payload.enforcementLevel,
      description: payload.description?.trim() || null,
      is_active: true,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("*")
    .single<SodRule>();

  if (error) {
    if (error.code === "23505") throw new AppError("CONFLICT", "A rule with that code already exists.");
    if (error.code === "23514") {
      throw new AppError("VALIDATION_ERROR", "The database rejected this rule. Check the code and action formats.");
    }
    throw new Error(error.message);
  }

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "sod.rule_created",
    eventCategory: "governance",
    severity: "warning",
    module: "governance",
    entityType: "segregation_of_duties_rule",
    entityId: data.id,
    description: `Created segregation-of-duties rule ${data.code} (${data.enforcement_level}).`,
    newValues: {
      name: data.name,
      code: data.code,
      module: data.module,
      first_action: data.first_action,
      conflicting_action: data.conflicting_action,
      enforcement_level: data.enforcement_level,
    },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/governance/sod");
  return data;
}

export async function updateSodRule(input: unknown, meta: RequestMeta = {}): Promise<SodRule> {
  const actor = await requirePermission("governance.sod.configure");
  const payload = sodRuleUpdateSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: readError } = await supabase
    .from("segregation_of_duties_rules")
    .select("*")
    .eq("id", payload.id)
    .maybeSingle<SodRule>();
  if (readError) throw new Error(readError.message);
  if (!existing) throw new AppError("NOT_FOUND", "That rule does not exist.");

  const { data, error } = await supabase
    .from("segregation_of_duties_rules")
    .update({
      name: payload.name.trim(),
      module: payload.module.trim().toLowerCase(),
      transaction_type: payload.transactionType.trim(),
      first_action: payload.firstAction.trim().toLowerCase(),
      conflicting_action: payload.conflictingAction.trim().toLowerCase(),
      enforcement_level: payload.enforcementLevel,
      description: payload.description?.trim() || null,
      is_active: payload.isActive,
      updated_by: actor.user.id,
    })
    .eq("id", payload.id)
    .select("*")
    .single<SodRule>();
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "sod.rule_updated",
    eventCategory: "governance",
    severity: "warning",
    module: "governance",
    entityType: "segregation_of_duties_rule",
    entityId: data.id,
    description: `Updated segregation-of-duties rule ${data.code}.`,
    oldValues: {
      enforcement_level: existing.enforcement_level,
      is_active: existing.is_active,
      first_action: existing.first_action,
      conflicting_action: existing.conflicting_action,
    },
    newValues: {
      enforcement_level: data.enforcement_level,
      is_active: data.is_active,
      first_action: data.first_action,
      conflicting_action: data.conflicting_action,
    },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/governance/sod");
  return data;
}

export async function grantSodOverride(input: unknown, meta: RequestMeta = {}): Promise<SodOverride> {
  const actor = await requirePermission("governance.sod.configure");
  const payload = sodOverrideSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sod_overrides")
    .insert({
      rule_id: payload.ruleId,
      employee_id: payload.employeeId,
      justification: payload.justification,
      expires_at: payload.expiresAt ? `${payload.expiresAt}T23:59:59Z` : null,
      granted_by: actor.user.id,
    })
    .select("*")
    .single<SodOverride>();
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "sod.override_granted",
    eventCategory: "governance",
    severity: "critical",
    module: "governance",
    entityType: "sod_override",
    entityId: data.id,
    description: `Granted a segregation-of-duties override. Justification: ${payload.justification}`,
    newValues: { rule_id: payload.ruleId, employee_id: payload.employeeId, expires_at: data.expires_at },
    metadata: { justification: payload.justification },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/governance/sod");
  return data;
}

/**
 * Evaluates the rules for a set of held actions. Used by the UI preview and available to future
 * workflow services; Phase 1 does not run any approval workflow.
 */
export async function previewSodForActions(actions: string[], employeeId: string) {
  await requirePermission("governance.sod.view");
  const [rules, overrides] = await Promise.all([getSodRules(), getSodOverrides()]);
  return evaluateSod(
    rules as unknown as SodRuleLike[],
    actions,
    employeeId,
    overrides as unknown as SodOverrideLike[],
  );
}
