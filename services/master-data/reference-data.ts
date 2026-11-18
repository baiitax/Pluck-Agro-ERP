import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";
import { translateDatabaseError } from "@/services/master-data/shared";
import type { Currency, DeliveryTerm, PaymentTerm } from "@/types/database.types";

export type Option = { id: string; label: string; code?: string };

/**
 * Lookup lists for forms.
 *
 * Each loader requires the *view* permission of the entity it reads. They are separate functions
 * rather than one "get everything" call so a screen only loads what it may show, and so a future
 * permission change narrows the data a form can offer.
 */

export async function getSupplierCategoryOptions(): Promise<Option[]> {
  await requirePermission("master_data.suppliers.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("supplier_categories")
    .select("id, name, code, is_active")
    .order("sort_order")
    .returns<{ id: string; name: string; code: string; is_active: boolean }[]>();
  if (error) throw translateDatabaseError(error, "The supplier categories");
  return (data ?? []).filter((row) => row.is_active).map((row) => ({ id: row.id, label: row.name, code: row.code }));
}

export async function getCustomerCategoryOptions(): Promise<Option[]> {
  await requirePermission("master_data.customers.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("customer_categories")
    .select("id, name, code, is_active")
    .order("sort_order")
    .returns<{ id: string; name: string; code: string; is_active: boolean }[]>();
  if (error) throw translateDatabaseError(error, "The customer categories");
  return (data ?? []).filter((row) => row.is_active).map((row) => ({ id: row.id, label: row.name, code: row.code }));
}

export async function getProductCategoryOptions(): Promise<Option[]> {
  await requirePermission("master_data.products.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("product_categories")
    .select("id, name, code, is_active")
    .order("sort_order")
    .order("name")
    .returns<{ id: string; name: string; code: string; is_active: boolean }[]>();
  if (error) throw translateDatabaseError(error, "The product categories");
  return (data ?? []).filter((row) => row.is_active).map((row) => ({ id: row.id, label: `${row.name} (${row.code})`, code: row.code }));
}

export async function getUnitOptions(): Promise<Option[]> {
  await requirePermission("master_data.units.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("units_of_measure")
    .select("id, name, code, is_active, category")
    .order("category")
    .order("name")
    .returns<{ id: string; name: string; code: string; is_active: boolean; category: string }[]>();
  if (error) throw translateDatabaseError(error, "The units of measure");
  return (data ?? [])
    .filter((row) => row.is_active)
    .map((row) => ({ id: row.id, label: `${row.name} (${row.code}) · ${row.category}`, code: row.code }));
}

export async function getCurrencyOptions(): Promise<Option[]> {
  await requirePermission("master_data.currencies.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("currencies")
    .select("id, name, code, is_active")
    .order("code")
    .returns<Pick<Currency, "id" | "name" | "code" | "is_active">[]>();
  if (error) throw translateDatabaseError(error, "The currencies");
  return (data ?? []).map((row) => ({
    id: row.id,
    label: `${row.code} — ${row.name}${row.is_active ? "" : " (inactive)"}`,
    code: row.code,
  }));
}

export async function getPaymentTermOptions(): Promise<Option[]> {
  await requirePermission("master_data.payment_terms.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("payment_terms")
    .select("id, name, code, is_active")
    .order("code")
    .returns<Pick<PaymentTerm, "id" | "name" | "code" | "is_active">[]>();
  if (error) throw translateDatabaseError(error, "The payment terms");
  return (data ?? []).map((row) => ({ id: row.id, label: `${row.name}${row.is_active ? "" : " (inactive)"}`, code: row.code }));
}

export async function getDeliveryTermOptions(): Promise<Option[]> {
  await requirePermission("master_data.delivery_terms.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delivery_terms")
    .select("id, name, code, is_active, edition")
    .order("code")
    .returns<(Pick<DeliveryTerm, "id" | "name" | "code" | "is_active"> & { edition: string | null })[]>();
  if (error) throw translateDatabaseError(error, "The delivery terms");
  return (data ?? []).map((row) => ({
    id: row.id,
    label: `${row.code} — ${row.name}${row.edition ? ` (${row.edition})` : ""}`,
    code: row.code,
  }));
}

export async function getSiteOptions(): Promise<Option[]> {
  await requirePermission("master_data.sites.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, name, site_code, is_active")
    .order("name")
    .returns<{ id: string; name: string; site_code: string; is_active: boolean }[]>();
  if (error) throw translateDatabaseError(error, "The sites");
  return (data ?? []).map((row) => ({ id: row.id, label: `${row.name} (${row.site_code})`, code: row.site_code }));
}

export async function getEmployeeOptionsForMasterData(): Promise<Option[]> {
  // Employees are administrative data; reuse the Phase 1 reader so there is one source of truth.
  await requirePermission("employees.employee.view");
  const { getEmployeeOptions } = await import("@/services/employees/get-employees");
  const employees = await getEmployeeOptions();
  return employees.map((employee) => ({
    id: employee.id,
    label: `${employee.first_name} ${employee.last_name} · ${employee.employee_number}`,
  }));
}

export type ProductOption = { id: string; code: string; name: string; base_unit_id: string };

export async function getProductOptions(): Promise<ProductOption[]> {
  await requirePermission("master_data.products.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, code, name, base_unit_id")
    .neq("status", "archived")
    .order("code")
    .returns<ProductOption[]>();
  if (error) throw translateDatabaseError(error, "The products");
  return data ?? [];
}
