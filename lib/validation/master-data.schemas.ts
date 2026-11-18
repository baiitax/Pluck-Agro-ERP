import { z } from "zod";

import {
  ADDRESS_TYPES,
  CUSTOMER_STATUSES,
  CUSTOMER_TYPES,
  EXCHANGE_RATE_STATUSES,
  EXCHANGE_RATE_TYPES,
  LOCATION_TYPES,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  SITE_TYPES,
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES,
  UNIT_CATEGORIES,
  WAREHOUSE_TYPES,
} from "@/lib/master-data/statuses";
import { currencyField, emailField, isoDateField, optionalIsoDate, optionalText, uuidField } from "@/lib/validation/common";

/** Shared helpers used across the master-data schemas. */
const optionalUuid = z.union([uuidField, z.literal("")]).optional().transform((value) => value || null);
const optionalEmail = z.union([emailField, z.literal("")]).optional().transform((value) => value || null);
const codeField = (pattern: RegExp, message: string, max = 40) =>
  z.string().trim().min(2, "At least 2 characters").max(max).regex(pattern, message);

const phoneField = z
  .string()
  .trim()
  .max(32)
  .refine((value) => value === "" || /^[+()\d][\d\s()+-]{5,}$/.test(value), "Enter a valid phone number")
  .optional()
  .transform((value) => value || null);

const websiteField = z
  .union([z.string().trim().url("Enter a full URL including https://"), z.literal("")])
  .optional()
  .transform((value) => value || null);

/** Decimal string with a maximum number of decimal places — never coerced through a float. */
export const decimalString = (options: { maxScale: number; max?: string; label: string; positive?: boolean }) =>
  z
    .union([z.string(), z.number()])
    .transform((value) => (typeof value === "number" ? value.toString() : value.trim()))
    .refine((value) => /^\d*(\.\d*)?$/.test(value) && value !== "" && value !== ".", `Enter a valid ${options.label}`)
    .refine((value) => {
      const [, fraction = ""] = value.split(".");
      return fraction.length <= options.maxScale;
    }, `Use at most ${options.maxScale} decimal place(s)`)
    .refine((value) => (options.positive ? Number(value) > 0 : true), `${options.label} must be greater than zero`);

// ---------------------------------------------------------------- categories
export const masterCategorySchema = z.object({
  id: z.string().optional(),
  code: codeField(/^[a-z][a-z0-9_]{1,39}$/, "Lower-case letters, numbers and underscores", 40),
  name: z.string().trim().min(2, "Enter a name").max(120),
  description: optionalText(400),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export const productCategorySchema = masterCategorySchema.extend({
  parentCategoryId: optionalUuid,
});

// ---------------------------------------------------------------- suppliers
export const supplierCreateSchema = z.object({
  legalName: z.string().trim().min(2, "Enter the legal name").max(200),
  tradingName: optionalText(200),
  supplierType: z.enum(SUPPLIER_TYPES),
  primaryCategoryId: optionalUuid,
  registrationNumber: optionalText(60),
  taxIdentificationNumber: optionalText(60),
  registrationCountry: optionalText(80),
  dateRegistered: optionalIsoDate,
  description: optionalText(1000),
  contactPerson: optionalText(120),
  contactPosition: optionalText(120),
  phone: phoneField,
  alternatePhone: phoneField,
  email: optionalEmail,
  website: websiteField,
  preferredChannel: z.enum(["phone", "email", "whatsapp", "in_person"]).optional(),
  preferredCurrencyCode: z.union([currencyField, z.literal("")]).optional().transform((value) => value || null),
  paymentTermsId: optionalUuid,
  deliveryTermsId: optionalUuid,
  internalReference: optionalText(60),
  procurementOfficerEmployeeId: optionalUuid,
  relationshipManagerEmployeeId: optionalUuid,
  onboardingDate: optionalIsoDate,
  riskCategory: optionalText(40),
  notes: optionalText(2000),
});

export const supplierUpdateSchema = supplierCreateSchema.extend({ id: uuidField });

export const supplierStatusSchema = z.object({
  id: uuidField,
  status: z.enum(SUPPLIER_STATUSES),
  reason: z.string().trim().max(500).optional(),
});

export const supplierVerifySchema = z.object({
  id: uuidField,
  verificationStatus: z.enum(["unverified", "pending", "verified", "failed"]),
  notes: z.string().trim().max(1000).optional(),
  verifiedOn: optionalIsoDate,
});

export const supplierContactSchema = z.object({
  id: z.string().optional(),
  supplierId: uuidField,
  name: z.string().trim().min(2, "Enter the contact name").max(160),
  position: optionalText(120),
  department: optionalText(120),
  phone: phoneField,
  alternatePhone: phoneField,
  email: optionalEmail,
  preferredChannel: z.enum(["phone", "email", "whatsapp", "in_person"]).optional(),
  isPrimary: z.boolean().optional(),
  notes: optionalText(500),
});

export const supplierAddressSchema = z.object({
  id: z.string().optional(),
  supplierId: uuidField,
  addressType: z.enum(ADDRESS_TYPES.supplier),
  label: optionalText(80),
  country: z.string().trim().min(2, "Enter the country").max(80),
  stateRegion: optionalText(80),
  localGovernment: optionalText(80),
  city: optionalText(80),
  street: optionalText(240),
  postalCode: optionalText(24),
  latitude: z.union([z.string(), z.number()]).optional(),
  longitude: z.union([z.string(), z.number()]).optional(),
  isPrimary: z.boolean().optional(),
});

export const supplierBankAccountSchema = z.object({
  id: z.string().optional(),
  supplierId: uuidField,
  bankName: z.string().trim().min(2, "Enter the bank name").max(160),
  accountHolderName: z.string().trim().min(2, "Enter the account holder").max(160),
  accountNumber: z.string().trim().min(4, "Enter the account number").max(40),
  branchName: optionalText(120),
  bankIdentifier: optionalText(40),
  country: optionalText(80),
  currencyCode: currencyField,
  verificationStatus: z.enum(["unverified", "pending", "verified", "rejected"]).optional(),
  notes: optionalText(500),
  /** Required when changing an existing account: banking changes are high-impact. */
  changeReason: z.string().trim().max(500).optional(),
});

// ---------------------------------------------------------------- customers
export const customerCreateSchema = z.object({
  legalName: z.string().trim().min(2, "Enter the legal name").max(200),
  tradingName: optionalText(200),
  customerType: z.enum(CUSTOMER_TYPES),
  primaryCategoryId: optionalUuid,
  registrationNumber: optionalText(60),
  taxIdentificationNumber: optionalText(60),
  registrationCountry: optionalText(80),
  website: websiteField,
  relationshipStartDate: optionalIsoDate,
  description: optionalText(1000),
  preferredCurrencyCode: z.union([currencyField, z.literal("")]).optional().transform((value) => value || null),
  paymentTermsId: optionalUuid,
  deliveryTermsId: optionalUuid,
  preferredLanguage: optionalText(40),
  salesRepresentativeEmployeeId: optionalUuid,
  relationshipManagerEmployeeId: optionalUuid,
  commercialNotes: optionalText(2000),
  contactName: optionalText(120),
  contactEmail: optionalEmail,
  contactPhone: phoneField,
  notes: optionalText(2000),
});

export const customerUpdateSchema = customerCreateSchema.extend({ id: uuidField });

export const customerStatusSchema = z.object({
  id: uuidField,
  status: z.enum(CUSTOMER_STATUSES),
  reason: z.string().trim().max(500).optional(),
});

export const customerContactSchema = z.object({
  id: z.string().optional(),
  customerId: uuidField,
  name: z.string().trim().min(2, "Enter the contact name").max(160),
  jobTitle: optionalText(120),
  department: z.enum(["purchasing", "finance", "quality", "logistics", "management", "other"]).optional(),
  email: optionalEmail,
  phone: phoneField,
  whatsappNumber: phoneField,
  preferredLanguage: optionalText(40),
  isPrimary: z.boolean().optional(),
  notes: optionalText(500),
});

export const customerAddressSchema = z.object({
  id: z.string().optional(),
  customerId: uuidField,
  addressType: z.enum(ADDRESS_TYPES.customer),
  label: optionalText(80),
  country: z.string().trim().min(2, "Enter the country").max(80),
  stateRegion: optionalText(80),
  city: optionalText(80),
  street: optionalText(240),
  postalCode: optionalText(24),
  isPrimary: z.boolean().optional(),
});

export const customerCreditSchema = z.object({
  customerId: uuidField,
  creditLimit: z.union([decimalString({ maxScale: 2, label: "credit limit" }), z.literal("")]).optional(),
  creditCurrencyCode: z.union([currencyField, z.literal("")]).optional().transform((value) => value || null),
  creditReviewDate: optionalIsoDate,
  creditStatus: z.enum(["not_assessed", "pending_review", "approved", "suspended", "withdrawn"]),
  riskCategory: optionalText(40),
  creditNotes: z.string().trim().max(1000).optional(),
});

// ---------------------------------------------------------------- products
export const productCreateSchema = z.object({
  code: codeField(/^[A-Za-z0-9][A-Za-z0-9._/-]{1,31}$/, "Letters, numbers, dot, slash, dash or underscore", 32),
  name: z.string().trim().min(2, "Enter the product name").max(200),
  shortDescription: optionalText(240),
  description: optionalText(2000),
  categoryId: uuidField,
  productType: z.enum(PRODUCT_TYPES),
  brand: optionalText(80),
  internalReference: optionalText(60),
  barcode: optionalText(64),
  baseUnitId: uuidField,
  purchaseUnitId: optionalUuid,
  storageUnitId: optionalUuid,
  salesUnitId: optionalUuid,
  productionUnitId: optionalUuid,
  origin: optionalText(80),
  processingMethod: optionalText(120),
  notes: optionalText(2000),
});

export const productUpdateSchema = productCreateSchema.extend({
  id: uuidField,
  /** Only accepted while the product is still a draft; the database refuses it later. */
  changeBaseUnitReason: z.string().trim().max(500).optional(),
});

export const productStatusSchema = z.object({
  id: uuidField,
  status: z.enum(PRODUCT_STATUSES),
  reason: z.string().trim().max(500).optional(),
});

export const productVariantSchema = z.object({
  id: z.string().optional(),
  productId: uuidField,
  code: codeField(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/, "Letters, numbers, dot, slash, dash or underscore", 32),
  name: z.string().trim().min(1, "Enter a name").max(160),
  grade: optionalText(60),
  description: optionalText(500),
  isDefault: z.boolean().optional(),
});

export const productSpecificationSchema = z.object({
  id: z.string().optional(),
  productId: uuidField,
  variantId: optionalUuid,
  name: z.string().trim().min(1, "Enter the specification name").max(120),
  specificationType: z.enum(["text", "number", "range", "boolean"]),
  valueText: optionalText(240),
  valueNumber: z.union([decimalString({ maxScale: 6, label: "specification value" }), z.literal("")]).optional(),
  unitId: optionalUuid,
  isCritical: z.boolean().optional(),
  notes: optionalText(500),
});

export const productAttributeValueSchema = z.object({
  productId: uuidField,
  variantId: optionalUuid,
  attributeId: uuidField,
  valueText: optionalText(240),
  valueNumber: z.union([decimalString({ maxScale: 6, label: "attribute value" }), z.literal("")]).optional(),
  valueBoolean: z.boolean().optional(),
  valueDate: optionalIsoDate,
});

export const productPackagingSchema = z
  .object({
    id: z.string().optional(),
    productId: uuidField,
    variantId: optionalUuid,
    packagingType: z.string().trim().min(1, "Enter the packaging type").max(80),
    packagingMaterial: optionalText(80),
    packageUnitId: uuidField,
    netQuantity: z.union([decimalString({ maxScale: 4, label: "net quantity", positive: true }), z.literal("")]).optional(),
    quantityUnitId: optionalUuid,
    grossWeight: z.union([decimalString({ maxScale: 4, label: "gross weight", positive: true }), z.literal("")]).optional(),
    packageCount: z.coerce.number().int().min(1).max(1_000_000).optional(),
    description: optionalText(400),
    isDefault: z.boolean().optional(),
  })
  .refine((value) => !value.netQuantity || Boolean(value.quantityUnitId), {
    message: "A net quantity needs a unit",
    path: ["quantityUnitId"],
  });

// ---------------------------------------------------------------- units and conversions
export const unitSchema = z.object({
  id: z.string().optional(),
  code: codeField(/^[A-Za-z][A-Za-z0-9²³/_-]{0,11}$/, "Unit codes are short labels such as kg or MT", 12),
  name: z.string().trim().min(1, "Enter the unit name").max(60),
  symbol: optionalText(12),
  category: z.enum(UNIT_CATEGORIES),
  precision: z.coerce.number().int().min(0).max(6),
  isBaseUnit: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: optionalText(400),
});

export const unitConversionSchema = z.object({
  id: z.string().optional(),
  fromUnitId: uuidField,
  toUnitId: uuidField,
  conversionFactor: decimalString({ maxScale: 12, label: "conversion factor", positive: true }),
  conversionMethod: z.enum(["multiply", "divide"]),
  productId: optionalUuid,
  effectiveFrom: isoDateField,
  effectiveUntil: optionalIsoDate,
  notes: optionalText(400),
});

// ---------------------------------------------------------------- locations
export const siteSchema = z.object({
  id: z.string().optional(),
  siteCode: codeField(/^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/, "Letters, numbers and dashes", 20),
  name: z.string().trim().min(2, "Enter the site name").max(160),
  siteType: z.enum(SITE_TYPES),
  description: optionalText(600),
  country: z.string().trim().min(2, "Enter the country").max(80),
  stateRegion: optionalText(80),
  city: optionalText(80),
  address: optionalText(240),
  contactPerson: optionalText(120),
  contactPhone: phoneField,
  isActive: z.boolean().optional(),
});

export const warehouseSchema = z.object({
  id: z.string().optional(),
  warehouseCode: codeField(/^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/, "Letters, numbers and dashes", 20),
  name: z.string().trim().min(2, "Enter the warehouse name").max(160),
  description: optionalText(600),
  warehouseType: z.enum(WAREHOUSE_TYPES),
  siteId: optionalUuid,
  country: optionalText(80),
  stateRegion: optionalText(80),
  city: optionalText(80),
  address: optionalText(240),
  managerEmployeeId: optionalUuid,
  contactPhone: phoneField,
  isActive: z.boolean().optional(),
});

export const warehouseLocationSchema = z.object({
  id: z.string().optional(),
  warehouseId: uuidField,
  parentLocationId: optionalUuid,
  locationCode: codeField(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/, "Letters, numbers and separators", 32),
  name: z.string().trim().min(1, "Enter the location name").max(120),
  locationType: z.enum(LOCATION_TYPES),
  description: optionalText(400),
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------- commercial references
export const currencySchema = z.object({
  id: z.string().optional(),
  code: currencyField,
  name: z.string().trim().min(2, "Enter the currency name").max(80),
  symbol: optionalText(8),
  decimalPlaces: z.coerce.number().int().min(0).max(4),
  isActive: z.boolean().optional(),
  notes: optionalText(400),
});

export const exchangeRateSchema = z
  .object({
    id: z.string().optional(),
    baseCurrencyCode: currencyField,
    quoteCurrencyCode: currencyField,
    exchangeRate: decimalString({ maxScale: 10, label: "exchange rate", positive: true }),
    rateDate: isoDateField,
    effectiveFrom: isoDateField,
    effectiveUntil: optionalIsoDate,
    rateSource: optionalText(120),
    rateType: z.enum(EXCHANGE_RATE_TYPES),
    status: z.enum(EXCHANGE_RATE_STATUSES).optional(),
    notes: optionalText(500),
  })
  .refine((value) => value.baseCurrencyCode !== value.quoteCurrencyCode, {
    message: "Base and quote currency must differ",
    path: ["quoteCurrencyCode"],
  })
  .refine((value) => !value.effectiveUntil || value.effectiveUntil >= value.effectiveFrom, {
    message: "The end date cannot precede the start date",
    path: ["effectiveUntil"],
  });

export const paymentTermSchema = z.object({
  id: z.string().optional(),
  code: codeField(/^[a-z][a-z0-9_]{1,39}$/, "Lower-case letters, numbers and underscores", 40),
  name: z.string().trim().min(2, "Enter the term name").max(80),
  description: optionalText(400),
  paymentDays: z.union([z.coerce.number().int().min(0).max(730), z.literal("")]).optional(),
  paymentType: z.enum(["advance", "cash_on_delivery", "immediate", "credit", "custom"]),
  isActive: z.boolean().optional(),
});

export const deliveryTermSchema = z.object({
  id: z.string().optional(),
  code: codeField(/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/, "Letters, numbers and dashes", 20),
  name: z.string().trim().min(2, "Enter the term name").max(120),
  termKind: z.enum(["incoterm", "domestic", "other"]),
  edition: optionalText(20),
  description: optionalText(600),
  isActive: z.boolean().optional(),
});

export const taxCategorySchema = z.object({
  id: z.string().optional(),
  code: codeField(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/, "Letters, numbers, dot, dash or underscore", 32),
  name: z.string().trim().min(2, "Enter the tax category name").max(120),
  description: optionalText(600),
  country: optionalText(80),
  taxType: optionalText(60),
  effectiveFrom: optionalIsoDate,
  effectiveUntil: optionalIsoDate,
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------- governance
export const duplicateResolutionSchema = z.object({
  id: uuidField,
  status: z.enum(["confirmed_duplicate", "not_duplicate", "deferred"]),
  notes: z.string().trim().min(10, "Explain the decision (at least 10 characters)").max(1000),
});

export const importUploadSchema = z.object({
  entityType: z.enum(["supplier", "customer", "product", "unit_of_measure", "payment_term", "currency"]),
  fileName: z.string().trim().min(1).max(200),
  content: z.string().min(1, "The file is empty"),
});

export const importConfirmSchema = z.object({
  jobId: uuidField,
});

/** Statuses that require a written reason, mirrored from `master_data_status_transitions`. */
export function statusChangeNeedsReason(status: string): boolean {
  return ["inactive", "blocked", "archived", "discontinued", "rejected"].includes(status);
}
