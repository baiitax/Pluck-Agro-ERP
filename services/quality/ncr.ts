import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { Database } from "@/types/database.types";
import {
  callQualityRpc,
  pageOf,
  qualityError,
  recordQualityAudit,
  type RegisterPage,
} from "@/services/quality/shared";

type NcrRow = Database["public"]["Tables"]["quality_ncrs"]["Row"];
type NcrRegisterRow = Database["public"]["Views"]["quality_ncr_register"]["Row"];
type CapaRow = Database["public"]["Tables"]["quality_capa_actions"]["Row"];
type CapaRegisterRow = Database["public"]["Views"]["quality_capa_register"]["Row"];

/**
 * Non-conformances and corrective/preventive actions.
 *
 * The distinction this module keeps intact: a disposition decides what happens to the *stock*, an NCR decides what
 * happens to the *process*. They are linked where they should be and separate where they must be, so closing an NCR
 * never implies the material was dealt with — and rejecting material never implies the cause was found.
 */

export async function listNcrs(
  filters: { status?: string; severity?: string; page?: number } = {},
): Promise<RegisterPage<NcrRegisterRow>> {
  await requirePermission("quality.ncr.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;

  let query = supabase
    .from("quality_ncr_register")
    .select("*", { count: "exact" })
    .order("detected_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.severity) query = query.eq("severity", filters.severity);

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Non-conformances could not be loaded. ${error.message}`);

  return pageOf(data ?? [], page, pageSize, count ?? 0);
}

export async function getNcr(ncrId: string): Promise<{
  ncr: NcrRegisterRow;
  actions: CapaRegisterRow[];
}> {
  await requirePermission("quality.ncr.view");
  const supabase = await createSupabaseServerClient();

  const { data: ncr, error } = await supabase
    .from("quality_ncr_register")
    .select("*")
    .eq("id", ncrId)
    .maybeSingle<NcrRegisterRow>();
  if (error) throw new AppError("DATABASE_ERROR", `That non-conformance could not be loaded. ${error.message}`);
  if (!ncr) throw new AppError("NOT_FOUND", "That non-conformance does not exist, or you cannot see it.");

  const { data: actions } = await supabase
    .from("quality_capa_register")
    .select("*")
    .eq("ncr_id", ncrId)
    .order("created_at", { ascending: false })
    .returns<CapaRegisterRow[]>();

  return { ncr, actions: actions ?? [] };
}

export async function createNcr(
  input: {
    title: string;
    description: string;
    severity: string;
    source: string;
    inspectionId?: string;
    lotId?: string;
    supplierId?: string;
    containmentAction?: string;
  },
  meta: RequestMeta = {},
): Promise<NcrRow> {
  await requirePermission("quality.ncr.create");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("quality_ncrs")
    .insert({
      title: input.title,
      description: input.description,
      severity: input.severity,
      source: input.source,
      inspection_id: input.inspectionId || null,
      lot_id: input.lotId || null,
      supplier_id: input.supplierId || null,
      containment_action: input.containmentAction || null,
    })
    .select("*")
    .single<NcrRow>();

  if (error) throw qualityError(error);

  await recordQualityAudit(
    {
      action: "quality.ncr.raised",
      entityType: "quality_ncr",
      entityId: data.id,
      description: `Non-conformance ${data.reference} raised: ${data.title}`,
      severity: data.severity === "critical" ? "critical" : "notice",
      newValues: { severity: data.severity, source: data.source, lot_id: data.lot_id },
    },
    meta,
  );

  return data;
}

export async function updateNcr(
  input: {
    ncrId: string;
    severity?: string;
    rootCause?: string;
    containmentAction?: string;
    status?: "investigating";
    statusReason?: string;
  },
  meta: RequestMeta = {},
): Promise<NcrRow> {
  await requirePermission("quality.ncr.update");
  const supabase = await createSupabaseServerClient();

  const patch: Database["public"]["Tables"]["quality_ncrs"]["Update"] = {};
  if (input.severity) patch.severity = input.severity;
  if (input.rootCause !== undefined) patch.root_cause = input.rootCause || null;
  if (input.containmentAction !== undefined) patch.containment_action = input.containmentAction || null;
  if (input.status) patch.status = input.status;
  if (input.statusReason !== undefined) patch.status_reason = input.statusReason || null;

  const { data, error } = await supabase
    .from("quality_ncrs")
    .update(patch)
    .eq("id", input.ncrId)
    .select("*")
    .single<NcrRow>();

  if (error) throw qualityError(error);

  await recordQualityAudit(
    {
      action: "quality.ncr.updated",
      entityType: "quality_ncr",
      entityId: data.id,
      description: `Non-conformance ${data.reference} updated.`,
      newValues: { severity: data.severity, status: data.status, root_cause: data.root_cause },
    },
    meta,
  );

  return data;
}

export async function closeNcr(
  input: { ncrId: string; rootCause?: string; reason: string },
  meta: RequestMeta = {},
): Promise<NcrRow> {
  await requirePermission("quality.ncr.close");

  const ncr = await callQualityRpc<NcrRow>("quality_close_ncr", {
    p_ncr_id: input.ncrId,
    p_root_cause: input.rootCause || null,
    p_reason: input.reason,
  });

  await recordQualityAudit(
    {
      action: "quality.ncr.closed",
      entityType: "quality_ncr",
      entityId: ncr.id,
      description: `Non-conformance ${ncr.reference} closed: ${input.reason}`,
      newValues: { status: ncr.status, root_cause: ncr.root_cause },
    },
    meta,
  );

  return ncr;
}

export async function createCapa(
  input: {
    ncrId?: string;
    actionType: "corrective" | "preventive";
    title: string;
    description: string;
    ownerEmployeeId?: string;
    dueDate?: string;
  },
  meta: RequestMeta = {},
): Promise<CapaRow> {
  await requirePermission("quality.capa.create");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("quality_capa_actions")
    .insert({
      ncr_id: input.ncrId || null,
      action_type: input.actionType,
      title: input.title,
      description: input.description,
      owner_employee_id: input.ownerEmployeeId || null,
      due_date: input.dueDate || null,
    })
    .select("*")
    .single<CapaRow>();

  if (error) throw qualityError(error);

  await recordQualityAudit(
    {
      action: "quality.capa.created",
      entityType: "quality_capa_action",
      entityId: data.id,
      description: `${input.actionType === "corrective" ? "Corrective" : "Preventive"} action ${data.reference} created: ${data.title}`,
      newValues: { action_type: data.action_type, due_date: data.due_date, ncr_id: data.ncr_id },
    },
    meta,
  );

  return data;
}

export async function updateCapaStatus(
  input: { actionId: string; status: "in_progress" | "completed" | "cancelled"; statusReason?: string },
  meta: RequestMeta = {},
): Promise<CapaRow> {
  await requirePermission("quality.capa.update");
  const supabase = await createSupabaseServerClient();

  const patch: Database["public"]["Tables"]["quality_capa_actions"]["Update"] = {
    status: input.status,
    status_reason: input.statusReason || null,
  };
  if (input.status === "completed") {
    patch.completed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("quality_capa_actions")
    .update(patch)
    .eq("id", input.actionId)
    .select("*")
    .single<CapaRow>();

  if (error) throw qualityError(error);

  await recordQualityAudit(
    {
      action: "quality.capa.updated",
      entityType: "quality_capa_action",
      entityId: data.id,
      description: `Action ${data.reference} moved to ${data.status}.`,
      newValues: { status: data.status, status_reason: data.status_reason },
    },
    meta,
  );

  return data;
}

export async function verifyCapa(
  input: { actionId: string; notes: string },
  meta: RequestMeta = {},
): Promise<CapaRow> {
  await requirePermission("quality.capa.verify");

  const action = await callQualityRpc<CapaRow>("quality_verify_capa", {
    p_action_id: input.actionId,
    p_notes: input.notes,
  });

  await recordQualityAudit(
    {
      action: "quality.capa.verified",
      entityType: "quality_capa_action",
      entityId: action.id,
      description: `Action ${action.reference} verified as effective.`,
      newValues: { status: action.status, verification_notes: action.verification_notes },
    },
    meta,
  );

  return action;
}

export async function listCapa(filters: { status?: string } = {}): Promise<CapaRegisterRow[]> {
  await requirePermission("quality.capa.view");
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("quality_capa_register")
    .select("*")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error } = await query.returns<CapaRegisterRow[]>();
  if (error) throw new AppError("DATABASE_ERROR", `Actions could not be loaded. ${error.message}`);
  return data ?? [];
}
