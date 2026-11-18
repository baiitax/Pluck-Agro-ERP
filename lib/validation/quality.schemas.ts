import { z } from "zod";

import { isoDateField, optionalIsoDate, optionalText, reasonField, uuidField } from "@/lib/validation/common";

/**
 * Quality validation schemas.
 *
 * Two habits carried over deliberately from Phase 4:
 *
 *  1. **A measurement is text until PostgreSQL casts it.** A moisture reading of 12.345678 must not pass through a
 *     binary float on its way to a NUMERIC column, so `measurementField` validates the shape and passes the string
 *     through untouched.
 *  2. **Nothing here decides a limit or an approval.** These schemas check that a person typed something plausible;
 *     the specification's own limits, the conformance computation and the lifecycle guard all run in the database
 *     inside the transaction.
 */

const optionalMeasurement = z
  .union([
    z
      .string()
      .trim()
      .regex(/^-?\d+(\.\d{1,6})?$/, "Use a number with at most 6 decimal places"),
    z.literal(""),
  ])
  .optional();

const quantityField = z
  .string()
  .trim()
  .min(1, "Enter a quantity")
  .regex(/^\d+(\.\d{1,6})?$/, "Use a positive number with at most 6 decimal places")
  .refine((value) => Number(value) > 0, "Quantity must be greater than zero");

const optionalQuantity = z.union([quantityField, z.literal("")]).optional();

export const parameterCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,48}$/, "Use lower-case letters, digits and underscores, starting with a letter"),
  name: z.string().trim().min(2, "Give the parameter a name").max(120),
  resultType: z.enum(["numeric", "text", "pass_fail", "observation"]),
  unitId: z.union([uuidField, z.literal("")]).optional(),
  methodReference: optionalText(200),
  description: optionalText(500),
});

export const samplingPlanCreateSchema = z.object({
  name: z.string().trim().min(3, "Give the plan a name").max(120),
  productId: z.union([uuidField, z.literal("")]).optional(),
  stage: z.enum(["incoming", "in_process", "finished", "pre_dispatch", "storage"]),
  basis: z.enum(["percentage", "fixed"]),
  percentage: optionalMeasurement,
  fixedQuantity: optionalQuantity,
  unitId: z.union([uuidField, z.literal("")]).optional(),
  notes: optionalText(500),
});

export const specificationCreateSchema = z.object({
  productId: uuidField,
  stage: z.enum(["incoming", "in_process", "finished", "pre_dispatch", "storage"]),
  title: optionalText(200),
  methodReference: optionalText(200),
  notes: optionalText(1000),
});

/**
 * One line of a specification. `parameterId` may be an existing catalogue code or a new parameter created in the
 * same submission; the service resolves it before writing.
 */
export const specificationLineSchema = z.object({
  parameterId: uuidField,
  minValue: optionalMeasurement,
  maxValue: optionalMeasurement,
  targetValue: optionalMeasurement,
  expectedText: optionalText(120),
  unitId: z.union([uuidField, z.literal("")]).optional(),
  isMandatory: z.union([z.literal("on"), z.literal("off"), z.literal("")]).optional(),
  criticality: z.enum(["critical", "major", "minor"]),
  methodReference: optionalText(200),
  notes: optionalText(300),
});

export const specificationApproveSchema = z.object({
  specificationId: uuidField,
  reason: optionalText(500),
});

export const inspectionCreateSchema = z.object({
  specificationId: uuidField,
  lotId: uuidField,
  inspectionType: z.enum(["routine", "incoming", "in_process", "final", "pre_dispatch", "retest", "investigation"]),
  samplingPlanId: z.union([uuidField, z.literal("")]).optional(),
  sampledQuantity: optionalQuantity,
  sampleUnitId: z.union([uuidField, z.literal("")]).optional(),
  notes: optionalText(1000),
});

export const sampleCreateSchema = z.object({
  inspectionId: uuidField,
  quantity: quantityField,
  unitId: uuidField,
  locationNote: optionalText(200),
  notes: optionalText(500),
});

export const resultRecordSchema = z.object({
  inspectionId: uuidField,
  specificationParameterId: uuidField,
  valueNumeric: optionalMeasurement,
  valueText: optionalText(120),
  notes: optionalText(300),
});

export const inspectionDecisionSchema = z.object({
  inspectionId: uuidField,
  reason: optionalText(500),
});

export const dispositionSchema = z.object({
  inspectionId: uuidField,
  disposition: z.enum(["release", "reject", "hold", "rework", "downgrade", "quarantine"]),
  reason: reasonField(500),
  quantity: optionalQuantity,
  instruction: optionalText(500),
  nextReviewDate: optionalIsoDate,
});

export const dispositionRevokeSchema = z.object({
  dispositionId: uuidField,
  reason: reasonField(500),
});

export const holdPlaceSchema = z.object({
  lotId: uuidField,
  quantity: quantityField,
  reasonCode: z.string().trim().min(2, "Give a short code for the hold").max(60),
  reason: reasonField(500),
  inspectionId: z.union([uuidField, z.literal("")]).optional(),
});

export const holdReleaseSchema = z.object({
  holdId: uuidField,
  quantity: optionalQuantity,
  reason: reasonField(500),
});

export const ncrCreateSchema = z.object({
  title: z.string().trim().min(5, "Give the non-conformance a title").max(200),
  description: z.string().trim().min(20, "Describe what happened, in at least 20 characters").max(4000),
  severity: z.enum(["critical", "major", "minor", "observation"]),
  source: z.enum(["inspection", "supplier", "internal", "customer_complaint", "audit", "deviation"]),
  inspectionId: z.union([uuidField, z.literal("")]).optional(),
  lotId: z.union([uuidField, z.literal("")]).optional(),
  supplierId: z.union([uuidField, z.literal("")]).optional(),
  containmentAction: optionalText(2000),
});

export const ncrUpdateSchema = z.object({
  ncrId: uuidField,
  severity: z.enum(["critical", "major", "minor", "observation"]).optional(),
  rootCause: optionalText(4000),
  containmentAction: optionalText(2000),
  status: z.enum(["investigating"]).optional(),
  statusReason: optionalText(500),
});

export const ncrCloseSchema = z.object({
  ncrId: uuidField,
  rootCause: optionalText(4000),
  reason: reasonField(500),
});

export const capaCreateSchema = z.object({
  ncrId: z.union([uuidField, z.literal("")]).optional(),
  actionType: z.enum(["corrective", "preventive"]),
  title: z.string().trim().min(5, "Give the action a title").max(200),
  description: z.string().trim().min(10, "Describe the action").max(4000),
  ownerEmployeeId: z.union([uuidField, z.literal("")]).optional(),
  dueDate: optionalIsoDate,
});

export const capaUpdateSchema = z.object({
  actionId: uuidField,
  status: z.enum(["in_progress", "completed", "cancelled"]),
  statusReason: optionalText(500),
});

export const capaVerifySchema = z.object({
  actionId: uuidField,
  notes: z.string().trim().min(20, "Describe the evidence that the action worked").max(2000),
});

export const certificateIssueSchema = z.object({
  inspectionId: uuidField,
  issuedTo: optionalText(200),
  customerId: z.union([uuidField, z.literal("")]).optional(),
  remarks: optionalText(1000),
  laboratoryName: optionalText(200),
  accreditationReference: optionalText(200),
});

export const certificateVoidSchema = z.object({
  certificateId: uuidField,
  reason: reasonField(500),
});

export const inspectionFilterSchema = z.object({
  status: optionalText(40),
  stage: optionalText(40),
  page: z.string().optional(),
});

export const qualityDateRangeSchema = z.object({
  from: isoDateField.optional(),
  to: isoDateField.optional(),
});
