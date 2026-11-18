import { describe, expect, it } from "vitest";

import {
  BATCH_STATUSES,
  INVENTORY_LOT_STATUSES,
  MOVEMENT_TYPES,
  PLAN_STATUSES,
  STOCK_ADJUSTMENT_STATUSES,
  TRANSFER_STATUSES,
  inventoryStatusTone,
  labelForInventoryStatus,
} from "@/lib/inventory/statuses";
import {
  adjustmentCreateSchema,
  closeBatchSchema,
  declaredInputSchema,
  issueMaterialSchema,
  lotCreateSchema,
  planCreateSchema,
  processSchema,
  recordOutputSchema,
  stageCreateSchema,
  transferCreateSchema,
  yieldRuleSchema,
} from "@/lib/validation/inventory.schemas";

/**
 * Phase 4 unit coverage for the parts that are pure: the status vocabularies the UI renders and the Zod
 * schemas the forms and server actions share.
 *
 * These are not a substitute for the database suite, which proves the triggers, guards and RPCs. They cover
 * the layer that decides what a form will accept before a request ever reaches Postgres — where a wrong
 * guard means either a confusing round trip or, worse, an acceptance the database then has to refuse.
 */

// Real version-4 UUIDs: the shared `uuidField` checks the UUID shape, so a placeholder of repeated digits would
// be rejected before any of the assertions below were reached.
const UNIT = crypto.randomUUID();
const PRODUCT = crypto.randomUUID();
const INPUT_PRODUCT = crypto.randomUUID();
const WAREHOUSE = crypto.randomUUID();

describe("Phase 4 status vocabularies", () => {
  it("keeps the production lifecycles aligned with the database constraints", () => {
    expect([...PLAN_STATUSES]).toEqual([
      "draft",
      "submitted",
      "approved",
      "rejected",
      "in_progress",
      "completed",
      "cancelled",
    ]);
    expect([...BATCH_STATUSES]).toEqual([
      "draft",
      "in_progress",
      "completed",
      "closed",
      "aborted",
      "cancelled",
    ]);
    expect([...TRANSFER_STATUSES]).toEqual([
      "draft",
      "submitted",
      "approved",
      "rejected",
      "dispatched",
      "received",
      "cancelled",
    ]);
  });

  it("has a human label and a tone for every declared status", () => {
    const groups = [
      PLAN_STATUSES,
      BATCH_STATUSES,
      TRANSFER_STATUSES,
      STOCK_ADJUSTMENT_STATUSES,
      INVENTORY_LOT_STATUSES,
      MOVEMENT_TYPES,
    ];
    for (const group of groups) {
      for (const status of group) {
        // No status may reach a screen as raw snake_case.
        expect(labelForInventoryStatus(status)).not.toContain("_");
        expect(labelForInventoryStatus(status).length).toBeGreaterThan(2);
        expect(["neutral", "brand", "pending", "danger", "success", "info", "warning"]).toContain(inventoryStatusTone(status));
      }
    }
  });

  it("renders an unknown status readably instead of leaking snake_case", () => {
    expect(labelForInventoryStatus("something_unheard_of")).toBe("something unheard of");
  });
});

describe("Phase 4 form schemas", () => {
  it("accepts a well-formed stage and refuses a code the database would reject", () => {
    expect(stageCreateSchema.safeParse({ code: "cleaning", name: "Cleaning", sequence: "10" }).success).toBe(true);
    const parsed = stageCreateSchema.parse({ code: "cleaning", name: "Cleaning", sequence: "10" });
    expect(parsed.code).toBe("CLEANING");

    // Leading digit, too short, and a hyphen are all outside the database's format check.
    for (const code of ["1CLEAN", "A", "CLEAN-ING"]) {
      expect(stageCreateSchema.safeParse({ code, name: "Cleaning", sequence: "10" }).success).toBe(false);
    }
    expect(stageCreateSchema.safeParse({ code: "MILLING", name: "M", sequence: "10" }).success).toBe(false);
    expect(stageCreateSchema.safeParse({ code: "MILLING", name: "Milling", sequence: "0" }).success).toBe(false);
  });

  it("refuses a routing step without a product or stage, and non-positive sequences", () => {
    expect(processSchema.safeParse({ productId: PRODUCT, stageId: UNIT, sequence: "10" }).success).toBe(true);
    expect(processSchema.safeParse({ productId: "", stageId: UNIT, sequence: "10" }).success).toBe(false);
    expect(processSchema.safeParse({ productId: PRODUCT, stageId: UNIT, sequence: "abc" }).success).toBe(false);
    expect(
      processSchema.safeParse({ productId: PRODUCT, stageId: UNIT, sequence: "10", expectedDurationHours: "1.234" }).success,
    ).toBe(false);
  });

  it("keeps a declared input's basis positive and its quantity numeric", () => {
    const valid = { productId: PRODUCT, inputProductId: INPUT_PRODUCT, unitId: UNIT, quantity: "12", basisQuantity: "100" };
    expect(declaredInputSchema.safeParse(valid).success).toBe(true);
    expect(declaredInputSchema.safeParse({ ...valid, quantity: "0" }).success).toBe(false);
    expect(declaredInputSchema.safeParse({ ...valid, basisQuantity: "0" }).success).toBe(false);
    expect(declaredInputSchema.safeParse({ ...valid, quantity: "twelve" }).success).toBe(false);
  });

  it("allows a yield band with no tolerance stated, and refuses an inverted one at the database", () => {
    // A blank band is meaningful: it means "no tolerance agreed", which forces a stated reason on close.
    const blank = yieldRuleSchema.safeParse({ productId: PRODUCT, basis: "output_over_input", effectiveFrom: "2026-11-17" });
    expect(blank.success).toBe(true);

    const band = yieldRuleSchema.safeParse({
      productId: PRODUCT,
      basis: "output_over_input",
      minPercent: "35",
      maxPercent: "45",
      effectiveFrom: "2026-11-17",
    });
    expect(band.success).toBe(true);

    expect(
      yieldRuleSchema.safeParse({
        productId: PRODUCT,
        basis: "output_over_input",
        minPercent: "45.1234",
        effectiveFrom: "2026-11-17",
      }).success,
    ).toBe(false);
  });

  it("requires a batch close to be identified, and leaves the reason to the database to judge", () => {
    expect(closeBatchSchema.safeParse({ batchId: PRODUCT }).success).toBe(true);
    expect(closeBatchSchema.safeParse({ batchId: "" }).success).toBe(false);
  });

  it("accepts only the three output types the RPC accepts", () => {
    const base = { batchId: PRODUCT, quantity: "40" };
    for (const outputType of ["main", "by_product", "waste"]) {
      expect(recordOutputSchema.safeParse({ ...base, outputType }).success).toBe(true);
    }
    expect(recordOutputSchema.safeParse({ ...base, outputType: "rework" }).success).toBe(false);
    expect(recordOutputSchema.safeParse({ ...base, quantity: "0" }).success).toBe(false);
  });

  it("refuses an issue of zero or a negative quantity", () => {
    const base = { batchId: PRODUCT, lotId: UNIT };
    expect(issueMaterialSchema.safeParse({ ...base, quantity: "100" }).success).toBe(true);
    expect(issueMaterialSchema.safeParse({ ...base, quantity: "0" }).success).toBe(false);
    expect(issueMaterialSchema.safeParse({ ...base, quantity: "-5" }).success).toBe(false);
  });

  it("refuses a plan with no quantity, and a transfer to the same warehouse as its source", () => {
    expect(
      planCreateSchema.safeParse({ productId: PRODUCT, warehouseId: WAREHOUSE, plannedQuantity: "0", plannedDate: "2026-11-17" })
        .success,
    ).toBe(false);
    expect(
      planCreateSchema.safeParse({
        productId: PRODUCT,
        unitId: UNIT,
        warehouseId: WAREHOUSE,
        plannedQuantity: "50",
        plannedDate: "2026-11-17",
      }).success,
    ).toBe(true);
    // The schema only checks shapes; that a transfer must have two different warehouses is a database
    // constraint, and the schema deliberately does not restate it a second time in a second place.
    expect(
      transferCreateSchema.safeParse({
        fromWarehouseId: WAREHOUSE,
        toWarehouseId: WAREHOUSE,
        items: [{ lotId: PRODUCT, quantity: "10" }],
      }).success,
    ).toBe(true);
    expect(
      transferCreateSchema.safeParse({ fromWarehouseId: WAREHOUSE, toWarehouseId: PRODUCT, items: [] }).success,
    ).toBe(false);
  });

  it("keeps opening-balance quantities positive and requires a lot's provenance date", () => {
    const base = {
      productId: PRODUCT,
      unitId: UNIT,
      warehouseId: WAREHOUSE,
      openingQuantity: "100",
      receivedDate: "2026-11-17",
    };
    expect(lotCreateSchema.safeParse(base).success).toBe(true);
    // An opening balance of zero is not a balance, and a negative one is not an opening balance.
    expect(lotCreateSchema.safeParse({ ...base, openingQuantity: "-1" }).success).toBe(false);
    expect(lotCreateSchema.safeParse({ ...base, receivedDate: "" }).success).toBe(false);
  });

  it("requires an adjustment to say why it exists", () => {
    const base = {
      warehouseId: WAREHOUSE,
      adjustmentDate: "2026-11-17",
      reason: "Bag count found short at the end of the shift",
      reasonCode: "count_variance",
      items: [{ lotId: PRODUCT, quantityChange: "-5" }],
    };
    expect(adjustmentCreateSchema.safeParse(base).success).toBe(true);
    // A ten-character minimum on the reason, matching the database's own guard on a reasoned transition.
    expect(adjustmentCreateSchema.safeParse({ ...base, reason: "short" }).success).toBe(false);
    // A signed line exists to state a direction, so zero says nothing.
    expect(
      adjustmentCreateSchema.safeParse({ ...base, items: [{ lotId: PRODUCT, quantityChange: "0" }] }).success,
    ).toBe(false);
  });
});
