import { z } from "zod";

import { isoDateField, optionalIsoDate, optionalText, reasonField, uuidField } from "@/lib/validation/common";

/**
 * Inventory and production validation schemas.
 *
 * Quantities arrive as strings and stay strings all the way to PostgreSQL NUMERIC: the form validates the
 * shape, the service passes the text through, and the database casts it exactly. Nothing here converts a
 * quantity to a JavaScript number, because 0.1 + 0.2 does not equal 0.3 and a stock ledger cannot afford to
 * rediscover that.
 *
 * These schemas are the first of three checks. The lifecycle triggers, the availability functions and the
 * ledger's own constraints are the second and third, and they run inside the transaction.
 */

const quantityField = z
  .string()
  .trim()
  .min(1, "Enter a quantity")
  .regex(/^\d+(\.\d{1,6})?$/, "Use a positive number with at most 6 decimal places")
  .refine((value) => Number(value) > 0, "Quantity must be greater than zero");

/** Signed, for adjustment lines whose whole purpose is to state a direction. */
const signedQuantityField = z
  .string()
  .trim()
  .min(1, "Enter a quantity")
  .regex(/^-?\d+(\.\d{1,6})?$/, "Use a number with at most 6 decimal places, optionally negative")
  .refine((value) => Number(value) !== 0, "A quantity change cannot be zero");

export const lotCreateSchema = z.object({
  productId: uuidField,
  unitId: uuidField,
  warehouseId: uuidField,
  locationId: z.union([uuidField, z.literal("")]).optional(),
  receivedDate: isoDateField,
  manufactureDate: optionalIsoDate,
  expiryDate: optionalIsoDate,
  grade: optionalText(60),
  notes: optionalText(500),
  openingQuantity: z
    .string()
    .trim()
    .regex(/^\d*(\.\d{1,6})?$/, "Use a number with at most 6 decimal places")
    .optional(),
});

export const restrictionSchema = z.object({
  lotId: uuidField,
  quantity: quantityField,
  restrictionType: z.enum(["hold", "quarantine", "recall", "count_freeze", "pending_inspection"]),
  reasonCode: z.string().trim().min(2, "Give a short code for why stock is being held").max(60),
  reason: reasonField(500),
  expiresAt: optionalText(40),
});

export const restrictionReleaseSchema = z.object({
  restrictionId: uuidField,
  quantity: quantityField,
  reason: reasonField(500),
});

export const reservationSchema = z.object({
  lotId: uuidField,
  quantity: quantityField,
  reservedForModule: z.string().trim().min(2).max(40),
  reservedForType: z.string().trim().min(2).max(60),
  reservedForReference: optionalText(120),
  notes: optionalText(500),
});

export const reservationReleaseSchema = z.object({
  reservationId: uuidField,
  quantity: quantityField,
  reason: reasonField(500),
});

export const transferItemSchema = z.object({
  lotId: uuidField,
  quantity: quantityField,
});

export const transferCreateSchema = z.object({
  fromWarehouseId: uuidField,
  toWarehouseId: uuidField,
  transferReason: optionalText(200),
  vehicleReference: optionalText(120),
  notes: optionalText(500),
  items: z.array(transferItemSchema).min(1, "Add at least one lot to transfer"),
});

export const transferDecisionSchema = z.object({
  transferId: uuidField,
  decision: z.enum(["approved", "rejected"]),
  reason: optionalText(500),
});

export const countStartSchema = z.object({
  warehouseId: uuidField,
  locationId: z.union([uuidField, z.literal("")]).optional(),
  countDate: isoDateField,
  notes: optionalText(500),
});

export const countLineSchema = z.object({
  lineId: uuidField,
  countedQuantity: z
    .string()
    .trim()
    .regex(/^\d*(\.\d{1,6})?$/, "Use zero or a number with at most 6 decimal places"),
  notes: optionalText(500),
});

export const countDecisionSchema = z.object({
  countId: uuidField,
  decision: z.enum(["approved", "rejected"]),
  reason: optionalText(500),
});

export const adjustmentItemSchema = z.object({
  lotId: uuidField,
  quantityChange: signedQuantityField,
  reason: optionalText(500),
});

export const adjustmentCreateSchema = z.object({
  warehouseId: uuidField,
  adjustmentDate: isoDateField,
  reasonCode: z.string().trim().min(2, "Give a short reason code").max(60),
  reason: reasonField(500),
  notes: optionalText(500),
  items: z.array(adjustmentItemSchema).min(1, "Add at least one line"),
});

export const adjustmentDecisionSchema = z.object({
  adjustmentId: uuidField,
  decision: z.enum(["approved", "rejected"]),
  reason: optionalText(500),
});

// ---------------------------------------------------------------- production

export const planCreateSchema = z.object({
  productId: uuidField,
  unitId: uuidField,
  warehouseId: uuidField,
  plannedQuantity: quantityField,
  plannedDate: isoDateField,
  plannedEndDate: optionalIsoDate,
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  source: z.enum(["manual", "sales_order", "stock_shortfall", "rework"]).optional(),
  sourceReference: optionalText(120),
  notes: optionalText(500),
  applyDeclaredInputs: z.union([z.literal("on"), z.literal("")]).optional(),
});

export const planDecisionSchema = z.object({
  planId: uuidField,
  decision: z.enum(["approved", "rejected"]),
  reason: optionalText(500),
});

export const planReserveSchema = z.object({
  planId: uuidField,
  lotId: uuidField,
  quantity: quantityField,
  notes: optionalText(500),
});

export const batchStartSchema = z.object({
  planId: z.union([uuidField, z.literal("")]).optional(),
  productId: z.union([uuidField, z.literal("")]).optional(),
  plannedQuantity: z
    .string()
    .trim()
    .regex(/^\d*(\.\d{1,6})?$/, "Use a number with at most 6 decimal places")
    .optional(),
  unitId: z.union([uuidField, z.literal("")]).optional(),
  warehouseId: z.union([uuidField, z.literal("")]).optional(),
  batchDate: optionalIsoDate,
  notes: optionalText(500),
});

export const issueMaterialSchema = z.object({
  batchId: uuidField,
  lotId: uuidField,
  quantity: quantityField,
  notes: optionalText(500),
});

export const recordOutputSchema = z.object({
  batchId: uuidField,
  quantity: quantityField,
  outputType: z.enum(["main", "by_product", "waste"]),
  productId: z.union([uuidField, z.literal("")]).optional(),
  unitId: z.union([uuidField, z.literal("")]).optional(),
  locationId: z.union([uuidField, z.literal("")]).optional(),
  manufactureDate: optionalIsoDate,
  expiryDate: optionalIsoDate,
  grade: optionalText(60),
  notes: optionalText(500),
});

export const closeBatchSchema = z.object({
  batchId: uuidField,
  reason: optionalText(500),
});

export const batchLogSchema = z.object({
  batchId: uuidField,
  body: z.string().trim().min(3, "Write what happened").max(2000),
  logType: z.enum(["note", "downtime", "issue", "observation", "handover"]).optional(),
  shift: z.union([z.enum(["morning", "afternoon", "night", "full_day"]), z.literal("")]).optional(),
});

export const stageCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,15}$/, "Use 2–16 characters: letters, digits or underscore, starting with a letter"),
  name: z.string().trim().min(2, "Give the stage a name").max(120),
  sequence: z
    .string()
    .trim()
    .regex(/^\d{1,4}$/, "Use a whole number")
    .refine((value) => Number(value) > 0, "Sequence must be greater than zero"),
  description: optionalText(500),
});

export const processSchema = z.object({
  productId: uuidField,
  stageId: uuidField,
  sequence: z
    .string()
    .trim()
    .regex(/^\d{1,4}$/, "Use a whole number")
    .refine((value) => Number(value) > 0, "Sequence must be greater than zero"),
  expectedDurationHours: z
    .string()
    .trim()
    .regex(/^\d*(\.\d{1,2})?$/, "Use hours with at most 2 decimal places")
    .optional(),
  instructions: optionalText(1000),
});

export const declaredInputSchema = z.object({
  productId: uuidField,
  inputProductId: uuidField,
  unitId: uuidField,
  quantity: quantityField,
  basisQuantity: quantityField,
  isOptional: z.union([z.literal("on"), z.literal("")]).optional(),
  notes: optionalText(500),
});

export const yieldRuleSchema = z.object({
  productId: uuidField,
  basis: z.enum(["output_over_input", "stated"]),
  minPercent: z
    .string()
    .trim()
    .regex(/^\d*(\.\d{1,3})?$/, "Use a percentage with at most 3 decimal places")
    .optional(),
  maxPercent: z
    .string()
    .trim()
    .regex(/^\d*(\.\d{1,3})?$/, "Use a percentage with at most 3 decimal places")
    .optional(),
  effectiveFrom: isoDateField,
  notes: optionalText(500),
});
