import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  supplierAddressSchema,
  supplierContactSchema,
  supplierCreateSchema,
  supplierStatusSchema,
  supplierUpdateSchema,
  supplierVerifySchema,
} from "@/lib/validation/master-data.schemas";
import { requirePermission } from "@/services/authorization";
import { escapeFilterValue, getActiveProfileId } from "@/services/master-data/helpers";
import {
  auditActionForStatus,
  peekNextReference,
  recordMasterAudit,
  severityForStatus,
  translateDatabaseError,
} from "@/services/master-data/shared";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type {
  Supplier,
  SupplierAddress,
  SupplierCategory,
  SupplierContact,
} from "@/types/database.types";

export type SupplierListFilters = {
  search?: string;
  status?: string;
  categoryId?: string;
  verificationStatus?: string;
  country?: string;
  page?: number;
  pageSize?: number;
  sort?: "recent" | "name" | "reference" | "status";
};

export type SupplierListRow = Supplier & {
  category: { id: string; name: string } | null;
  contact_count: number;
};

/** Supplier directory. Requires master_data.suppliers.view; RLS enforces the same rule. */
export async function getSuppliers(filters: SupplierListFilters = {}) {
  await requirePermission("master_data.suppliers.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));

  let query = supabase
    .from("suppliers")
    .select("*, category:supplier_categories!suppliers_primary_category_id_fkey(id, name)", { count: "exact" });

  if (filters.status) query = query.eq("status", filters.status as Supplier["status"]);
  if (filters.verificationStatus) query = query.eq("verification_status", filters.verificationStatus);
  if (filters.categoryId) query = query.eq("primary_category_id", filters.categoryId);
  if (filters.country) query = query.eq("registration_country", filters.country);
  if (filters.search) {
    const term = escapeFilterValue(filters.search);
    if (term) {
      query = query.or(
        `legal_name.ilike.%${term}%,trading_name.ilike.%${term}%,reference.ilike.%${term}%,email.ilike.%${term}%,registration_number.ilike.%${term}%`,
      );
    }
  }

  const sort =
    filters.sort === "name"
      ? { column: "legal_name", ascending: true }
      : filters.sort === "reference"
        ? { column: "reference", ascending: true }
        : filters.sort === "status"
          ? { column: "status", ascending: true }
          : { column: "created_at", ascending: false };

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order(sort.column, { ascending: sort.ascending })
    .range(from, from + pageSize - 1)
    .returns<SupplierListRow[]>();

  if (error) throw translateDatabaseError(error, "The supplier list");

  // Contact counts in one query rather than N queries.
  const ids = (data ?? []).map((row) => row.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: contacts } = await supabase
      .from("supplier_contacts")
      .select("supplier_id")
      .in("supplier_id", ids)
      .returns<{ supplier_id: string }[]>();
    for (const contact of contacts ?? []) {
      counts.set(contact.supplier_id, (counts.get(contact.supplier_id) ?? 0) + 1);
    }
  }

  return {
    rows: (data ?? []).map((row) => ({ ...row, contact_count: counts.get(row.id) ?? 0 })),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export type SupplierDetail = {
  supplier: Supplier;
  category: SupplierCategory | null;
  categories: SupplierCategory[];
  contacts: SupplierContact[];
  addresses: SupplierAddress[];
  productCategories: { id: string; name: string; code: string }[];
  documents: {
    id: string;
    document_type: string;
    title: string;
    reference_number: string | null;
    issued_on: string | null;
    expires_on: string | null;
    file_name: string | null;
    notes: string | null;
  }[];
  history: {
    id: string;
    change_type: string;
    changed_fields: string[];
    created_at: string;
    actor: { display_name: string | null } | null;
  }[];
};

export async function getSupplier(id: string): Promise<SupplierDetail | null> {
  await requirePermission("master_data.suppliers.view");
  const supabase = await createSupabaseServerClient();

  const { data: supplier, error } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .maybeSingle<Supplier>();
  if (error) throw translateDatabaseError(error, "The supplier");
  if (!supplier) return null;

  const [categories, contacts, addresses, productAssignments, documents, history] = await Promise.all([
    supabase.from("supplier_categories").select("*").order("sort_order").returns<SupplierCategory[]>(),
    supabase.from("supplier_contacts").select("*").eq("supplier_id", id).order("is_primary", { ascending: false }),
    supabase.from("supplier_addresses").select("*").eq("supplier_id", id).order("address_type"),
    supabase
      .from("supplier_product_categories")
      .select("product_category_id, category:product_categories(id, name, code)")
      .eq("supplier_id", id)
      .returns<{ product_category_id: string; category: { id: string; name: string; code: string } | null }[]>(),
    supabase.from("supplier_documents").select("*").eq("supplier_id", id).order("created_at", { ascending: false }),
    supabase
      .from("master_data_change_history")
      .select("id, change_type, changed_fields, created_at, actor:profiles!master_data_change_history_actor_user_id_fkey(display_name)")
      .eq("entity_type", "supplier")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(25)
      .returns<SupplierDetail["history"]>(),
  ]);

  return {
    supplier,
    category: categories.data?.find((category) => category.id === supplier.primary_category_id) ?? null,
    categories: categories.data ?? [],
    contacts: (contacts.data ?? []) as SupplierContact[],
    addresses: (addresses.data ?? []) as SupplierAddress[],
    productCategories: (productAssignments.data ?? [])
      .map((row) => row.category)
      .filter((category): category is { id: string; name: string; code: string } => Boolean(category)),
    documents: (documents.data ?? []) as SupplierDetail["documents"],
    history: history.data ?? [],
  };
}

export async function peekSupplierReference(): Promise<string> {
  await requirePermission("master_data.suppliers.create");
  return peekNextReference("supplier");
}

export async function createSupplier(input: unknown, meta: RequestMeta = {}): Promise<Supplier> {
  const actor = await requirePermission("master_data.suppliers.create");
  const payload = supplierCreateSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      legal_name: payload.legalName,
      trading_name: payload.tradingName || null,
      supplier_type: payload.supplierType,
      primary_category_id: payload.primaryCategoryId,
      registration_number: payload.registrationNumber || null,
      tax_identification_number: payload.taxIdentificationNumber || null,
      registration_country: payload.registrationCountry || null,
      date_registered: payload.dateRegistered || null,
      description: payload.description || null,
      contact_person: payload.contactPerson || null,
      contact_position: payload.contactPosition || null,
      phone: payload.phone,
      alternate_phone: payload.alternatePhone,
      email: payload.email,
      website: payload.website,
      preferred_channel: payload.preferredChannel ?? null,
      preferred_currency_code: payload.preferredCurrencyCode,
      payment_terms_id: payload.paymentTermsId,
      delivery_terms_id: payload.deliveryTermsId,
      internal_reference: payload.internalReference || null,
      procurement_officer_employee_id: payload.procurementOfficerEmployeeId,
      relationship_manager_employee_id: payload.relationshipManagerEmployeeId,
      onboarding_date: payload.onboardingDate || null,
      risk_category: payload.riskCategory || null,
      notes: payload.notes || null,
      status: "draft",
      created_by: profileId,
      updated_by: profileId,
    })
    .select("*")
    .single<Supplier>();

  if (error) throw translateDatabaseError(error, "The supplier");

  await recordMasterAudit(
    {
      action: "master_data.created",
      entityType: "supplier",
      entityId: data.id,
      description: `Created supplier ${data.legal_name} (${data.reference}).`,
      newValues: { legal_name: data.legal_name, reference: data.reference, status: data.status },
      severity: "notice",
      metadata: { actor_role_scope: "master_data.suppliers.create", actor: actor.user.id },
    },
    meta,
  );

  revalidatePath("/master-data/suppliers");
  revalidatePath("/master-data");
  return data;
}

export async function updateSupplier(input: unknown, meta: RequestMeta = {}): Promise<Supplier> {
  await requirePermission("master_data.suppliers.update");
  const payload = supplierUpdateSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data: existing, error: readError } = await supabase
    .from("suppliers")
    .select("*")
    .eq("id", payload.id)
    .maybeSingle<Supplier>();
  if (readError) throw translateDatabaseError(readError, "The supplier");
  if (!existing) throw new AppError("NOT_FOUND", "That supplier no longer exists.");

  const { data, error } = await supabase
    .from("suppliers")
    .update({
      legal_name: payload.legalName,
      trading_name: payload.tradingName || null,
      supplier_type: payload.supplierType,
      primary_category_id: payload.primaryCategoryId,
      registration_number: payload.registrationNumber || null,
      tax_identification_number: payload.taxIdentificationNumber || null,
      registration_country: payload.registrationCountry || null,
      date_registered: payload.dateRegistered || null,
      description: payload.description || null,
      contact_person: payload.contactPerson || null,
      contact_position: payload.contactPosition || null,
      phone: payload.phone,
      alternate_phone: payload.alternatePhone,
      email: payload.email,
      website: payload.website,
      preferred_channel: payload.preferredChannel ?? null,
      preferred_currency_code: payload.preferredCurrencyCode,
      payment_terms_id: payload.paymentTermsId,
      delivery_terms_id: payload.deliveryTermsId,
      internal_reference: payload.internalReference || null,
      procurement_officer_employee_id: payload.procurementOfficerEmployeeId,
      relationship_manager_employee_id: payload.relationshipManagerEmployeeId,
      onboarding_date: payload.onboardingDate || null,
      risk_category: payload.riskCategory || null,
      notes: payload.notes || null,
      updated_by: profileId,
    })
    .eq("id", payload.id)
    .select("*")
    .single<Supplier>();

  if (error) throw translateDatabaseError(error, "The supplier");

  // Only the fields that actually changed go into the audit payload.
  const changed = Object.fromEntries(
    Object.entries({ legal_name: data.legal_name, trading_name: data.trading_name, email: data.email, phone: data.phone })
      .filter(([key, value]) => existing[key as keyof Supplier] !== value),
  );

  await recordMasterAudit(
    {
      action: "master_data.updated",
      entityType: "supplier",
      entityId: data.id,
      description: `Updated supplier ${data.legal_name} (${data.reference}).`,
      oldValues: Object.fromEntries(Object.keys(changed).map((key) => [key, existing[key as keyof Supplier]])),
      newValues: changed,
    },
    meta,
  );

  revalidatePath("/master-data/suppliers");
  revalidatePath(`/master-data/suppliers/${data.id}`);
  return data;
}

/**
 * Moves a supplier along its lifecycle.
 *
 * The database owns the transition map and enforces the per-transition permission, so this
 * service only has to supply a clear error and the audit trail.
 */
export async function changeSupplierStatus(input: unknown, meta: RequestMeta = {}): Promise<Supplier> {
  const payload = supplierStatusSchema.parse(input);
  await requirePermission("master_data.suppliers.update");
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data: existing } = await supabase
    .from("suppliers")
    .select("id, legal_name, reference, status")
    .eq("id", payload.id)
    .maybeSingle<Pick<Supplier, "id" | "legal_name" | "reference" | "status">>();
  if (!existing) throw new AppError("NOT_FOUND", "That supplier no longer exists.");

  const { data, error } = await supabase
    .from("suppliers")
    .update({
      status: payload.status,
      // The database requires a reason that accompanies *this* transition; sending null would fail
      // for transitions configured as reason-required, so it is validated here first.
      status_reason: payload.reason?.trim() || null,
      updated_by: profileId,
    })
    .eq("id", payload.id)
    .select("*")
    .single<Supplier>();

  if (error) throw translateDatabaseError(error, "The supplier status");

  await recordMasterAudit(
    {
      action: auditActionForStatus(payload.status),
      entityType: "supplier",
      entityId: data.id,
      description: `${data.legal_name} (${data.reference}) moved from ${existing.status} to ${data.status}.`,
      severity: severityForStatus(payload.status),
      oldValues: { status: existing.status },
      newValues: { status: data.status, reason: payload.reason ?? null },
    },
    meta,
  );

  revalidatePath("/master-data/suppliers");
  revalidatePath(`/master-data/suppliers/${data.id}`);
  return data;
}

export async function verifySupplier(input: unknown, meta: RequestMeta = {}): Promise<Supplier> {
  await requirePermission("master_data.suppliers.verify");
  const payload = supplierVerifySchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data, error } = await supabase
    .from("suppliers")
    .update({
      verification_status: payload.verificationStatus,
      verification_notes: payload.notes?.trim() || null,
      last_verification_date: payload.verifiedOn || new Date().toISOString().slice(0, 10),
      updated_by: profileId,
    })
    .eq("id", payload.id)
    .select("*")
    .single<Supplier>();

  if (error) throw translateDatabaseError(error, "The supplier verification");

  await recordMasterAudit(
    {
      action: "master_data.verified",
      entityType: "supplier",
      entityId: data.id,
      description: `Recorded verification "${payload.verificationStatus}" for ${data.legal_name}.`,
      severity: payload.verificationStatus === "failed" ? "warning" : "notice",
      newValues: { verification_status: payload.verificationStatus, notes: payload.notes ?? null },
    },
    meta,
  );

  revalidatePath(`/master-data/suppliers/${data.id}`);
  return data;
}

// ---------------------------------------------------------------- contacts
export async function saveSupplierContact(input: unknown, meta: RequestMeta = {}): Promise<SupplierContact> {
  await requirePermission("master_data.suppliers.update");
  const payload = supplierContactSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  if (payload.isPrimary) {
    // Clear the previous primary first: the partial unique index allows exactly one.
    await supabase
      .from("supplier_contacts")
      .update({ is_primary: false })
      .eq("supplier_id", payload.supplierId)
      .eq("is_primary", true);
  }

  const record = {
    supplier_id: payload.supplierId,
    name: payload.name,
    position: payload.position || null,
    department: payload.department || null,
    phone: payload.phone,
    alternate_phone: payload.alternatePhone,
    email: payload.email,
    preferred_channel: payload.preferredChannel ?? null,
    is_primary: payload.isPrimary ?? false,
    notes: payload.notes || null,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("supplier_contacts").update(record).eq("id", payload.id).select("*").single<SupplierContact>()
    : await supabase
        .from("supplier_contacts")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<SupplierContact>();

  if (error) throw translateDatabaseError(error, "The supplier contact");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "supplier_contact",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Added"} supplier contact ${data.name}.`,
      metadata: { supplier_id: payload.supplierId },
    },
    meta,
  );

  revalidatePath(`/master-data/suppliers/${payload.supplierId}`);
  return data;
}

export async function removeSupplierContact(
  input: { id: string; supplierId: string },
  meta: RequestMeta = {},
): Promise<void> {
  await requirePermission("master_data.suppliers.update");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("supplier_contacts").delete().eq("id", input.id);
  if (error) throw translateDatabaseError(error, "The supplier contact");

  await recordMasterAudit(
    {
      action: "master_data.updated",
      entityType: "supplier_contact",
      entityId: input.id,
      description: "Removed a supplier contact.",
      oldValues: { supplier_id: input.supplierId },
    },
    meta,
  );
  revalidatePath(`/master-data/suppliers/${input.supplierId}`);
}

// ---------------------------------------------------------------- addresses
export async function saveSupplierAddress(input: unknown, meta: RequestMeta = {}): Promise<SupplierAddress> {
  await requirePermission("master_data.suppliers.update");
  const payload = supplierAddressSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  if (payload.isPrimary) {
    await supabase.from("supplier_addresses").update({ is_primary: false }).eq("supplier_id", payload.supplierId).eq("is_primary", true);
  }

  const record = {
    supplier_id: payload.supplierId,
    address_type: payload.addressType,
    label: payload.label || null,
    country: payload.country,
    state_region: payload.stateRegion || null,
    local_government: payload.localGovernment || null,
    city: payload.city || null,
    street: payload.street || null,
    postal_code: payload.postalCode || null,
    latitude: payload.latitude ? Number(payload.latitude) : null,
    longitude: payload.longitude ? Number(payload.longitude) : null,
    is_primary: payload.isPrimary ?? false,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("supplier_addresses").update(record).eq("id", payload.id).select("*").single<SupplierAddress>()
    : await supabase
        .from("supplier_addresses")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<SupplierAddress>();

  if (error) throw translateDatabaseError(error, "The supplier address");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "supplier_address",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Added"} a ${payload.addressType} address.`,
      metadata: { supplier_id: payload.supplierId },
    },
    meta,
  );

  revalidatePath(`/master-data/suppliers/${payload.supplierId}`);
  return data;
}

export async function removeSupplierAddress(input: { id: string; supplierId: string }, meta: RequestMeta = {}): Promise<void> {
  await requirePermission("master_data.suppliers.update");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("supplier_addresses").delete().eq("id", input.id);
  if (error) throw translateDatabaseError(error, "The supplier address");
  await recordMasterAudit(
    { action: "master_data.updated", entityType: "supplier_address", entityId: input.id, description: "Removed a supplier address." },
    meta,
  );
  revalidatePath(`/master-data/suppliers/${input.supplierId}`);
}

// ---------------------------------------------------------------- approved product categories
export async function setSupplierProductCategories(
  input: { supplierId: string; categoryIds: string[] },
  meta: RequestMeta = {},
): Promise<void> {
  await requirePermission("master_data.suppliers.update");
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { error: deleteError } = await supabase
    .from("supplier_product_categories")
    .delete()
    .eq("supplier_id", input.supplierId);
  if (deleteError) throw translateDatabaseError(deleteError, "The approved product categories");

  if (input.categoryIds.length > 0) {
    const { error } = await supabase.from("supplier_product_categories").insert(
      input.categoryIds.map((categoryId) => ({
        supplier_id: input.supplierId,
        product_category_id: categoryId,
        created_by: profileId,
      })),
    );
    if (error) throw translateDatabaseError(error, "The approved product categories");
  }

  await recordMasterAudit(
    {
      action: "master_data.updated",
      entityType: "supplier",
      entityId: input.supplierId,
      description: `Set ${input.categoryIds.length} approved product categor${input.categoryIds.length === 1 ? "y" : "ies"}.`,
      newValues: { product_category_ids: input.categoryIds },
    },
    meta,
  );

  revalidatePath(`/master-data/suppliers/${input.supplierId}`);
}
