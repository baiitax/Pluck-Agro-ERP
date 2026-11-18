/**
 * Quantity conversion engine.
 *
 * Rules, all of them deliberate:
 *  1. A conversion is only applied when a rule exists. "It is probably 25 kg" is not a rule.
 *  2. Product-specific rules win over standard rules, and are only usable for their product.
 *  3. Effective dates are respected: a rule that starts next week is not in force today.
 *  4. Ambiguity is an error, not a guess: two overlapping rules for the same pair at a given date
 *     reject the conversion.
 *  5. Arithmetic is decimal-safe (see ./decimal).
 */
import { DecimalError, compare, decimal, divide, format, multiply } from "./decimal";

export type ConversionRule = {
  id: string;
  from_unit_id: string;
  to_unit_id: string;
  conversion_factor: number | string;
  conversion_method: "multiply" | "divide";
  product_id: string | null;
  effective_from: string;
  effective_until: string | null;
  is_active: boolean;
};

export type ConversionUnit = {
  id: string;
  code: string;
  category: string;
  precision?: number;
};

export type ConversionRequest = {
  quantity: string | number;
  fromUnit: ConversionUnit;
  toUnit: ConversionUnit;
  productId?: string | null;
  asOf?: Date;
};

export type ConversionResult = {
  quantity: string;
  fromUnitCode: string;
  toUnitCode: string;
  factor: string;
  ruleId: string;
  productId: string | null;
  asOf: string;
  basis: "product_specific" | "standard";
};

const DAY = 86_400_000;
const WORKING_SCALE = 12;

function startOfDay(value: Date): number {
  return Math.floor(value.getTime() / DAY) * DAY;
}

function toTime(value: string): number {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`).getTime();
}

/** True when the rule is in force on `asOf` (rule dates are calendar dates, UTC). */
export function isRuleEffective(rule: Pick<ConversionRule, "effective_from" | "effective_until" | "is_active">, asOf = new Date()): boolean {
  if (!rule.is_active) return false;
  const today = startOfDay(asOf);
  if (toTime(rule.effective_from) > today) return false;
  if (rule.effective_until && toTime(rule.effective_until) < today) return false;
  return true;
}

/**
 * Picks the single applicable rule for a pair, or explains why there is none.
 * Product-specific matches take precedence over standard ones; anything still ambiguous is
 * rejected rather than resolved by guessing.
 */
export function getApplicableConversion(
  rules: ConversionRule[],
  options: { fromUnitId: string; toUnitId: string; productId?: string | null; asOf?: Date },
): { rule: ConversionRule; basis: "product_specific" | "standard" } | { error: string } {
  const asOf = options.asOf ?? new Date();
  const effective = rules.filter(
    (rule) =>
      rule.from_unit_id === options.fromUnitId &&
      rule.to_unit_id === options.toUnitId &&
      isRuleEffective(rule, asOf),
  );

  if (effective.length === 0) {
    return {
      error:
        "No approved conversion rule exists for these units on this date. Configure the conversion before relying on it.",
    };
  }

  const productSpecific = options.productId
    ? effective.filter((rule) => rule.product_id === options.productId)
    : [];
  const standard = effective.filter((rule) => rule.product_id === null);

  const candidates = productSpecific.length > 0 ? productSpecific : standard;
  if (candidates.length === 0) {
    return {
      error:
        "A product-specific conversion exists for a different product, and no standard rule applies. Conversions are never assumed across products.",
    };
  }
  if (candidates.length > 1) {
    return {
      error: "More than one conversion rule applies on this date. Resolve the overlap before converting.",
    };
  }

  const [rule] = candidates;
  if (!rule) return { error: "No applicable conversion rule." };
  return { rule, basis: productSpecific.length > 0 ? "product_specific" : "standard" };
}

/**
 * Converts a quantity using the supplied rules, or throws a DecimalError that says why it cannot.
 * This is the function the service layer calls and the one the tests exercise.
 */
export function convertQuantity(rules: ConversionRule[], request: ConversionRequest): ConversionResult {
  const { fromUnit, toUnit, productId = null, asOf = new Date() } = request;

  if (fromUnit.id === toUnit.id) {
    return {
      quantity: format(decimal(request.quantity, WORKING_SCALE), fromUnit.precision ?? 3),
      fromUnitCode: fromUnit.code,
      toUnitCode: toUnit.code,
      factor: "1",
      ruleId: "identity",
      productId,
      asOf: asOf.toISOString().slice(0, 10),
      basis: "standard",
    };
  }

  const applicable = getApplicableConversion(rules, {
    fromUnitId: fromUnit.id,
    toUnitId: toUnit.id,
    productId,
    asOf,
  });
  if ("error" in applicable) throw new DecimalError(applicable.error);

  const { rule, basis } = applicable;
  const factor = decimal(rule.conversion_factor, WORKING_SCALE);
  if (compare(factor, decimal(0)) <= 0) {
    throw new DecimalError("Conversion factor must be greater than zero.");
  }

  const quantity = decimal(request.quantity, WORKING_SCALE);
  const converted =
    rule.conversion_method === "divide" ? divide(quantity, factor, WORKING_SCALE) : multiply(quantity, factor);

  return {
    quantity: format(converted, toUnit.precision ?? fromUnit.precision ?? 3),
    fromUnitCode: fromUnit.code,
    toUnitCode: toUnit.code,
    factor: format(factor, 12).replace(/\.?0+$/, ""),
    ruleId: rule.id,
    productId,
    asOf: asOf.toISOString().slice(0, 10),
    basis,
  };
}

/** Non-throwing validation used by forms and by the conversion service before saving a rule. */
export function validateConversion(
  rules: ConversionRule[],
  options: { fromUnit: ConversionUnit; toUnit: ConversionUnit; productId?: string | null; asOf?: Date },
): { ok: boolean; error?: string } {
  if (options.fromUnit.id === options.toUnit.id) {
    return { ok: false, error: "Choose two different units." };
  }
  if (!options.productId && options.fromUnit.category !== options.toUnit.category) {
    return {
      ok: false,
      error: `A standard ${options.fromUnit.category} → ${options.toUnit.category} conversion is not meaningful. Name a product.`,
    };
  }
  const applicable = getApplicableConversion(rules, {
    fromUnitId: options.fromUnit.id,
    toUnitId: options.toUnit.id,
    productId: options.productId ?? null,
    asOf: options.asOf,
  });
  return "error" in applicable ? { ok: false, error: applicable.error } : { ok: true };
}

/** The base unit of a product, resolved from the unit registry rather than guessed. */
export function getProductBaseUnit(
  product: { base_unit_id: string },
  units: ConversionUnit[],
): ConversionUnit | null {
  return units.find((unit) => unit.id === product.base_unit_id) ?? null;
}

/** Rounds a converted quantity to a unit's configured precision (half-up, explicit). */
export function roundConvertedQuantity(value: string, precision: number): string {
  const parsed = decimal(value, WORKING_SCALE);
  const factor = 10 ** precision;
  const scaled = Number(format(parsed, WORKING_SCALE)) * factor;
  return (Math.round(scaled) / factor).toFixed(precision);
}
