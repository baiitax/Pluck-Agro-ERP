/**
 * Decimal-safe arithmetic for quantities, conversion factors and money.
 *
 * Why not `number`: 0.1 + 0.2 is 0.30000000000000004, and a conversion chain that multiplies a
 * factor by a factor by a quantity can drift far enough to mis-state a shipment. JavaScript
 * floating point is fine for pixels, not for kilograms on a customs declaration.
 *
 * This module implements a small fixed-point decimal on top of `BigInt`: every value is stored as
 * an integer scaled by 10^scale, and every operation re-scales explicitly. The database uses
 * PostgreSQL NUMERIC with enough precision for the same values, so a value round-trips without
 * being reinterpreted.
 *
 * Deliberately absent: exponentiation, trigonometry, irrational constants. If a calculation needs
 * those, it does not belong in a quantity conversion.
 */

export type Decimal = { readonly units: bigint; readonly scale: number };

export class DecimalError extends Error {}

const MAX_SCALE = 18;

function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > MAX_SCALE) {
    throw new DecimalError(`Unsupported scale: ${exponent}`);
  }
  return 10n ** BigInt(exponent);
}

/** Parses a decimal string (or a safe number) into a scaled integer. */
export function decimal(value: string | number | bigint, scale = 6): Decimal {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new DecimalError(`Unsupported scale: ${scale}`);
  }

  if (typeof value === "bigint") return { units: value * pow10(scale), scale };

  const text = typeof value === "number" ? numberToPlainString(value) : value.trim();
  if (!/^-?\d*(\.\d*)?$/.test(text) || text === "" || text === "-" || text === ".") {
    throw new DecimalError(`Not a decimal value: ${String(value)}`);
  }

  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole = "0", fraction = ""] = unsigned.split(".");

  if (fraction.length > scale) {
    // Refuse silent rounding: a value with more precision than the target scale is a caller bug.
    const dropped = fraction.slice(scale);
    if (/[1-9]/.test(dropped)) {
      throw new DecimalError(
        `Value ${text} has more than ${scale} decimal places. Pass more scale or round explicitly.`,
      );
    }
  }

  const paddedFraction = (fraction + "0".repeat(scale)).slice(0, scale);
  const units = BigInt(`${whole === "" ? "0" : whole}${paddedFraction}`);
  return { units: negative ? -units : units, scale };
}

/** `number` → plain decimal string, avoiding exponential notation for small/large values. */
function numberToPlainString(value: number): string {
  if (!Number.isFinite(value)) throw new DecimalError(`Not a finite number: ${value}`);
  const text = value.toString();
  if (!text.includes("e") && !text.includes("E")) return text;
  return value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}

function rescale(value: Decimal, scale: number): bigint {
  if (scale === value.scale) return value.units;
  if (scale > value.scale) return value.units * pow10(scale - value.scale);
  const divisor = pow10(value.scale - scale);
  const quotient = value.units / divisor;
  const remainder = value.units % divisor;
  // Banker-free rule: only scale down when it is exact, so nothing is silently lost.
  if (remainder !== 0n) {
    throw new DecimalError(
      `Cannot drop ${value.scale - scale} decimal place(s) without losing precision.`,
    );
  }
  return quotient;
}

/** Aligns two decimals on the larger scale. */
function align(a: Decimal, b: Decimal): { left: bigint; right: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);
  return { left: rescale(a, scale), right: rescale(b, scale), scale };
}

export function add(a: Decimal, b: Decimal): Decimal {
  const { left, right, scale } = align(a, b);
  return { units: left + right, scale };
}

export function subtract(a: Decimal, b: Decimal): Decimal {
  const { left, right, scale } = align(a, b);
  return { units: left - right, scale };
}

export function multiply(a: Decimal, b: Decimal): Decimal {
  const scale = Math.min(a.scale + b.scale, MAX_SCALE);
  const product = a.units * b.units;
  const drop = a.scale + b.scale - scale;
  if (drop > 0) {
    const divisor = pow10(drop);
    if (product % divisor !== 0n) {
      throw new DecimalError("Multiplication lost precision; increase the scale.");
    }
    return { units: product / divisor, scale };
  }
  return { units: product, scale };
}

export function divide(a: Decimal, b: Decimal, scale = 12): Decimal {
  if (b.units === 0n) throw new DecimalError("Division by zero.");
  const target = Math.min(Math.max(scale, a.scale), MAX_SCALE);
  const numerator = rescale(a, target + b.scale);
  // Integer division truncates toward zero, which is the documented rounding rule for ratios.
  return { units: numerator / b.units, scale: target };
}

export function compare(a: Decimal, b: Decimal): number {
  const { left, right } = align(a, b);
  return left === right ? 0 : left > right ? 1 : -1;
}

export function isZero(value: Decimal): boolean {
  return value.units === 0n;
}

/** Rounds half-up to `scale` decimal places. Use only where a policy explicitly allows rounding. */
export function round(value: Decimal, scale: number): Decimal {
  if (scale >= value.scale) return { units: rescale(value, scale), scale };
  const divisor = pow10(value.scale - scale);
  const negative = value.units < 0n;
  const absolute = negative ? -value.units : value.units;
  const quotient = absolute / divisor;
  const remainder = absolute % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return { units: negative ? -rounded : rounded, scale };
}

/** Fixed-point string with exactly `scale` decimal places (no exponent, no locale separators). */
export function format(value: Decimal, scale = value.scale): string {
  const rescaled = rescale(value, scale);
  const negative = rescaled < 0n;
  const digits = (negative ? -rescaled : rescaled).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? "" : `.${digits.slice(digits.length - scale)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Convenience for display: trims trailing zeros while keeping the value exact. */
export function toDisplayString(value: Decimal, maxScale = value.scale): string {
  return format(value, maxScale).replace(/\.?0+$/, "") || "0";
}
