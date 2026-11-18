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

type SpecificationRow = Database["public"]["Tables"]["quality_specifications"]["Row"];
type SpecificationRegisterRow = Database["public"]["Views"]["quality_specification_register"]["Row"];
type SpecificationParameterRow = Database["public"]["Tables"]["quality_specification_parameters"]["Row"];
type ParameterRow = Database["public"]["Tables"]["quality_parameters"]["Row"];
type SamplingPlanRow = Database["public"]["Tables"]["quality_sampling_plans"]["Row"];

/**
 * Quality specifications.
 *
 * Nothing in this file decides a limit. A specification is created as a draft with the lines a person typed, and the
 * database refuses to approve it unless every mandatory line has something to judge against. That refusal is the
 * whole safety property: a specification with no limits would produce inspections that can never fail.
 */

export async function listSpecifications(
  filters: { status?: string; stage?: string; page?: number } = {},
): Promise<RegisterPage<SpecificationRegisterRow>> {
  await requirePermission("quality.specification.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;

  let query = supabase
    .from("quality_specification_register")
    .select("*", { count: "exact" })
    .order("product_code")
    .order("version", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.stage) query = query.eq("stage", filters.stage);

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Specifications could not be loaded. ${error.message}`);

  return pageOf(data ?? [], page, pageSize, count ?? 0);
}

export type SpecificationDetail = {
  specification: SpecificationRegisterRow;
  lines: (SpecificationParameterRow & {
    parameter: ParameterRow | null;
    unit_code: string | null;
  })[];
  /** What the specification in force for this product and stage is today, if it is not this one. */
  effectiveReference: string | null;
  inspectionCount: number;
};

export async function getSpecification(specificationId: string): Promise<SpecificationDetail> {
  await requirePermission("quality.specification.view");
  const supabase = await createSupabaseServerClient();

  const { data: specification, error } = await supabase
    .from("quality_specification_register")
    .select("*")
    .eq("id", specificationId)
    .maybeSingle<SpecificationRegisterRow>();
  if (error) throw new AppError("DATABASE_ERROR", `That specification could not be loaded. ${error.message}`);
  if (!specification) throw new AppError("NOT_FOUND", "That specification does not exist, or you cannot see it.");

  const [{ data: lines }, { data: effective }, { count }] = await Promise.all([
    supabase
      .from("quality_specification_parameters")
      .select("*, parameter:quality_parameters(*), unit:units_of_measure(code)")
      .eq("specification_id", specificationId)
      .order("line_number")
      .returns<
        (SpecificationParameterRow & {
          parameter: ParameterRow | null;
          unit: { code: string } | null;
        })[]
      >(),
    supabase
      .from("quality_specifications")
      .select("reference")
      .eq("product_id", specification.product_id ?? "")
      .eq("stage", specification.stage ?? "")
      .eq("status", "approved")
      .maybeSingle<{ reference: string }>(),
    supabase
      .from("quality_inspections")
      .select("id", { count: "exact", head: true })
      .eq("specification_id", specificationId),
  ]);

  return {
    specification,
    lines: (lines ?? []).map((line) => ({
      ...line,
      unit_code: line.unit?.code ?? null,
    })),
    effectiveReference: effective?.reference ?? null,
    inspectionCount: count ?? 0,
  };
}

export type SpecificationLineInput = {
  parameterId: string;
  minValue?: string;
  maxValue?: string;
  targetValue?: string;
  expectedText?: string;
  unitId?: string;
  isMandatory: boolean;
  criticality: "critical" | "major" | "minor";
  methodReference?: string;
  notes?: string;
};

export async function createSpecification(
  input: {
    productId: string;
    stage: string;
    title?: string;
    methodReference?: string;
    notes?: string;
  },
  lines: SpecificationLineInput[] = [],
  meta: RequestMeta = {},
): Promise<SpecificationRow> {
  await requirePermission("quality.specification.create");
  const supabase = await createSupabaseServerClient();

  const { data: created, error } = await supabase
    .from("quality_specifications")
    .insert({
      product_id: input.productId,
      stage: input.stage,
      title: input.title || null,
      method_reference: input.methodReference || null,
      notes: input.notes || null,
    })
    .select("*")
    .single<SpecificationRow>();

  if (error) throw qualityError(error);

  if (lines.length === 0) {
    await recordQualityAudit(
      {
        action: "quality.specification.created",
        entityType: "quality_specification",
        entityId: created.id,
        description: `Specification ${created.reference} draft created with no parameter lines yet.`,
        newValues: { stage: created.stage, product_id: created.product_id },
      },
      meta,
    );
    return created;
  }

  const payload = lines.map((line, index) => ({
    specification_id: created.id,
    parameter_id: line.parameterId,
    line_number: index + 1,
    min_value: numeric(line.minValue),
    max_value: numeric(line.maxValue),
    target_value: numeric(line.targetValue),
    expected_text: line.expectedText || null,
    unit_id: line.unitId || null,
    is_mandatory: line.isMandatory,
    criticality: line.criticality,
    method_reference: line.methodReference || null,
    notes: line.notes || null,
  }));

  const { error: lineError } = await supabase.from("quality_specification_parameters").insert(payload);
  if (lineError) throw qualityError(lineError);

  await recordQualityAudit(
    {
      action: "quality.specification.created",
      entityType: "quality_specification",
      entityId: created.id,
      description: `Specification ${created.reference} created with ${lines.length} parameter line(s).`,
      newValues: { stage: created.stage, product_id: created.product_id, lines: lines.length },
    },
    meta,
  );

  return created;
}

export async function approveSpecification(
  specificationId: string,
  reason: string | undefined,
  meta: RequestMeta = {},
): Promise<SpecificationRow> {
  await requirePermission("quality.specification.approve");

  const spec = await callQualityRpc<SpecificationRow>("quality_approve_specification", {
    p_specification_id: specificationId,
    p_reason: reason || null,
  });

  await recordQualityAudit(
    {
      action: "quality.specification.approved",
      entityType: "quality_specification",
      entityId: specificationId,
      description: `Specification ${spec.reference} version ${spec.version} approved.`,
      severity: "notice",
      newValues: { status: spec.status, version: spec.version },
    },
    meta,
  );

  return spec;
}

/**
 * Adds one parameter line to a draft specification.
 *
 * One line at a time rather than a whole grid, because the database refuses to change lines once the specification is
 * approved and a half-saved grid would be an easy way to lose an edit. The trigger that guards immutability is what
 * enforces "drafts only"; this service does not re-implement that rule, it reports the refusal.
 */
export async function addSpecificationLine(
  specificationId: string,
  line: SpecificationLineInput,
  meta: RequestMeta = {},
): Promise<SpecificationParameterRow> {
  await requirePermission("quality.specification.update");
  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from("quality_specification_parameters")
    .select("line_number")
    .eq("specification_id", specificationId)
    .order("line_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ line_number: number }>();

  const { data, error } = await supabase
    .from("quality_specification_parameters")
    .insert({
      specification_id: specificationId,
      parameter_id: line.parameterId,
      line_number: (existing?.line_number ?? 0) + 1,
      min_value: numeric(line.minValue),
      max_value: numeric(line.maxValue),
      target_value: numeric(line.targetValue),
      expected_text: line.expectedText || null,
      unit_id: line.unitId || null,
      is_mandatory: line.isMandatory,
      criticality: line.criticality,
      method_reference: line.methodReference || null,
      notes: line.notes || null,
    })
    .select("*")
    .single<SpecificationParameterRow>();

  if (error) throw qualityError(error);

  await recordQualityAudit(
    {
      action: "quality.specification.updated",
      entityType: "quality_specification_parameter",
      entityId: data.id,
      description: `Parameter line added to specification ${specificationId}.`,
      newValues: {
        parameter_id: data.parameter_id,
        min_value: data.min_value,
        max_value: data.max_value,
        expected_text: data.expected_text,
        criticality: data.criticality,
      },
    },
    meta,
  );

  return data;
}

export async function removeSpecificationLine(lineId: string, meta: RequestMeta = {}): Promise<void> {
  await requirePermission("quality.specification.update");
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("quality_specification_parameters").delete().eq("id", lineId);
  if (error) throw qualityError(error);

  await recordQualityAudit(
    {
      action: "quality.specification.updated",
      entityType: "quality_specification_parameter",
      entityId: lineId,
      description: "Parameter line removed from a draft specification.",
      severity: "notice",
    },
    meta,
  );
}

/** Parameters available to put on a specification line. */
export async function listParameters(): Promise<ParameterRow[]> {
  await requirePermission("quality.parameter.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quality_parameters")
    .select("*")
    .eq("is_active", true)
    .order("sort_order")
    .order("name")
    .returns<ParameterRow[]>();
  if (error) throw new AppError("DATABASE_ERROR", `Parameters could not be loaded. ${error.message}`);
  return data ?? [];
}

export async function createParameter(
  input: {
    code: string;
    name: string;
    resultType: string;
    unitId?: string;
    methodReference?: string;
    description?: string;
  },
  meta: RequestMeta = {},
): Promise<ParameterRow> {
  await requirePermission("quality.parameter.manage");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("quality_parameters")
    .insert({
      code: input.code,
      name: input.name,
      result_type: input.resultType,
      unit_id: input.unitId || null,
      method_reference: input.methodReference || null,
      description: input.description || null,
    })
    .select("*")
    .single<ParameterRow>();

  if (error) throw qualityError(error);

  await recordQualityAudit(
    {
      action: "quality.parameter.created",
      entityType: "quality_parameter",
      entityId: data.id,
      description: `Test parameter "${data.name}" added to the catalogue.`,
      newValues: { code: data.code, result_type: data.result_type },
    },
    meta,
  );

  return data;
}

export async function listSamplingPlans(): Promise<SamplingPlanRow[]> {
  await requirePermission("quality.sampling.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quality_sampling_plans")
    .select("*")
    .order("stage")
    .order("name")
    .returns<SamplingPlanRow[]>();
  if (error) throw new AppError("DATABASE_ERROR", `Sampling plans could not be loaded. ${error.message}`);
  return data ?? [];
}

export async function createSamplingPlan(
  input: {
    name: string;
    productId?: string;
    stage: string;
    basis: "percentage" | "fixed";
    percentage?: string;
    fixedQuantity?: string;
    unitId?: string;
    notes?: string;
  },
  meta: RequestMeta = {},
): Promise<SamplingPlanRow> {
  await requirePermission("quality.sampling.manage");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("quality_sampling_plans")
    .insert({
      name: input.name,
      product_id: input.productId || null,
      stage: input.stage,
      basis: input.basis,
      percentage: input.basis === "percentage" ? numeric(input.percentage) : null,
      fixed_quantity: input.basis === "fixed" ? numeric(input.fixedQuantity) : null,
      unit_id: input.basis === "fixed" ? (input.unitId || null) : null,
      notes: input.notes || null,
    })
    .select("*")
    .single<SamplingPlanRow>();

  if (error) throw qualityError(error);

  await recordQualityAudit(
    {
      action: "quality.sampling_plan.created",
      entityType: "quality_sampling_plan",
      entityId: data.id,
      description: `Sampling plan "${data.name}" created for the ${data.stage} stage.`,
      newValues: { basis: data.basis, percentage: data.percentage, fixed_quantity: data.fixed_quantity },
    },
    meta,
  );

  return data;
}
