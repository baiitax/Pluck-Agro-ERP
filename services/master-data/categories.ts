import "server-only";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { masterCategorySchema } from "@/lib/validation/master-data.schemas";
import { requirePermission } from "@/services/authorization";
import { getActiveProfileId } from "@/services/master-data/helpers";
import { recordMasterAudit, translateDatabaseError } from "@/services/master-data/shared";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { CustomerCategory, SupplierCategory } from "@/types/database.types";

export type CategoryRow = { id: string; code: string; name: string; description: string | null; sort_order: number; is_active: boolean; usage_count: number };

async function listCategories(
  table: "supplier_categories" | "customer_categories",
  usageTable: "suppliers" | "customers",
  usageColumn: "primary_category_id",
): Promise<CategoryRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from(table)
    .select("id, code, name, description, sort_order, is_active")
    .order("sort_order")
    .order("name")
    .returns<Omit<CategoryRow, "usage_count">[]>();
  if (error) throw translateDatabaseError(error, "The categories");

  const { data: usage } = await supabase.from(usageTable).select(usageColumn).returns<Record<string, string | null>[]>();
  const counts = new Map<string, number>();
  for (const row of usage ?? []) {
    const value = row[usageColumn];
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return (data ?? []).map((row) => ({ ...row, usage_count: counts.get(row.id) ?? 0 }));
}

export async function getSupplierCategories(): Promise<CategoryRow[]> {
  await requirePermission("master_data.suppliers.view");
  return listCategories("supplier_categories", "suppliers", "primary_category_id");
}

export async function getCustomerCategories(): Promise<CategoryRow[]> {
  await requirePermission("master_data.customers.view");
  return listCategories("customer_categories", "customers", "primary_category_id");
}

export async function saveSupplierCategory(input: unknown, meta: RequestMeta = {}): Promise<SupplierCategory> {
  await requirePermission("master_data.supplier_categories.manage");
  const payload = masterCategorySchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const record = {
    code: payload.code,
    name: payload.name,
    description: payload.description || null,
    sort_order: payload.sortOrder ?? 0,
    is_active: payload.isActive ?? true,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("supplier_categories").update(record).eq("id", payload.id).select("*").single<SupplierCategory>()
    : await supabase
        .from("supplier_categories")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<SupplierCategory>();
  if (error) throw translateDatabaseError(error, "The supplier category");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "supplier_category",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Created"} supplier category ${data.name}.`,
      newValues: { code: data.code, is_active: data.is_active },
    },
    meta,
  );

  revalidatePath("/master-data/supplier-categories");
  return data;
}

export async function saveCustomerCategory(input: unknown, meta: RequestMeta = {}): Promise<CustomerCategory> {
  await requirePermission("master_data.customer_categories.manage");
  const payload = masterCategorySchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const record = {
    code: payload.code,
    name: payload.name,
    description: payload.description || null,
    sort_order: payload.sortOrder ?? 0,
    is_active: payload.isActive ?? true,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("customer_categories").update(record).eq("id", payload.id).select("*").single<CustomerCategory>()
    : await supabase
        .from("customer_categories")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<CustomerCategory>();
  if (error) throw translateDatabaseError(error, "The customer category");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "customer_category",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Created"} customer category ${data.name}.`,
      newValues: { code: data.code, is_active: data.is_active },
    },
    meta,
  );

  revalidatePath("/master-data/customer-categories");
  return data;
}
