/**
 * Decimal-safe procurement arithmetic.
 *
 * The database is the authority: totals are recalculated by trigger inside PostgreSQL NUMERIC, and
 * quantities are validated against locked rows when a receipt is posted. This module exists for the
 * two places the server must compute before writing — previewing a line total in a form and
 * checking a receipt against the outstanding quantity — and it uses the same fixed-point decimal
 * implementation Phase 2 uses for conversions, so no amount is ever passed through a float.
 *
 * Every function takes and returns decimal *strings*. Numbers appear only as `scale` arguments.
 */
import {
  add,
  compare,
  decimal,
  DecimalError,
  divide,
  format,
  multiply,
  round,
  subtract,
  toDisplayString,
  isZero,
  type Decimal,
} from "@/lib/uom/decimal";

/** Money scale: NUMERIC(18,2) / NUMERIC(20,2) in the schema. */
export const MONEY_SCALE = 2;
/** Unit price scale: NUMERIC(18,4). */
export const PRICE_SCALE = 4;
/** Quantity scale: NUMERIC(20,6). */
export const QUANTITY_SCALE = 6;
/** Exchange rates: NUMERIC(24,10). */
export const RATE_SCALE = 10;

export type LineInput = {
  quantity: string;
  unitPrice: string;
  /** Line discount in document currency. Defaults to 0. */
  discount?: string;
  /** Additional charge on the line, in document currency. Defaults to 0. */
  additionalCharges?: string;
  /** Tax amount for the line. Defaults to 0; no rate is ever derived here. */
  taxAmount?: string;
};

export type LineTotals = {
  /** round(quantity × unit price, 2) */
  goodsValue: string;
  discount: string;
  additionalCharges: string;
  taxAmount: string;
  /** goodsValue − discount + additionalCharges + taxAmount */
  lineTotal: string;
};

export type DocumentTotals = {
  subtotal: string;
  discountTotal: string;
  chargesTotal: string;
  taxTotal: string;
  total: string;
};

function money(value: string | number, scale: number = MONEY_SCALE): Decimal {
  return decimal(typeof value === "number" ? value.toString() : value, scale);
}

export function lineTotals(input: LineInput): LineTotals {
  const quantity = decimal(input.quantity, QUANTITY_SCALE);
  const price = decimal(input.unitPrice, PRICE_SCALE);
  const discount = money(input.discount ?? "0");
  const charges = money(input.additionalCharges ?? "0");
  const tax = money(input.taxAmount ?? "0");

  const goods = round(multiply(quantity, price), MONEY_SCALE);

  if (compare(discount, goods) > 0) {
    throw new DecimalError("A line discount cannot exceed the line value.");
  }
  if (compare(discount, decimal("0", MONEY_SCALE)) < 0) {
    throw new DecimalError("A line discount cannot be negative.");
  }

  const total = add(subtract(goods, discount), add(charges, tax));

  return {
    goodsValue: format(goods, MONEY_SCALE),
    discount: format(discount, MONEY_SCALE),
    additionalCharges: format(charges, MONEY_SCALE),
    taxAmount: format(tax, MONEY_SCALE),
    lineTotal: format(total, MONEY_SCALE),
  };
}

/**
 * Documents totals from lines.
 *
 * `subtotal` mirrors the database: the sum of round(quantity × unit price, 2) *before* discounts,
 * because a printed order shows goods value, then discounts, then charges, then tax.
 */
export function documentTotals(lines: LineInput[], documentDiscount = "0"): DocumentTotals {
  let goods = decimal("0", MONEY_SCALE);
  let discounts = decimal("0", MONEY_SCALE);
  let charges = decimal("0", MONEY_SCALE);
  let taxes = decimal("0", MONEY_SCALE);

  for (const line of lines) {
    const totals = lineTotals(line);
    goods = add(goods, decimal(totals.goodsValue, MONEY_SCALE));
    discounts = add(discounts, decimal(totals.discount, MONEY_SCALE));
    charges = add(charges, decimal(totals.additionalCharges, MONEY_SCALE));
    taxes = add(taxes, decimal(totals.taxAmount, MONEY_SCALE));
  }

  const headerDiscount = money(documentDiscount);
  discounts = add(discounts, headerDiscount);

  const total = add(subtract(goods, discounts), add(charges, taxes));
  if (compare(total, decimal("0", MONEY_SCALE)) < 0) {
    throw new DecimalError("A document total cannot be negative.");
  }

  return {
    subtotal: format(goods, MONEY_SCALE),
    discountTotal: format(discounts, MONEY_SCALE),
    chargesTotal: format(charges, MONEY_SCALE),
    taxTotal: format(taxes, MONEY_SCALE),
    total: format(total, MONEY_SCALE),
  };
}

/**
 * Quotation totals, matching `private.recalculate_quotation_totals`:
 * total = lines − header discount + delivery charges + other charges.
 */
export function quotationTotals(
  lines: LineInput[],
  charges: { discount?: string; delivery?: string; other?: string } = {},
): DocumentTotals {
  let linesTotal = decimal("0", MONEY_SCALE);
  for (const line of lines) {
    linesTotal = add(linesTotal, decimal(lineTotals(line).lineTotal, MONEY_SCALE));
  }

  const discount = money(charges.discount ?? "0");
  const delivery = money(charges.delivery ?? "0");
  const other = money(charges.other ?? "0");

  const total = subtract(add(linesTotal, add(delivery, other)), discount);
  if (compare(total, decimal("0", MONEY_SCALE)) < 0) {
    throw new DecimalError("A quotation total cannot be negative.");
  }

  return {
    subtotal: format(linesTotal, MONEY_SCALE),
    discountTotal: format(discount, MONEY_SCALE),
    chargesTotal: format(add(delivery, other), MONEY_SCALE),
    taxTotal: format(decimal("0", MONEY_SCALE), MONEY_SCALE),
    total: format(total, MONEY_SCALE),
  };
}

export type ReceiptCheck = {
  ordered: string;
  previouslyReceived: string;
  outstanding: string;
  receiving: string;
  /** True when the receipt exceeds outstanding + tolerance. */
  exceedsOutstanding: boolean;
  /** True when the receipt is below the outstanding quantity (a short delivery). */
  isShort: boolean;
};

/**
 * Outstanding-quantity arithmetic for one receipt line.
 *
 * The tolerance is passed in rather than assumed: `procurement_settings` supplies it, and its
 * default is zero, so "no tolerance" is an explicit policy value rather than an accident.
 */
export function receiptCheck(params: {
  ordered: string;
  previouslyReceived: string;
  receiving: string;
  tolerancePercent?: string;
}): ReceiptCheck {
  const ordered = decimal(params.ordered, QUANTITY_SCALE);
  const previously = decimal(params.previouslyReceived, QUANTITY_SCALE);
  const receiving = decimal(params.receiving, QUANTITY_SCALE);

  const outstanding = subtract(ordered, previously);
  const tolerance = decimal(params.tolerancePercent ?? "0", 4);
  const allowed = add(outstanding, divide(multiply(outstanding, tolerance), decimal("100", 4), QUANTITY_SCALE));

  return {
    ordered: format(ordered, QUANTITY_SCALE),
    previouslyReceived: format(previously, QUANTITY_SCALE),
    outstanding: format(outstanding, QUANTITY_SCALE),
    receiving: format(receiving, QUANTITY_SCALE),
    exceedsOutstanding: compare(receiving, allowed) > 0,
    isShort: compare(receiving, outstanding) < 0,
  };
}

/**
 * Splits a received quantity into accepted, rejected and quarantined parts and refuses a split
 * that does not add up — the same invariant the database enforces with a CHECK constraint.
 */
export function receiptSplit(params: {
  received: string;
  accepted?: string;
  rejected?: string;
  quarantined?: string;
}): { accepted: string; rejected: string; quarantined: string; balanced: boolean } {
  const received = decimal(params.received, QUANTITY_SCALE);
  const accepted = decimal(params.accepted ?? "0", QUANTITY_SCALE);
  const rejected = decimal(params.rejected ?? "0", QUANTITY_SCALE);
  const quarantined = decimal(params.quarantined ?? "0", QUANTITY_SCALE);

  const sum = add(accepted, add(rejected, quarantined));

  return {
    accepted: format(accepted, QUANTITY_SCALE),
    rejected: format(rejected, QUANTITY_SCALE),
    quarantined: format(quarantined, QUANTITY_SCALE),
    balanced: compare(sum, received) === 0,
  };
}

/** Supplier advance balance: amount − confirmed applications. Pending applications do not count. */
export function advanceBalance(amount: string, confirmedApplications: string[]): string {
  let applied = decimal("0", MONEY_SCALE);
  for (const value of confirmedApplications) applied = add(applied, money(value));
  const balance = subtract(money(amount), applied);
  if (compare(balance, decimal("0", MONEY_SCALE)) < 0) {
    throw new DecimalError("Applications cannot exceed the advance amount.");
  }
  return format(balance, MONEY_SCALE);
}

/** Read-only preview used by forms and list cells. */
export function previewTotals(lines: LineInput[], documentDiscount?: string): DocumentTotals | null {
  try {
    return documentTotals(lines, documentDiscount);
  } catch {
    return null;
  }
}

export function isZeroAmount(value: string): boolean {
  try {
    return isZero(money(value));
  } catch {
    return true;
  }
}

export { toDisplayString };
