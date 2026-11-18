import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { convertQuantity, getApplicableConversion, validateConversion } from "@/lib/uom/convert";
import { unitConversionSchema, unitSchema } from "@/lib/validation/master-data.schemas";
import { requirePermission } from "@/services/authorization";
import { getActiveProfileId } from "@/services/master-data/helpers";
import { numeric, recordMasterAudit, translateDatabaseError } from "@/services/master-data/shared";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { UnitConversion, UnitOfMeasure } from "@/types/database.types";

export type ConversionRow = UnitConversion & {
  from_unit: { id: string; code: string; name: string; category: string } | null;
  to_unit: { id: string; code: string; name: string; category: string } | null;
  product: { id: string; code: string; name: string } | null;
};

export async function getUnits(): Promise<UnitOfMeasure[]> {
  await requirePermission("master_data.units.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("units_of_measure")
    .select("*")
    .order("category")
    .order("name")
    .returns<UnitOfMeasure[]>();
  if (error) throw translateDatabaseError(error, "The units of measure");
  return data ?? [];
}

export async function saveUnit(input: unknown, meta: RequestMeta = {}): Promise<UnitOfMeasure> {
  await requirePermission("master_data.units.manage");
  const payload = unitSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const record = {
    code: payload.code,
    name: payload.name,
    symbol: payload.symbol || null,
    category: payload.category,
    precision: payload.precision,
    is_base_unit: payload.isBaseUnit ?? false,
    is_active: payload.isActive ?? true,
    notes: payload.notes || null,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("units_of_measure").update(record).eq("id", payload.id).select("*").single<UnitOfMeasure>()
    : await supabase
        .from("units_of_measure")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<UnitOfMeasure>();
  if (error) throw translateDatabaseError(error, "The unit of measure");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "unit_of_measure",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Created"} unit ${data.code} (${data.category}).`,
      newValues: { code: data.code, category: data.category, precision: data.precision },
    },
    meta,
  );

  revalidatePath("/master-data/units");
  revalidatePath("/master-data/conversions");
  return data;
}

export async function getConversions(productId?: string): Promise<ConversionRow[]> {
  await requirePermission("master_data.conversions.view");
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("unit_conversions")
    .select(
      "*, from_unit:units_of_measure!unit_conversions_from_unit_id_fkey(id, code, name, category), to_unit:units_of_measure!unit_conversions_to_unit_id_fkey(id, code, name, category), product:products(id, code, name)",
    );
  if (productId) query = query.eq("product_id", productId);
  const { data, error } = await query.order("created_at", { ascending: false }).returns<ConversionRow[]>();
  if (error) throw translateDatabaseError(error, "The conversion rules");
  return data ?? [];
}

/**
 * Saves a conversion rule.
 *
 * Validation happens twice on purpose: Zod checks the shape, and the domain rules (category
 * compatibility, no duplicate live rule for the same pair, product-scoped rules naming a product)
 * are checked against the current rule set before the database sees the row.
 */
export async function saveUnitConversion(input: unknown, meta: RequestMeta = {}): Promise<UnitConversion> {
  await requirePermission("master_data.conversions.manage");
  const payload = unitConversionSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data: units } = await supabase
    .from("units_of_measure")
    .select("id, code, name, category, precision, is_active")
    .in("id", [payload.fromUnitId, payload.toUnitId])
    .returns<UnitOfMeasure[]>();

  const fromUnit = units?.find((unit) => unit.id === payload.fromUnitId);
  const toUnit = units?.find((unit) => unit.id === payload.toUnitId);
  if (!fromUnit || !toUnit) throw new AppError("VALIDATION_ERROR", "Both units must exist.");
  if (!fromUnit.is_active || !toUnit.is_active) {
    throw new AppError("VALIDATION_ERROR", "Conversions may only use active units.");
  }
  if (payload.fromUnitId === payload.toUnitId) {
    throw new AppError("VALIDATION_ERROR", "Choose two different units.");
  }
  if (!payload.productId && fromUnit.category !== toUnit.category) {
    throw new AppError(
      "VALIDATION_ERROR",
      `A standard ${fromUnit.category} → ${toUnit.category} conversion is not meaningful. Name the product this conversion belongs to.`,
    );
  }
  if (payload.effectiveUntil && payload.effectiveUntil < payload.effectiveFrom) {
    throw new AppError("VALIDATION_ERROR", "The end date cannot precede the start date.");
  }

  const { data: existingRules } = await supabase
    .from("unit_conversions")
    .select("*")
    .eq("from_unit_id", payload.fromUnitId)
    .eq("to_unit_id", payload.toUnitId)
    .returns<UnitConversion[]>();

  const overlapping = (existingRules ?? []).find(
    (rule) =>
      rule.id !== payload.id &&
      (rule.product_id ?? null) === (payload.productId ?? null) &&
      rule.effective_from === payload.effectiveFrom,
  );
  if (overlapping) {
    throw new AppError(
      "CONFLICT",
      "A conversion rule for this pair already starts on that date. End the existing rule first so history stays unambiguous.",
    );
  }

  const record = {
    from_unit_id: payload.fromUnitId,
    to_unit_id: payload.toUnitId,
    conversion_factor: numeric(payload.conversionFactor) ?? 0,
    conversion_method: payload.conversionMethod,
    product_id: payload.productId,
    effective_from: payload.effectiveFrom,
    effective_until: payload.effectiveUntil || null,
    notes: payload.notes || null,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("unit_conversions").update(record).eq("id", payload.id).select("*").single<UnitConversion>()
    : await supabase
        .from("unit_conversions")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<UnitConversion>();

  if (error) throw translateDatabaseError(error, "The conversion rule");

  await recordMasterAudit(
    {
      action: "master_data.conversion_changed",
      entityType: "unit_conversion",
      entityId: data.id,
      description: `Conversion ${fromUnit.code} → ${toUnit.code} = ${data.conversion_factor}${payload.productId ? " for one product" : " (standard)"}.`,
      severity: payload.productId ? "notice" : "warning",
      newValues: {
        from_unit: fromUnit.code,
        to_unit: toUnit.code,
        factor: data.conversion_factor,
        product_id: data.product_id,
        effective_from: data.effective_from,
      },
    },
    meta,
  );

  revalidatePath("/master-data/conversions");
  return data;
}

export type ConversionPreview =
  | { ok: true; result: ReturnType<typeof convertQuantity> }
  | { ok: false; error: string };

/**
 * Preview a conversion without saving anything. This is what the conversions screen uses, and it
 * is the same code path a future procurement or inventory module will call.
 */
export async function previewConversion(input: {
  quantity: string;
  fromUnitId: string;
  toUnitId: string;
  productId?: string | null;
  asOf?: string;
}): Promise<ConversionPreview> {
  await requirePermission("master_data.conversions.view");
  const supabase = await createSupabaseServerClient();

  const { data: units } = await supabase
    .from("units_of_measure")
    .select("id, code, name, category, precision")
    .in("id", [input.fromUnitId, input.toUnitId])
    .returns<UnitOfMeasure[]>();

  const fromUnit = units?.find((unit) => unit.id === input.fromUnitId);
  const toUnit = units?.find((unit) => unit.id === input.toUnitId);
  if (!fromUnit || !toUnit) return { ok: false, error: "Choose both units." };

  // Both directions are fetched: a rule may only be defined one way round.
  const { data: rules } = await supabase
    .from("unit_conversions")
    .select("*")
    .eq("is_active", true)
    .or(`from_unit_id.eq.${fromUnit.id},from_unit_id.eq.${toUnit.id}`)
    .returns<UnitConversion[]>();

  const usable = (rules ?? []).filter(
    (rule) =>
      (rule.from_unit_id === fromUnit.id && rule.to_unit_id === toUnit.id) ||
      (rule.from_unit_id === toUnit.id && rule.to_unit_id === fromUnit.id),
  );

  const check = validateConversion(usable.map(toRule), {
    fromUnit,
    toUnit,
    productId: input.productId ?? null,
    asOf: input.asOf ? new Date(input.asOf) : undefined,
  });
  if (!check.ok) return { ok: false, error: check.error ?? "No conversion is available." };

  try {
    const result = convertQuantity(usable.map(toRule), {
      quantity: input.quantity,
      fromUnit,
      toUnit,
      productId: input.productId ?? null,
      asOf: input.asOf ? new Date(input.asOf) : undefined,
    });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Conversion failed." };
  }
}

function toRule(rule: UnitConversion) {
  return {
    id: rule.id,
    from_unit_id: rule.from_unit_id,
    to_unit_id: rule.to_unit_id,
    conversion_factor: rule.conversion_factor,
    conversion_method: rule.conversion_method as "multiply" | "divide",
    product_id: rule.product_id,
    effective_from: rule.effective_from,
    effective_until: rule.effective_until,
    is_active: rule.is_active,
  };
}

/** Re-exported so callers do not need to import the engine directly. */
export { getApplicableConversion };
