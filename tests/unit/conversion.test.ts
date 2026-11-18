import { describe, expect, it } from "vitest";

import {
  convertQuantity,
  getApplicableConversion,
  getProductBaseUnit,
  isRuleEffective,
  roundConvertedQuantity,
  validateConversion,
  type ConversionRule,
  type ConversionUnit,
} from "@/lib/uom/convert";

const kg: ConversionUnit = { id: "u-kg", code: "kg", category: "MASS", precision: 3 };
const g: ConversionUnit = { id: "u-g", code: "g", category: "MASS", precision: 0 };
const bag: ConversionUnit = { id: "u-bag", code: "bag", category: "PACKAGING", precision: 0 };
const litre: ConversionUnit = { id: "u-l", code: "L", category: "VOLUME", precision: 3 };

const rule = (overrides: Partial<ConversionRule> = {}): ConversionRule => ({
  id: "rule-1",
  from_unit_id: kg.id,
  to_unit_id: g.id,
  conversion_factor: "1000",
  conversion_method: "multiply",
  product_id: null,
  effective_from: "2024-01-01",
  effective_until: null,
  is_active: true,
  ...overrides,
});

describe("unit conversion", () => {
  it("converts with a declared factor and reports which rule was used", () => {
    const result = convertQuantity([rule()], { quantity: "2.5", fromUnit: kg, toUnit: g });
    expect(result.quantity).toBe("2500");
    expect(result.ruleId).toBe("rule-1");
    expect(result.basis).toBe("standard");
    expect(result.factor).toBe("1000");
  });

  it("honours the divide method", () => {
    const result = convertQuantity([rule({ from_unit_id: g.id, to_unit_id: kg.id, conversion_method: "divide" })], {
      quantity: "2500",
      fromUnit: g,
      toUnit: kg,
    });
    expect(result.quantity).toBe("2.500");
  });

  it("returns the same quantity for the same unit without needing a rule", () => {
    const result = convertQuantity([], { quantity: "12.5", fromUnit: kg, toUnit: kg });
    expect(result.ruleId).toBe("identity");
    expect(result.quantity).toBe("12.500");
  });

  it("refuses to convert when no rule exists instead of assuming a factor", () => {
    expect(() => convertQuantity([], { quantity: "1", fromUnit: kg, toUnit: bag })).toThrow(/No approved conversion rule/);
  });

  it("refuses a cross-category standard conversion but allows a product-specific one", () => {
    const crossCategory = validateConversion([], { fromUnit: bag, toUnit: kg });
    expect(crossCategory.ok).toBe(false);
    expect(crossCategory.error).toMatch(/not meaningful/);

    const specific = rule({ from_unit_id: bag.id, to_unit_id: kg.id, conversion_factor: "50", product_id: "p-1" });
    const validated = validateConversion([specific], { fromUnit: bag, toUnit: kg, productId: "p-1" });
    expect(validated.ok).toBe(true);

    const result = convertQuantity([specific], { quantity: "3", fromUnit: bag, toUnit: kg, productId: "p-1" });
    expect(result.quantity).toBe("150.000");
    expect(result.basis).toBe("product_specific");
  });

  it("does not apply another product's rule", () => {
    const otherProduct = rule({ from_unit_id: bag.id, to_unit_id: kg.id, conversion_factor: "50", product_id: "p-2" });
    expect(() => convertQuantity([otherProduct], { quantity: "1", fromUnit: bag, toUnit: kg, productId: "p-1" })).toThrow(
      /different product/,
    );
  });

  it("rejects an ambiguous path where two rules apply at once", () => {
    const duplicated = [rule(), rule({ id: "rule-2" })];
    const applicable = getApplicableConversion(duplicated, { fromUnitId: kg.id, toUnitId: g.id });
    expect("error" in applicable && applicable.error).toMatch(/More than one conversion rule/);
  });

  it("respects effective dates on both ends", () => {
    const dated = rule({ effective_from: "2025-01-01", effective_until: "2025-06-30" });
    expect(isRuleEffective(dated, new Date("2024-12-31T00:00:00Z"))).toBe(false);
    expect(isRuleEffective(dated, new Date("2025-03-01T00:00:00Z"))).toBe(true);
    expect(isRuleEffective(dated, new Date("2025-07-01T00:00:00Z"))).toBe(false);
    expect(isRuleEffective({ ...dated, is_active: false }, new Date("2025-03-01T00:00:00Z"))).toBe(false);

    // The same quantity converted on a different date uses the rule that applied then.
    const historical = convertQuantity([dated], {
      quantity: "1",
      fromUnit: kg,
      toUnit: g,
      asOf: new Date("2025-03-01T00:00:00Z"),
    });
    expect(historical.asOf).toBe("2025-03-01");
    expect(() =>
      convertQuantity([dated], { quantity: "1", fromUnit: kg, toUnit: g, asOf: new Date("2025-08-01T00:00:00Z") }),
    ).toThrow(/No approved conversion rule/);
  });

  it("refuses a mass-to-volume conversion without a product, because density is product-specific", () => {
    const validated = validateConversion([], { fromUnit: kg, toUnit: litre });
    expect(validated.ok).toBe(false);
    expect(validated.error).toMatch(/MASS → VOLUME/);
  });

  it("rejects a zero or negative factor", () => {
    expect(() => convertQuantity([rule({ conversion_factor: "0" })], { quantity: "1", fromUnit: kg, toUnit: g })).toThrow(
      /greater than zero/,
    );
  });

  it("resolves a product's base unit from the registry rather than guessing", () => {
    expect(getProductBaseUnit({ base_unit_id: kg.id }, [kg, g])).toEqual(kg);
    expect(getProductBaseUnit({ base_unit_id: "missing" }, [kg, g])).toBeNull();
  });

  it("rounds a converted quantity to the unit precision, half-up", () => {
    expect(roundConvertedQuantity("2.3455", 2)).toBe("2.35");
    expect(roundConvertedQuantity("2.3444", 2)).toBe("2.34");
    expect(roundConvertedQuantity("10", 0)).toBe("10");
  });
});
