import { describe, expect, it } from "vitest";

import {
  advanceBalance,
  documentTotals,
  lineTotals,
  previewTotals,
  quotationTotals,
  receiptCheck,
  receiptSplit,
} from "@/lib/procurement/calc";
import {
  GOODS_RECEIPT_STATUSES,
  PURCHASE_ORDER_STATUSES,
  QUOTATION_STATUSES,
  REQUISITION_STATUSES,
  SUPPLIER_ADVANCE_STATUSES,
  isEditable,
  labelForStatus,
  procurementStatusTone,
} from "@/lib/procurement/statuses";
import {
  advanceApplicationSchema,
  amendmentCreateSchema,
  documentSchema,
  goodsReceiptCreateSchema,
  postingSchema,
  purchaseOrderCreateSchema,
  requisitionCreateSchema,
  selectionSchema,
} from "@/lib/validation/procurement.schemas";

/**
 * Procurement arithmetic and vocabulary.
 *
 * These tests exist because the two things most likely to go wrong silently in a procurement module
 * are money that drifts and a quantity that is rounded. The helpers under test are used by forms and
 * previews; the database recalculates every figure again in NUMERIC, so a disagreement between the
 * two would surface as a confusing mismatch rather than a wrong payment — but it would still be a
 * defect, hence the pinning here.
 */

describe("line and document arithmetic", () => {
  it("multiplies quantity by unit price without floating point drift", () => {
    // 0.1 × 3 is 0.30000000000000004 in IEEE-754 doubles.
    expect(lineTotals({ quantity: "0.1", unitPrice: "3" }).goodsValue).toBe("0.30");
    // 1.1 × 1.1 is 1.2100000000000002 in doubles.
    expect(lineTotals({ quantity: "1.1", unitPrice: "1.1" }).goodsValue).toBe("1.21");
    // 3333.333 kg at 0.07 rounds to the nearest kobo, never truncates.
    expect(lineTotals({ quantity: "3333.333", unitPrice: "0.07" }).goodsValue).toBe("233.33");
  });

  it("keeps a six-decimal quantity intact while rounding only the money", () => {
    const line = lineTotals({ quantity: "12000.123456", unitPrice: "465.4321" });
    // 12000.123456 × 465.4321 = 5,585,242.6574… → 5,585,242.66 (a float would end in …657399…)
    expect(line.goodsValue).toBe("5585242.66");
  });

  it("applies discounts and charges to the line total, and refuses a discount above value", () => {
    const line = lineTotals({
      quantity: "10",
      unitPrice: "100",
      discount: "50.50",
      additionalCharges: "20",
      taxAmount: "0",
    });
    expect(line.goodsValue).toBe("1000.00");
    expect(line.lineTotal).toBe("969.50");

    expect(() => lineTotals({ quantity: "1", unitPrice: "10", discount: "11" })).toThrow(
      /cannot exceed the line value/,
    );
    expect(() => lineTotals({ quantity: "1", unitPrice: "10", discount: "-1" })).toThrow(/cannot be negative/);
  });

  it("totals a document from its lines without losing a kobo", () => {
    const totals = documentTotals(
      [
        { quantity: "3", unitPrice: "0.1" },
        { quantity: "7", unitPrice: "0.33" },
      ],
      "0.01",
    );
    // 0.30 + 2.31 = 2.61, less a 0.01 document discount.
    expect(totals.subtotal).toBe("2.61");
    expect(totals.discountTotal).toBe("0.01");
    expect(totals.total).toBe("2.60");
  });

  it("refuses a document whose discounts exceed its value", () => {
    expect(() => documentTotals([{ quantity: "1", unitPrice: "10" }], "10.01")).toThrow(/cannot be negative/);
  });

  it("totals a quotation from lines, delivery and disclosed charges", () => {
    const totals = quotationTotals([{ quantity: "10000", unitPrice: "450" }], {
      delivery: "15000",
      other: "2500",
      discount: "500",
    });
    expect(totals.subtotal).toBe("4500000.00");
    expect(totals.chargesTotal).toBe("17500.00");
    expect(totals.discountTotal).toBe("500.00");
    expect(totals.total).toBe("4517000.00");
  });

  it("returns null from the preview helper instead of throwing into a render", () => {
    expect(previewTotals([{ quantity: "abc", unitPrice: "1" }])).toBeNull();
    expect(previewTotals([{ quantity: "2", unitPrice: "3" }])?.total).toBe("6.00");
  });
});

describe("receipt arithmetic", () => {
  it("reports outstanding quantity and flags a short delivery", () => {
    const check = receiptCheck({ ordered: "10000", previouslyReceived: "4000", receiving: "1000" });
    expect(check.outstanding).toBe("6000.000000");
    expect(check.exceedsOutstanding).toBe(false);
    expect(check.isShort).toBe(true);
  });

  it("treats the excess tolerance as policy, defaulting to none", () => {
    const strict = receiptCheck({ ordered: "100", previouslyReceived: "0", receiving: "100.5" });
    expect(strict.exceedsOutstanding).toBe(true);

    const tolerant = receiptCheck({
      ordered: "100",
      previouslyReceived: "0",
      receiving: "100.5",
      tolerancePercent: "1",
    });
    expect(tolerant.exceedsOutstanding).toBe(false);
  });

  it("requires accepted, rejected and quarantined to add up to what arrived", () => {
    const balanced = receiptSplit({ received: "100", accepted: "90", rejected: "5", quarantined: "5" });
    expect(balanced.balanced).toBe(true);

    const unbalanced = receiptSplit({ received: "100", accepted: "90", rejected: "5" });
    expect(unbalanced.balanced).toBe(false);
    expect(unbalanced.quarantined).toBe("0.000000");
  });
});

describe("advance balances", () => {
  it("reduces the balance by confirmed applications only", () => {
    expect(advanceBalance("2000000", ["500000"])).toBe("1500000.00");
    expect(advanceBalance("2000000", [])).toBe("2000000.00");
  });

  it("refuses applications above the advance", () => {
    expect(() => advanceBalance("100", ["100.01"])).toThrow(/cannot exceed/);
  });
});

describe("status vocabulary", () => {
  it("labels every status the database can return", () => {
    const all = [
      ...REQUISITION_STATUSES,
      ...QUOTATION_STATUSES,
      ...PURCHASE_ORDER_STATUSES,
      ...GOODS_RECEIPT_STATUSES,
      ...SUPPLIER_ADVANCE_STATUSES,
    ];
    for (const status of all) {
      const label = labelForStatus(status);
      expect(label, status).not.toBe(status);
      expect(label, status).not.toBe("—");
      expect(label, status).not.toMatch(/_/);
    }
  });

  it("falls back to a readable form for an unknown status instead of throwing", () => {
    expect(labelForStatus("some_new_state")).toBe("some new state");
    expect(labelForStatus(null)).toBe("—");
    expect(procurementStatusTone("some_new_state")).toBe("neutral");
  });

  it("tones terminal successes and failures differently", () => {
    expect(procurementStatusTone("issued")).toBe("success");
    expect(procurementStatusTone("posted")).toBe("success");
    expect(procurementStatusTone("rejected")).toBe("danger");
    expect(procurementStatusTone("returned")).toBe("warning");
    expect(procurementStatusTone("draft")).toBe("neutral");
  });

  it("only offers editing while the document is still a working copy", () => {
    expect(isEditable("draft", ["draft", "rejected"])).toBe(true);
    expect(isEditable("issued", ["draft", "rejected"])).toBe(false);
  });
});

describe("form validation", () => {
  const line = {
    productId: "2f1a3c6d-1b1f-4a3e-9c2f-8a7b6c5d4e3f",
    quantity: "10",
    unitId: "3f1a3c6d-1b1f-4a3e-9c2f-8a7b6c5d4e3f",
  };

  it("accepts a well-formed requisition", () => {
    const parsed = requisitionCreateSchema.safeParse({
      departmentId: "2f1a3c6d-1b1f-4a3e-9c2f-8a7b6c5d4e3f",
      requestingEmployeeId: "2f1a3c6d-1b1f-4a3e-9c2f-8a7b6c5d4e3f",
      requisitionDate: "2026-11-17",
      requiredDeliveryDate: "2026-12-01",
      purpose: "Maize for Q1 production",
      priority: "high",
      currencyCode: "ngn",
      items: [line],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.currencyCode).toBe("NGN");
  });

  it("rejects a negative, zero or over-precise quantity", () => {
    for (const quantity of ["-1", "0", "1.1234567", "ten"]) {
      const parsed = requisitionCreateSchema.safeParse({
        departmentId: crypto.randomUUID(),
        requestingEmployeeId: crypto.randomUUID(),
        requisitionDate: "2026-11-17",
        requiredDeliveryDate: "2026-12-01",
        purpose: "Maize",
        priority: "normal",
        currencyCode: "NGN",
        items: [{ ...line, quantity }],
      });
      expect(parsed.success, quantity).toBe(false);
    }
  });

  it("requires at least one line on a requisition and on an order", () => {
    const base = {
      departmentId: crypto.randomUUID(),
      requestingEmployeeId: crypto.randomUUID(),
      requisitionDate: "2026-11-17",
      requiredDeliveryDate: "2026-12-01",
      purpose: "Maize",
      priority: "normal" as const,
      currencyCode: "NGN",
      items: [],
    };
    expect(requisitionCreateSchema.safeParse(base).success).toBe(false);

    const order = purchaseOrderCreateSchema.safeParse({
      supplierId: crypto.randomUUID(),
      orderDate: "2026-11-17",
      currencyCode: "NGN",
      items: [],
    });
    expect(order.success).toBe(false);
  });

  it("accepts a receipt but insists the split is supplied as decimals", () => {
    const parsed = goodsReceiptCreateSchema.safeParse({
      purchaseOrderId: crypto.randomUUID(),
      receiptDate: "2026-11-17",
      warehouseId: crypto.randomUUID(),
      items: [
        {
          purchaseOrderItemId: crypto.randomUUID(),
          receivedQuantity: "100",
          acceptedQuantity: "90.5",
          rejectedQuantity: "5",
          quarantinedQuantity: "4.5",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("requires a postal key long enough to be unique, and a real justification", () => {
    expect(postingSchema.safeParse({ receiptId: crypto.randomUUID(), idempotencyKey: "short" }).success).toBe(false);
    expect(postingSchema.safeParse({ receiptId: crypto.randomUUID(), idempotencyKey: "grn-post-0001" }).success).toBe(
      true,
    );
    expect(
      selectionSchema.safeParse({
        comparisonId: crypto.randomUUID(),
        selectedQuotationId: crypto.randomUUID(),
        justification: "cheap",
      }).success,
    ).toBe(false);
  });

  it("requires a stated reason on an amendment", () => {
    const parsed = amendmentCreateSchema.safeParse({
      reason: "tweak",
      items: [{ changeType: "quantity", newValue: "12000" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses an application of zero to an advance", () => {
    const parsed = advanceApplicationSchema.safeParse({
      advanceId: crypto.randomUUID(),
      targetType: "supplier_invoice",
      targetReference: "INV-1",
      appliedAmount: "0",
    });
    expect(parsed.success).toBe(false);
  });

  it("validates document metadata without inventing a storage bucket", () => {
    const parsed = documentSchema.safeParse({
      entityType: "purchase_order",
      entityId: crypto.randomUUID(),
      documentType: "delivery_note",
      title: "Signed delivery note",
      fileName: "dn-001.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: "204800",
    });
    expect(parsed.success).toBe(true);

    expect(
      documentSchema.safeParse({
        entityType: "purchase_order",
        entityId: crypto.randomUUID(),
        documentType: "delivery_note",
        title: "Signed delivery note",
        fileName: "dn-001.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: "not-a-size",
      }).success,
    ).toBe(false);
  });
});
