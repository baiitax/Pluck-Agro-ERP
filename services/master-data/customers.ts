import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  customerAddressSchema,
  customerContactSchema,
  customerCreateSchema,
  customerCreditSchema,
  customerStatusSchema,
  customerUpdateSchema,
} from "@/lib/validation/master-data.schemas";
import { requirePermission } from "@/services/authorization";
import { escapeFilterValue, getActiveProfileId } from "@/services/master-data/helpers";
import {
  auditActionForStatus,
  numeric,
  peekNextReference,
  recordMasterAudit,
  severityForStatus,
  translateDatabaseError,
} from "@/services/master-data/shared";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type {
  Customer,
  CustomerAddress,
  CustomerCategory,
  CustomerContact,
  CustomerCreditProfile,
} from "@/types/database.types";

export type CustomerListFilters = {
  search?: string;
  status?: string;
  type?: string;
  country?: string;
  categoryId?: string;
  page?: number;
  pageSize?: number;
  sort?: "recent" | "name" | "reference" | "status";
};

export type CustomerListRow = Customer & { category: { id: string; name: string } | null; contact_count: number };

export async function getCustomers(filters: CustomerListFilters = {}) {
  await requirePermission("master_data.customers.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));

  let query = supabase
    .from("customers")
    .select("*, category:customer_categories!customers_primary_category_id_fkey(id, name)", { count: "exact" });

  if (filters.status) query = query.eq("status", filters.status as Customer["status"]);
  if (filters.type) query = query.eq("customer_type", filters.type);
  if (filters.country) query = query.eq("registration_country", filters.country);
  if (filters.categoryId) query = query.eq("primary_category_id", filters.categoryId);
  if (filters.search) {
    const term = escapeFilterValue(filters.search);
    if (term) {
      query = query.or(
        `legal_name.ilike.%${term}%,trading_name.ilike.%${term}%,reference.ilike.%${term}%,registration_number.ilike.%${term}%,contact_email.ilike.%${term}%`,
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
    .returns<CustomerListRow[]>();
  if (error) throw translateDatabaseError(error, "The customer list");

  const ids = (data ?? []).map((row) => row.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: contacts } = await supabase
      .from("customer_contacts")
      .select("customer_id")
      .in("customer_id", ids)
      .returns<{ customer_id: string }[]>();
    for (const contact of contacts ?? []) {
      counts.set(contact.customer_id, (counts.get(contact.customer_id) ?? 0) + 1);
    }
  }

  return {
    rows: (data ?? []).map((row) => ({ ...row, contact_count: counts.get(row.id) ?? 0 })),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export type CustomerDetail = {
  customer: Customer;
  category: CustomerCategory | null;
  categories: CustomerCategory[];
  contacts: CustomerContact[];
  addresses: CustomerAddress[];
  documents: {
    id: string;
    document_type: string;
    title: string;
    reference_number: string | null;
    issued_on: string | null;
    expires_on: string | null;
    file_name: string | null;
  }[];
  history: {
    id: string;
    change_type: string;
    changed_fields: string[];
    created_at: string;
    actor: { display_name: string | null } | null;
  }[];
};

export async function getCustomer(id: string): Promise<CustomerDetail | null> {
  await requirePermission("master_data.customers.view");
  const supabase = await createSupabaseServerClient();

  const { data: customer, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle<Customer>();
  if (error) throw translateDatabaseError(error, "The customer");
  if (!customer) return null;

  const [categories, contacts, addresses, documents, history] = await Promise.all([
    supabase.from("customer_categories").select("*").order("sort_order").returns<CustomerCategory[]>(),
    supabase.from("customer_contacts").select("*").eq("customer_id", id).order("is_primary", { ascending: false }),
    supabase.from("customer_addresses").select("*").eq("customer_id", id).order("address_type"),
    supabase.from("customer_documents").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase
      .from("master_data_change_history")
      .select("id, change_type, changed_fields, created_at, actor:profiles!master_data_change_history_actor_user_id_fkey(display_name)")
      .eq("entity_type", "customer")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(25)
      .returns<CustomerDetail["history"]>(),
  ]);

  return {
    customer,
    category: categories.data?.find((category) => category.id === customer.primary_category_id) ?? null,
    categories: categories.data ?? [],
    contacts: (contacts.data ?? []) as CustomerContact[],
    addresses: (addresses.data ?? []) as CustomerAddress[],
    documents: (documents.data ?? []) as CustomerDetail["documents"],
    history: history.data ?? [],
  };
}

export async function peekCustomerReference(): Promise<string> {
  await requirePermission("master_data.customers.create");
  return peekNextReference("customer");
}

export async function createCustomer(input: unknown, meta: RequestMeta = {}): Promise<Customer> {
  await requirePermission("master_data.customers.create");
  const payload = customerCreateSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data, error } = await supabase
    .from("customers")
    .insert({
      legal_name: payload.legalName,
      trading_name: payload.tradingName || null,
      customer_type: payload.customerType,
      primary_category_id: payload.primaryCategoryId,
      registration_number: payload.registrationNumber || null,
      tax_identification_number: payload.taxIdentificationNumber || null,
      registration_country: payload.registrationCountry || null,
      website: payload.website,
      relationship_start_date: payload.relationshipStartDate || null,
      description: payload.description || null,
      preferred_currency_code: payload.preferredCurrencyCode,
      payment_terms_id: payload.paymentTermsId,
      delivery_terms_id: payload.deliveryTermsId,
      preferred_language: payload.preferredLanguage || null,
      sales_representative_employee_id: payload.salesRepresentativeEmployeeId,
      relationship_manager_employee_id: payload.relationshipManagerEmployeeId,
      commercial_notes: payload.commercialNotes || null,
      contact_name: payload.contactName || null,
      contact_email: payload.contactEmail,
      contact_phone: payload.contactPhone,
      notes: payload.notes || null,
      status: "lead",
      created_by: profileId,
      updated_by: profileId,
    })
    .select("*")
    .single<Customer>();

  if (error) throw translateDatabaseError(error, "The customer");

  await recordMasterAudit(
    {
      action: "master_data.created",
      entityType: "customer",
      entityId: data.id,
      description: `Created customer ${data.legal_name} (${data.reference}).`,
      newValues: { legal_name: data.legal_name, reference: data.reference, status: data.status },
    },
    meta,
  );

  revalidatePath("/master-data/customers");
  revalidatePath("/master-data");
  return data;
}

export async function updateCustomer(input: unknown, meta: RequestMeta = {}): Promise<Customer> {
  await requirePermission("master_data.customers.update");
  const payload = customerUpdateSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data, error } = await supabase
    .from("customers")
    .update({
      legal_name: payload.legalName,
      trading_name: payload.tradingName || null,
      customer_type: payload.customerType,
      primary_category_id: payload.primaryCategoryId,
      registration_number: payload.registrationNumber || null,
      tax_identification_number: payload.taxIdentificationNumber || null,
      registration_country: payload.registrationCountry || null,
      website: payload.website,
      relationship_start_date: payload.relationshipStartDate || null,
      description: payload.description || null,
      preferred_currency_code: payload.preferredCurrencyCode,
      payment_terms_id: payload.paymentTermsId,
      delivery_terms_id: payload.deliveryTermsId,
      preferred_language: payload.preferredLanguage || null,
      sales_representative_employee_id: payload.salesRepresentativeEmployeeId,
      relationship_manager_employee_id: payload.relationshipManagerEmployeeId,
      commercial_notes: payload.commercialNotes || null,
      contact_name: payload.contactName || null,
      contact_email: payload.contactEmail,
      contact_phone: payload.contactPhone,
      notes: payload.notes || null,
      updated_by: profileId,
    })
    .eq("id", payload.id)
    .select("*")
    .single<Customer>();

  if (error) throw translateDatabaseError(error, "The customer");

  await recordMasterAudit(
    {
      action: "master_data.updated",
      entityType: "customer",
      entityId: data.id,
      description: `Updated customer ${data.legal_name} (${data.reference}).`,
      newValues: { legal_name: data.legal_name, registration_country: data.registration_country },
    },
    meta,
  );

  revalidatePath("/master-data/customers");
  revalidatePath(`/master-data/customers/${data.id}`);
  return data;
}

export async function changeCustomerStatus(input: unknown, meta: RequestMeta = {}): Promise<Customer> {
  await requirePermission("master_data.customers.update");
  const payload = customerStatusSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data: existing } = await supabase
    .from("customers")
    .select("id, status, legal_name, reference")
    .eq("id", payload.id)
    .maybeSingle<Pick<Customer, "id" | "status" | "legal_name" | "reference">>();
  if (!existing) throw new AppError("NOT_FOUND", "That customer no longer exists.");

  const { data, error } = await supabase
    .from("customers")
    .update({
      status: payload.status,
      // The database requires a reason that accompanies *this* transition; sending null would fail
      // for transitions configured as reason-required, so it is validated here first.
      status_reason: payload.reason?.trim() || null,
      updated_by: profileId,
    })
    .eq("id", payload.id)
    .select("*")
    .single<Customer>();
  if (error) throw translateDatabaseError(error, "The customer status");

  await recordMasterAudit(
    {
      action: auditActionForStatus(payload.status),
      entityType: "customer",
      entityId: data.id,
      description: `${data.legal_name} (${data.reference}) moved from ${existing.status} to ${data.status}.`,
      severity: severityForStatus(payload.status),
      oldValues: { status: existing.status },
      newValues: { status: data.status, reason: payload.reason ?? null },
    },
    meta,
  );

  revalidatePath("/master-data/customers");
  revalidatePath(`/master-data/customers/${data.id}`);
  return data;
}

export async function saveCustomerContact(input: unknown, meta: RequestMeta = {}): Promise<CustomerContact> {
  await requirePermission("master_data.customers.update");
  const payload = customerContactSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  if (payload.isPrimary) {
    await supabase.from("customer_contacts").update({ is_primary: false }).eq("customer_id", payload.customerId).eq("is_primary", true);
  }

  const record = {
    customer_id: payload.customerId,
    name: payload.name,
    job_title: payload.jobTitle || null,
    department: payload.department ?? null,
    email: payload.email,
    phone: payload.phone,
    whatsapp_number: payload.whatsappNumber,
    preferred_language: payload.preferredLanguage || null,
    is_primary: payload.isPrimary ?? false,
    notes: payload.notes || null,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("customer_contacts").update(record).eq("id", payload.id).select("*").single<CustomerContact>()
    : await supabase
        .from("customer_contacts")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<CustomerContact>();
  if (error) throw translateDatabaseError(error, "The customer contact");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "customer_contact",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Added"} customer contact ${data.name}.`,
      metadata: { customer_id: payload.customerId },
    },
    meta,
  );

  revalidatePath(`/master-data/customers/${payload.customerId}`);
  return data;
}

export async function removeCustomerContact(input: { id: string; customerId: string }, meta: RequestMeta = {}): Promise<void> {
  await requirePermission("master_data.customers.update");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("customer_contacts").delete().eq("id", input.id);
  if (error) throw translateDatabaseError(error, "The customer contact");
  await recordMasterAudit(
    { action: "master_data.updated", entityType: "customer_contact", entityId: input.id, description: "Removed a customer contact." },
    meta,
  );
  revalidatePath(`/master-data/customers/${input.customerId}`);
}

export async function saveCustomerAddress(input: unknown, meta: RequestMeta = {}): Promise<CustomerAddress> {
  await requirePermission("master_data.customers.update");
  const payload = customerAddressSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  if (payload.isPrimary) {
    await supabase.from("customer_addresses").update({ is_primary: false }).eq("customer_id", payload.customerId).eq("is_primary", true);
  }

  const record = {
    customer_id: payload.customerId,
    address_type: payload.addressType,
    label: payload.label || null,
    country: payload.country,
    state_region: payload.stateRegion || null,
    city: payload.city || null,
    street: payload.street || null,
    postal_code: payload.postalCode || null,
    is_primary: payload.isPrimary ?? false,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("customer_addresses").update(record).eq("id", payload.id).select("*").single<CustomerAddress>()
    : await supabase
        .from("customer_addresses")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<CustomerAddress>();
  if (error) throw translateDatabaseError(error, "The customer address");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "customer_address",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Added"} a ${payload.addressType} address.`,
      metadata: { customer_id: payload.customerId },
    },
    meta,
  );

  revalidatePath(`/master-data/customers/${payload.customerId}`);
  return data;
}

export async function removeCustomerAddress(input: { id: string; customerId: string }, meta: RequestMeta = {}): Promise<void> {
  await requirePermission("master_data.customers.update");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("customer_addresses").delete().eq("id", input.id);
  if (error) throw translateDatabaseError(error, "The customer address");
  await recordMasterAudit(
    { action: "master_data.updated", entityType: "customer_address", entityId: input.id, description: "Removed a customer address." },
    meta,
  );
  revalidatePath(`/master-data/customers/${input.customerId}`);
}

// ---------------------------------------------------------------- credit (sensitive)
/**
 * Credit reference data for one customer.
 *
 * The caller must have checked `master_data.customer_credit.view` before rendering anything from
 * this result, and RLS enforces the same permission independently: a user without it receives zero
 * rows even if they reach this function through another code path.
 */
export async function getCustomerCredit(customerId: string): Promise<CustomerCreditProfile | null> {
  await requirePermission("master_data.customer_credit.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("customer_credit_profiles")
    .select("*")
    .eq("customer_id", customerId)
    .maybeSingle<CustomerCreditProfile>();
  if (error) throw translateDatabaseError(error, "The customer credit profile");
  return data ?? null;
}

export async function saveCustomerCredit(input: unknown, meta: RequestMeta = {}): Promise<CustomerCreditProfile> {
  await requirePermission("master_data.customer_credit.manage");
  const payload = customerCreditSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data: existing } = await supabase
    .from("customer_credit_profiles")
    .select("*")
    .eq("customer_id", payload.customerId)
    .maybeSingle<CustomerCreditProfile>();

  const record = {
    customer_id: payload.customerId,
    credit_limit: numeric(payload.creditLimit),
    credit_currency_code: payload.creditCurrencyCode,
    credit_review_date: payload.creditReviewDate || null,
    credit_status: payload.creditStatus,
    risk_category: payload.riskCategory || null,
    credit_notes: payload.creditNotes || null,
    assessed_by: profileId,
    assessed_at: new Date().toISOString(),
    updated_by: profileId,
  };

  const { data, error } = existing
    ? await supabase
        .from("customer_credit_profiles")
        .update(record)
        .eq("customer_id", payload.customerId)
        .select("*")
        .single<CustomerCreditProfile>()
    : await supabase
        .from("customer_credit_profiles")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<CustomerCreditProfile>();
  if (error) throw translateDatabaseError(error, "The customer credit profile");

  await recordMasterAudit(
    {
      action: "master_data.credit_changed",
      entityType: "customer_credit_profile",
      entityId: data.id,
      description: `Credit reference updated for customer (${payload.creditStatus}).`,
      severity: "critical",
      oldValues: existing ? { credit_limit: existing.credit_limit, credit_status: existing.credit_status } : null,
      newValues: { credit_limit: data.credit_limit, credit_status: data.credit_status },
      metadata: { note: "A stored limit is reference data; it does not authorize a credit sale." },
    },
    meta,
  );

  revalidatePath(`/master-data/customers/${payload.customerId}`);
  return data;
}
