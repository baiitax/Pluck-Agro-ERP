import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { Database } from "@/types/database.types";
import {
  callQualityRpc,
  numeric,
  pageOf,
  qualityError,
  recordQualityAudit,
  type RegisterPage,
} from "@/services/quality/shared";

type InspectionRow = Database["public"]["Tables"]["quality_inspections"]["Row"];
type InspectionRegisterRow = Database["public"]["Views"]["quality_inspection_register"]["Row"];
type ResultRow = Database["public"]["Tables"]["quality_inspection_results"]["Row"];
type SpecificationParameterRow = Database["public"]["Tables"]["quality_specification_parameters"]["Row"];
type ParameterRow = Database["public"]["Tables"]["quality_parameters"]["Row"];
type SampleRow = Database["public"]["Tables"]["quality_samples"]["Row"];

/**
 * Inspections and their results.
 *
 * The three things this service refuses to do:
 *   * it does not decide conformance — the trigger that computes `conformance` does, against the limits copied onto
 *     the result;
 *   * it does not decide the summary — `quality_submit_inspection` computes it, and `indeterminate` is a real answer;
 *   * it does not let an unapproved inspection reach a disposition — the disposition function checks that itself.
 */

export async function listInspections(
  filters: { status?: string; stage?: string; page?: number } = {},
): Promise<RegisterPage<InspectionRegisterRow>> {
  await requirePermission("quality.inspection.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;

  let query = supabase
    .from("quality_inspection_register")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.stage) query = query.eq("stage", filters.stage);

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Inspections could not be loaded. ${error.message}`);

  return pageOf(data ?? [], page, pageSize, count ?? 0);
}

export type InspectionDetail = {
  inspection: InspectionRegisterRow;
  results: (ResultRow & { parameter: ParameterRow | null; unit_code: string | null })[];
  /** Every parameter on the specification, so the screen can show what is still missing rather than only what is done. */
  expectedParameters: (SpecificationParameterRow & { parameter: ParameterRow | null })[];
  samples: SampleRow[];
  /** True when the caller may still change results, i.e. the inspection has not left draft/in_progress. */
  editable: boolean;
  missingParameterNames: string[];
};

export async function getInspection(inspectionId: string): Promise<InspectionDetail> {
  await requirePermission("quality.inspection.view");
  const supabase = await createSupabaseServerClient();

  const { data: inspection, error } = await supabase
    .from("quality_inspection_register")
    .select("*")
    .eq("id", inspectionId)
    .maybeSingle<InspectionRegisterRow>();
  if (error) throw new AppError("DATABASE_ERROR", `That inspection could not be loaded. ${error.message}`);
  if (!inspection) throw new AppError("NOT_FOUND", "That inspection does not exist, or you cannot see it.");

  const [{ data: results }, { data: expected }, { data: samples }] = await Promise.all([
    supabase
      .from("quality_inspection_results")
      .select("*, parameter:quality_parameters(*), unit:units_of_measure(code)")
      .eq("inspection_id", inspectionId)
      .returns<(ResultRow & { parameter: ParameterRow | null; unit: { code: string } | null })[]>(),
    supabase
      .from("quality_specification_parameters")
      .select("*, parameter:quality_parameters(*)")
      .eq("specification_id", inspection.specification_id ?? "")
      .order("line_number")
      .returns<(SpecificationParameterRow & { parameter: ParameterRow | null })[]>(),
    supabase
      .from("quality_samples")
      .select("*")
      .eq("inspection_id", inspectionId)
      .order("taken_at", { ascending: false })
      .returns<SampleRow[]>(),
  ]);

  const recorded = new Set((results ?? []).map((row) => row.parameter_id));
  const missingParameterNames = (expected ?? [])
    .filter((line) => line.is_mandatory && !recorded.has(line.parameter_id))
    .map((line) => line.parameter?.name ?? "Unnamed parameter");

  return {
    inspection,
    results: (results ?? []).map((row) => ({ ...row, unit_code: row.unit?.code ?? null })),
    expectedParameters: expected ?? [],
    samples: samples ?? [],
    editable: inspection.status === "draft" || inspection.status === "in_progress",
    missingParameterNames,
  };
}

export async function createInspection(
  input: {
    specificationId: string;
    lotId: string;
    inspectionType: string;
    samplingPlanId?: string;
    sampledQuantity?: string;
    sampleUnitId?: string;
    notes?: string;
  },
  meta: RequestMeta = {},
): Promise<InspectionRow> {
  await requirePermission("quality.inspection.manage");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("quality_inspections")
    .insert({
      specification_id: input.specificationId,
      lot_id: input.lotId,
      inspection_type: input.inspectionType,
      sampling_plan_id: input.samplingPlanId || null,
      sampled_quantity: numeric(input.sampledQuantity),
      sample_unit_id: input.sampleUnitId || null,
      notes: input.notes || null,
      // Product and stage are not passed: the insert trigger takes them from the specification, so there is exactly
      // one place that decides what an inspection is judging.
    })
    .select("*")
    .single<InspectionRow>();

  if (error) throw qualityError(error);

  await recordQualityAudit(
    {
      action: "quality.inspection.created",
      entityType: "quality_inspection",
      entityId: data.id,
      description: `Inspection ${data.reference} raised against lot ${input.lotId}.`,
      newValues: { specification_id: data.specification_id, lot_id: data.lot_id, type: data.inspection_type },
    },
    meta,
  );

  return data;
}

export async function collectSample(
  input: { inspectionId: string; quantity: string; unitId: string; locationNote?: string; notes?: string },
  meta: RequestMeta = {},
): Promise<SampleRow> {
  await requirePermission("quality.result.record");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("quality_samples")
    .insert({
      inspection_id: input.inspectionId,
      quantity: numeric(input.quantity),
      unit_id: input.unitId,
      location_note: input.locationNote || null,
      notes: input.notes || null,
    })
    .select("*")
    .single<SampleRow>();

  if (error) throw qualityError(error);

  await recordQualityAudit(
    {
      action: "quality.sample.collected",
      entityType: "quality_sample",
      entityId: data.id,
      description: `Sample ${data.reference} collected for inspection ${input.inspectionId}.`,
      newValues: { quantity: data.quantity, location_note: data.location_note },
    },
    meta,
  );

  return data;
}

export async function recordResult(
  input: {
    inspectionId: string;
    specificationParameterId: string;
    valueNumeric?: string;
    valueText?: string;
    notes?: string;
  },
  meta: RequestMeta = {},
): Promise<ResultRow> {
  const principal = await requirePermission("quality.result.record");
  const supabase = await createSupabaseServerClient();

  const { data: line, error: lineError } = await supabase
    .from("quality_specification_parameters")
    .select("parameter_id")
    .eq("id", input.specificationParameterId)
    .maybeSingle<{ parameter_id: string }>();
  if (lineError) throw qualityError(lineError);
  if (!line) throw new AppError("NOT_FOUND", "That specification line does not exist.");

  const { data, error } = await supabase
    .from("quality_inspection_results")
    .upsert(
      {
        inspection_id: input.inspectionId,
        specification_parameter_id: input.specificationParameterId,
        parameter_id: line.parameter_id,
        value_numeric: input.valueNumeric ? numeric(input.valueNumeric) : null,
        value_text: input.valueText || null,
        notes: input.notes || null,
        recorded_by: principal.user.id,
        recorded_at: new Date().toISOString(),
      },
      { onConflict: "inspection_id,parameter_id" },
    )
    .select("*")
    .single<ResultRow>();

  if (error) throw qualityError(error);

  await recordQualityAudit(
    {
      action: "quality.result.recorded",
      entityType: "quality_inspection_result",
      entityId: data.id,
      description: `Result recorded for inspection ${input.inspectionId}; conformance ${data.conformance}.`,
      newValues: {
        value_numeric: data.value_numeric,
        value_text: data.value_text,
        conformance: data.conformance,
        judged_min: data.judged_min,
        judged_max: data.judged_max,
      },
    },
    meta,
  );

  return data;
}

export async function submitInspection(inspectionId: string, meta: RequestMeta = {}): Promise<InspectionRow> {
  await requirePermission("quality.inspection.submit");
  const inspection = await callQualityRpc<InspectionRow>("quality_submit_inspection", {
    p_inspection_id: inspectionId,
  });

  await recordQualityAudit(
    {
      action: "quality.inspection.submitted",
      entityType: "quality_inspection",
      entityId: inspectionId,
      description: `Inspection ${inspection.reference} submitted with summary "${inspection.result_summary}".`,
      newValues: { status: inspection.status, result_summary: inspection.result_summary },
    },
    meta,
  );

  return inspection;
}

export async function approveInspection(
  inspectionId: string,
  reason: string | undefined,
  meta: RequestMeta = {},
): Promise<InspectionRow> {
  await requirePermission("quality.inspection.approve");
  const inspection = await callQualityRpc<InspectionRow>("quality_approve_inspection", {
    p_inspection_id: inspectionId,
    p_reason: reason || null,
  });

  await recordQualityAudit(
    {
      action: "quality.inspection.approved",
      entityType: "quality_inspection",
      entityId: inspectionId,
      description: `Inspection ${inspection.reference} approved (summary ${inspection.result_summary}).`,
      newValues: { status: inspection.status },
    },
    meta,
  );

  return inspection;
}
