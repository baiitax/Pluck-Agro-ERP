/**
 * Master-data lifecycle vocabulary.
 *
 * Statuses and their labels live here so the database check constraints, the services, the badges
 * and the tests all read the same list. Transition *policy* is not here: it is configuration in
 * `master_data_status_transitions`, because which move is allowed is a management decision.
 */
import type { CustomerStatus, ProductStatus, SupplierStatus } from "@/types/database.types";

export const SUPPLIER_STATUSES: readonly SupplierStatus[] = [
  "draft",
  "submitted",
  "under_review",
  "rejected",
  "verified",
  "active",
  "inactive",
  "blocked",
  "archived",
];

export const CUSTOMER_STATUSES: readonly CustomerStatus[] = [
  "lead",
  "prospect",
  "onboarding",
  "verified",
  "active",
  "inactive",
  "blocked",
  "archived",
];

export const PRODUCT_STATUSES: readonly ProductStatus[] = ["draft", "active", "inactive", "discontinued", "archived"];

export const MASTER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  rejected: "Rejected",
  verified: "Verified",
  lead: "Lead",
  prospect: "Prospect",
  onboarding: "Onboarding",
  active: "Active",
  inactive: "Inactive",
  blocked: "Blocked",
  discontinued: "Discontinued",
  archived: "Archived",
};

export type BadgeTone = "success" | "warning" | "danger" | "neutral" | "info";

export function masterStatusTone(status: string): BadgeTone {
  switch (status) {
    case "active":
    case "verified":
      return "success";
    case "submitted":
    case "under_review":
    case "onboarding":
      return "info";
    case "inactive":
    case "lead":
    case "prospect":
    case "draft":
      return "neutral";
    case "blocked":
    case "rejected":
      return "danger";
    case "discontinued":
      return "warning";
    case "archived":
      return "neutral";
    default:
      return "neutral";
  }
}

/** States that mean "the business may transact with this record right now". */
export const TRANSACTABLE_STATUS: Record<string, string[]> = {
  supplier: ["active"],
  customer: ["active"],
  product: ["active"],
};

export function isTransactable(entity: "supplier" | "customer" | "product", status: string): boolean {
  return (TRANSACTABLE_STATUS[entity] ?? []).includes(status);
}

export const VERIFICATION_STATUSES = ["unverified", "pending", "verified", "failed"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const CUSTOMER_TYPES = [
  "direct_buyer",
  "importer",
  "distributor",
  "manufacturer",
  "wholesaler",
  "retailer",
  "trading_company",
  "agent",
  "domestic_buyer",
  "other",
] as const;

export const SUPPLIER_TYPES = ["company", "individual", "partnership", "cooperative", "government", "other"] as const;

export const PRODUCT_TYPES = [
  "raw_material",
  "finished_good",
  "semi_finished",
  "by_product",
  "waste",
  "packaging",
  "consumable",
  "service",
] as const;

export const UNIT_CATEGORIES = ["MASS", "VOLUME", "COUNT", "LENGTH", "AREA", "TIME", "PACKAGING", "OTHER"] as const;

export const ADDRESS_TYPES = {
  supplier: ["registered", "operational", "collection_point", "delivery", "correspondence"],
  customer: ["registered", "billing", "delivery", "warehouse", "correspondence"],
} as const;

export const WAREHOUSE_TYPES = [
  "raw_material",
  "finished_goods",
  "production",
  "packaging",
  "waste",
  "general_storage",
  "transit",
  "external_storage",
] as const;

export const SITE_TYPES = [
  "head_office",
  "factory",
  "warehouse",
  "collection_center",
  "branch",
  "external_partner_location",
  "other",
] as const;

export const LOCATION_TYPES = ["zone", "section", "aisle", "rack", "shelf", "bin", "floor_area"] as const;

export const EXCHANGE_RATE_TYPES = ["official", "treasury", "commercial", "customs", "other"] as const;
export const EXCHANGE_RATE_STATUSES = ["draft", "pending_approval", "approved", "rejected", "superseded"] as const;

export const DUPLICATE_STATUSES = ["open", "confirmed_duplicate", "not_duplicate", "deferred", "merged"] as const;

/** Human labels for the code-shaped values above. */
export const VALUE_LABELS: Record<string, string> = {
  direct_buyer: "Direct buyer",
  importer: "Importer",
  distributor: "Distributor",
  manufacturer: "Manufacturer",
  wholesaler: "Wholesaler",
  retailer: "Retailer",
  trading_company: "Trading company",
  agent: "Agent / intermediary",
  domestic_buyer: "Domestic buyer",
  other: "Other",
  company: "Company",
  individual: "Individual",
  partnership: "Partnership",
  cooperative: "Cooperative",
  government: "Government",
  raw_material: "Raw material",
  finished_good: "Finished good",
  semi_finished: "Semi-finished",
  by_product: "By-product",
  waste: "Waste",
  packaging: "Packaging",
  consumable: "Consumable",
  service: "Service",
  registry: "Registry",
  raw_material_storage: "Raw material store",
  finished_goods: "Finished goods",
  production: "Production",
  general_storage: "General storage",
  transit: "Transit",
  external_storage: "External storage",
  head_office: "Head office",
  factory: "Factory",
  warehouse: "Warehouse",
  collection_center: "Collection centre",
  branch: "Branch",
  external_partner_location: "External partner location",
  zone: "Zone",
  section: "Section",
  aisle: "Aisle",
  rack: "Rack",
  shelf: "Shelf",
  bin: "Bin",
  floor_area: "Floor area",
  registered: "Registered office",
  operational: "Operational office",
  collection_point: "Collection point",
  delivery: "Delivery address",
  correspondence: "Correspondence",
  billing: "Billing address",
  official: "Official",
  treasury: "Treasury",
  commercial: "Commercial",
  customs: "Customs",
  unverified: "Unverified",
  pending: "Pending",
  verified: "Verified",
  failed: "Failed",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  superseded: "Superseded",
  open: "Open",
  confirmed_duplicate: "Confirmed duplicate",
  not_duplicate: "Not a duplicate",
  deferred: "Deferred",
  merged: "Merged",
  advance: "Advance",
  cash_on_delivery: "Cash on delivery",
  immediate: "Immediate",
  credit: "Credit",
  custom: "Custom",
  incoterm: "Incoterm",
  domestic: "Domestic",
  not_assessed: "Not assessed",
  pending_review: "Pending review",
  suspended: "Suspended",
  withdrawn: "Withdrawn",
};

export function labelFor(value: string | null | undefined): string {
  if (!value) return "—";
  return VALUE_LABELS[value] ?? value.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}
