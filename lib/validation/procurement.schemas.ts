import { z } from "zod";

import {
  currencyField,
  isoDateField,
  optionalIsoDate,
  optionalText,
  reasonField,
  uuidField,
} from "@/lib/validation/common";

/**
 * Procurement validation schemas.
 *
 * Server-side validation is repeated at the transaction boundary: the same schema guards the form
 * and the service call, and the database enforces the invariants again (status edges, quantity
 * splits, outstanding quantities). A form is a convenience, never the control.
 *
 * Quantities and prices arrive as strings and stay strings: they are handed to the decimal helpers
 * and then to PostgreSQL NUMERIC, so a value like 0.1 + 0.2 can never appear.
 */

const quantityField = z
  .string()
  .trim()
  .min(1, "Enter a quantity")
  .regex(/^\d+(\.\d{1,6})?$/, "Use a positive number with at most 6 decimal places")
  .refine((value) => Number(value) > 0, "Quantity must be greater than zero");

const zeroOrQuantityField = z
  .string()
  .trim()
  .regex(/^\d*(\.\d{1,6})?$/, "Use a number with at most 6 decimal places")
  .transform((value) => (value === "" ? "0" : value));

const priceField = z
  .string()
  .trim()
  .min(1, "Enter a unit price")
  .regex(/^\d+(\.\d{1,4})?$/, "Use a number with at most 4 decimal places");

const zeroOrPriceField = z
  .string()
  .trim()
  .regex(/^\d*(\.\d{1,2})?$/, "Use an amount with at most 2 decimal places")
  .transform((value) => (value === "" ? "0" : value));

// ---------------------------------------------------------------- requisitions

export const requisitionItemSchema = z.object({
  productId: uuidField,
  quantity: quantityField,
  unitId: uuidField,
  estimatedUnitPrice: z.union([priceField, z.literal("")]).optional(),
  specificationNotes: optionalText(1000),
});

export const requisitionCreateSchema = z.object({
  departmentId: uuidField,
  requestingEmployeeId: uuidField,
  requisitionDate: isoDateField,
  requiredDeliveryDate: isoDateField,
  purpose: z.string().trim().min(3, "State the purpose of the request").max(500),
  justification: optionalText(2000),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  currencyCode: currencyField,
  preferredSupplierId: z.union([uuidField, z.literal("")]).optional(),
  suggestedWarehouseId: z.union([uuidField, z.literal("")]).optional(),
  notes: optionalText(2000),
  items: z.array(requisitionItemSchema).min(1, "Add at least one line"),
});

export const requisitionUpdateSchema = requisitionCreateSchema;

export const statusChangeSchema = z.object({
  status: z.string().trim().min(1, "Choose a status"),
  reason: z.string().trim().max(2000).optional(),
  comment: optionalText(2000),
});

// ---------------------------------------------------------------- quotations

export const quotationItemSchema = z.object({
  productId: uuidField,
  quantity: quantityField,
  unitId: uuidField,
  unitPrice: priceField,
  discountAmount: zeroOrPriceField.optional(),
  notes: optionalText(500),
});

export const quotationCreateSchema = z.object({
  supplierId: uuidField,
  requisitionId: z.union([uuidField, z.literal("")]).optional(),
  quotationRequestId: z.union([uuidField, z.literal("")]).optional(),
  supplierQuotationReference: optionalText(120),
  quotationDate: isoDateField,
  validUntil: optionalIsoDate,
  currencyCode: currencyField,
  paymentTermsId: z.union([uuidField, z.literal("")]).optional(),
  deliveryTermsId: z.union([uuidField, z.literal("")]).optional(),
  deliveryLeadTimeDays: z
    .string()
    .trim()
    .regex(/^\d{0,4}$/, "Use a whole number of days")
    .optional(),
  proposedDeliveryDate: optionalIsoDate,
  discountAmount: zeroOrPriceField.optional(),
  deliveryCharges: zeroOrPriceField.optional(),
  otherCharges: zeroOrPriceField.optional(),
  chargeNotes: optionalText(500),
  remarks: optionalText(2000),
  items: z.array(quotationItemSchema).min(1, "Add at least one line"),
});

export const comparisonCreateSchema = z.object({
  requisitionId: z.union([uuidField, z.literal("")]).optional(),
  title: z.string().trim().min(3, "Give the comparison a title").max(200),
  currencyNote: optionalText(300),
  notes: optionalText(2000),
  quotationIds: z.array(uuidField).min(2, "Compare at least two quotations"),
});

export const selectionSchema = z.object({
  comparisonId: uuidField,
  selectedQuotationId: uuidField,
  justification: reasonField(2000),
});

// ---------------------------------------------------------------- purchase orders

export const purchaseOrderItemSchema = z.object({
  productId: uuidField,
  quantity: quantityField,
  unitId: uuidField,
  unitPrice: priceField,
  discountAmount: zeroOrPriceField.optional(),
  additionalCharges: zeroOrPriceField.optional(),
  taxCategoryId: z.union([uuidField, z.literal("")]).optional(),
  taxAmount: zeroOrPriceField.optional(),
  specificationNotes: optionalText(1000),
  requisitionItemId: z.union([uuidField, z.literal("")]).optional(),
});

export const purchaseOrderCreateSchema = z.object({
  supplierId: uuidField,
  selectedQuotationId: z.union([uuidField, z.literal("")]).optional(),
  selectionId: z.union([uuidField, z.literal("")]).optional(),
  orderDate: isoDateField,
  expectedDeliveryDate: optionalIsoDate,
  currencyCode: currencyField,
  exchangeRate: z
    .string()
    .trim()
    .regex(/^\d{0,10}(\.\d{1,10})?$/, "Use a rate with at most 10 decimal places")
    .optional(),
  paymentTermsId: z.union([uuidField, z.literal("")]).optional(),
  deliveryTermsId: z.union([uuidField, z.literal("")]).optional(),
  deliveryWarehouseId: z.union([uuidField, z.literal("")]).optional(),
  deliveryLocationId: z.union([uuidField, z.literal("")]).optional(),
  deliveryAddress: optionalText(500),
  procurementOfficerEmployeeId: z.union([uuidField, z.literal("")]).optional(),
  departmentId: z.union([uuidField, z.literal("")]).optional(),
  requisitionIds: z.array(uuidField).optional(),
  internalRemarks: optionalText(2000),
  supplierInstructions: optionalText(2000),
  items: z.array(purchaseOrderItemSchema).min(1, "Add at least one line"),
});

export const amendmentCreateSchema = z.object({
  reason: reasonField(2000),
  items: z
    .array(
      z.object({
        purchaseOrderItemId: z.union([uuidField, z.literal("")]).optional(),
        changeType: z.enum([
          "quantity",
          "unit_price",
          "product",
          "add_line",
          "remove_line",
          "delivery_date",
          "payment_terms",
          "delivery_terms",
          "destination",
          "other",
        ]),
        fieldName: optionalText(60),
        previousValue: optionalText(200),
        newValue: z.string().trim().min(1, "Enter the new value").max(200),
        productId: z.union([uuidField, z.literal("")]).optional(),
        quantity: z
          .string()
          .trim()
          .regex(/^\d*(\.\d{1,6})?$/, "Use a number with at most 6 decimal places")
          .optional(),
        unitId: z.union([uuidField, z.literal("")]).optional(),
        unitPrice: z
          .string()
          .trim()
          .regex(/^\d*(\.\d{1,4})?$/, "Use a number with at most 4 decimal places")
          .optional(),
      }),
    )
    .min(1, "Describe at least one change"),
});

// ---------------------------------------------------------------- goods receipts

export const goodsReceiptItemSchema = z.object({
  purchaseOrderItemId: uuidField,
  receivedQuantity: quantityField,
  acceptedQuantity: zeroOrQuantityField,
  rejectedQuantity: zeroOrQuantityField,
  quarantinedQuantity: zeroOrQuantityField,
  rejectionReason: optionalText(500),
  packagingDetails: optionalText(500),
  observations: optionalText(1000),
});

export const goodsReceiptCreateSchema = z.object({
  purchaseOrderId: uuidField,
  receiptDate: isoDateField,
  supplierDeliveryNoteNumber: optionalText(120),
  deliveryReference: optionalText(120),
  warehouseId: uuidField,
  locationId: z.union([uuidField, z.literal("")]).optional(),
  receivingEmployeeId: z.union([uuidField, z.literal("")]).optional(),
  vehicleReference: optionalText(120),
  transporterName: optionalText(200),
  observations: optionalText(2000),
  items: z.array(goodsReceiptItemSchema).min(1, "Record at least one received line"),
});

export const postingSchema = z.object({
  receiptId: uuidField,
  /** Supplied by the client so a retried submission cannot post twice. */
  idempotencyKey: z.string().trim().min(8, "A posting key is required").max(120),
  allowExcess: z.union([z.literal("on"), z.literal("")]).optional(),
});

export const inspectionSchema = z.object({
  goodsReceiptId: uuidField,
  goodsReceiptItemId: z.union([uuidField, z.literal("")]).optional(),
  inspectionType: z.enum(["quantity_and_condition", "quality", "documentation", "other"]),
  result: z.enum(["pending", "passed", "failed", "partial"]),
  quantityInspected: z
    .string()
    .trim()
    .regex(/^\d*(\.\d{1,6})?$/, "Use a number with at most 6 decimal places")
    .optional(),
  findings: reasonField(2000),
});

// ---------------------------------------------------------------- advances

export const advanceCreateSchema = z.object({
  supplierId: uuidField,
  advanceReference: optionalText(120),
  transactionDate: isoDateField,
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Use an amount with at most 2 decimal places")
    .refine((value) => Number(value) > 0, "The advance must be greater than zero"),
  currencyCode: currencyField,
  paymentMethod: z.enum(["bank_transfer", "cash", "cheque", "mobile_money", "offset", "other"]),
  purchaseOrderId: z.union([uuidField, z.literal("")]).optional(),
  purpose: optionalText(1000),
});

export const advancePaymentSchema = z.object({
  advanceId: uuidField,
  payingBankAccountId: z.union([uuidField, z.literal("")]).optional(),
  payingAccountNote: optionalText(200),
  paymentReference: z.string().trim().min(2, "Record the payment reference").max(120),
  treasuryConfirmationReference: z.string().trim().min(2, "Record the treasury reference").max(120),
  notes: optionalText(1000),
});

export const advanceApplicationSchema = z.object({
  advanceId: uuidField,
  targetType: z.enum(["supplier_invoice", "purchase_order", "credit_note", "other"]),
  targetReference: z.string().trim().min(2, "Record the document reference").max(120),
  appliedAmount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Use an amount with at most 2 decimal places")
    .refine((value) => Number(value) > 0, "The applied amount must be greater than zero"),
  notes: optionalText(1000),
});

// ---------------------------------------------------------------- reconciliation & documents

export const transactionReferenceSchema = z.object({
  supplierId: uuidField,
  transactionType: z.enum([
    "purchase_order",
    "goods_receipt",
    "supplier_advance",
    "supplier_payment",
    "credit_note",
    "adjustment",
    "supplier_invoice",
  ]),
  transactionReference: z.string().trim().min(2, "Record the reference").max(120),
  transactionDate: isoDateField,
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Use an amount with at most 2 decimal places"),
  currencyCode: currencyField,
  notes: optionalText(1000),
});

export const reconciliationSchema = z.object({
  supplierId: uuidField,
  periodStart: isoDateField,
  periodEnd: isoDateField,
  currencyCode: currencyField,
  notes: optionalText(2000),
});

export const documentSchema = z.object({
  entityType: z.enum([
    "purchase_requisition",
    "supplier_quotation",
    "purchase_order",
    "purchase_order_amendment",
    "goods_receipt",
    "supplier_advance",
    "supplier_reconciliation",
  ]),
  entityId: uuidField,
  documentType: z.enum([
    "quotation",
    "purchase_order",
    "delivery_note",
    "goods_receipt",
    "product_photo",
    "inspection",
    "payment_evidence",
    "correspondence",
    "other",
  ]),
  title: z.string().trim().min(2, "Give the document a title").max(200),
  fileName: z.string().trim().min(1, "Record the file name").max(255),
  mimeType: z.string().trim().min(3, "Record the content type").max(120),
  fileSizeBytes: z
    .string()
    .trim()
    .regex(/^\d{1,12}$/, "Record the file size in bytes"),
  storagePath: optionalText(500),
  notes: optionalText(1000),
});

export const commentSchema = z.object({
  entityType: z.enum([
    "purchase_requisition",
    "supplier_quotation",
    "purchase_order",
    "purchase_order_amendment",
    "goods_receipt",
    "supplier_advance",
    "supplier_reconciliation",
  ]),
  entityId: uuidField,
  body: z.string().trim().min(2, "Write a comment").max(4000),
  visibility: z.enum(["internal", "supplier_visible"]),
});

export type RequisitionCreateInput = z.infer<typeof requisitionCreateSchema>;
export type QuotationCreateInput = z.infer<typeof quotationCreateSchema>;
export type PurchaseOrderCreateInput = z.infer<typeof purchaseOrderCreateSchema>;
export type GoodsReceiptCreateInput = z.infer<typeof goodsReceiptCreateSchema>;
export type AdvanceCreateInput = z.infer<typeof advanceCreateSchema>;
