import { describe, expect, it } from "vitest";

import { DecimalError, add, compare, decimal, divide, format, multiply, round, subtract, toDisplayString } from "@/lib/uom/decimal";

describe("decimal", () => {
  it("parses decimal strings into scaled integers", () => {
    expect(decimal("1.5", 2).units).toBe(150n);
    expect(decimal("-0.25", 2).units).toBe(-25n);
    expect(decimal(".5", 1).units).toBe(5n);
    expect(decimal("7", 0).units).toBe(7n);
  });

  it("refuses to silently round away precision it was not told about", () => {
    expect(() => decimal("1.23456", 2)).toThrow(DecimalError);
    // Trailing zeros are not precision loss, so they are allowed.
    expect(decimal("1.2300", 2).units).toBe(123n);
  });

  it("rejects values that are not decimals", () => {
    for (const value of ["", "-", ".", "1e5", "abc", "1,5"]) {
      expect(() => decimal(value, 2)).toThrow(DecimalError);
    }
  });

  it("adds and subtracts exactly, unlike binary floating point", () => {
    const sum = add(decimal("0.1", 4), decimal("0.2", 4));
    expect(format(sum, 4)).toBe("0.3000");
    expect(0.1 + 0.2).not.toBe(0.3);

    const difference = subtract(decimal("1000000.01", 4), decimal("0.01", 4));
    expect(format(difference, 4)).toBe("1000000.0000");
  });

  it("multiplies quantities by conversion factors without drift", () => {
    const kilograms = multiply(decimal("50", 12), decimal("0.45359237", 12));
    expect(format(kilograms, 8)).toBe("22.67961850");
  });

  it("divides with an explicit scale and rounds half-up only when asked", () => {
    const third = divide(decimal("1", 12), decimal("3", 12), 12);
    // format() never rounds: it refuses to drop digits that carry value.
    expect(() => format(third, 6)).toThrow(DecimalError);
    expect(format(round(third, 6), 6)).toBe("0.333333");
    expect(format(round(third, 4), 4)).toBe("0.3333");

    expect(format(round(decimal("2.5", 1), 0), 0)).toBe("3");
    expect(format(round(decimal("-2.5", 1), 0), 0)).toBe("-3");
  });

  it("compares by value, not by textual representation", () => {
    expect(compare(decimal("1.50", 2), decimal("1.5", 2))).toBe(0);
    expect(compare(decimal("1.5", 2), decimal("1.51", 2))).toBe(-1);
    expect(compare(decimal("1.51", 2), decimal("1.5", 2))).toBe(1);
  });

  it("formats without exponent notation and trims only when asked", () => {
    expect(format(decimal("1234.5000", 4), 4)).toBe("1234.5000");
    expect(toDisplayString(decimal("1234.5000", 4))).toBe("1234.5");
    expect(toDisplayString(decimal("0.0000", 4))).toBe("0");
  });
});
