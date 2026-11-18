import "server-only";

import { revalidatePath } from "next/cache";

import { buildTree, flattenTree } from "@/lib/organization/tree";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { siteSchema, warehouseLocationSchema, warehouseSchema } from "@/lib/validation/master-data.schemas";
import { requirePermission } from "@/services/authorization";
import { getActiveProfileId } from "@/services/master-data/helpers";
import { peekNextReference, recordMasterAudit, translateDatabaseError } from "@/services/master-data/shared";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { Site, Warehouse, WarehouseLocation } from "@/types/database.types";

export type SiteRow = Site & { warehouse_count: number };

export async function getSites(): Promise<SiteRow[]> {
  await requirePermission("master_data.sites.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("sites").select("*").order("name").returns<Site[]>();
  if (error) throw translateDatabaseError(error, "The site register");

  const { data: warehouses } = await supabase.from("warehouses").select("site_id").returns<{ site_id: string | null }[]>();
  const counts = new Map<string, number>();
  for (const warehouse of warehouses ?? []) {
    if (!warehouse.site_id) continue;
    counts.set(warehouse.site_id, (counts.get(warehouse.site_id) ?? 0) + 1);
  }
  return (data ?? []).map((site) => ({ ...site, warehouse_count: counts.get(site.id) ?? 0 }));
}

export async function saveSite(input: unknown, meta: RequestMeta = {}): Promise<Site> {
  await requirePermission("master_data.sites.manage");
  const payload = siteSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const record = {
    site_code: payload.siteCode,
    name: payload.name,
    site_type: payload.siteType,
    description: payload.description || null,
    country: payload.country,
    state_region: payload.stateRegion || null,
    city: payload.city || null,
    address: payload.address || null,
    contact_person: payload.contactPerson || null,
    contact_phone: payload.contactPhone,
    is_active: payload.isActive ?? true,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("sites").update(record).eq("id", payload.id).select("*").single<Site>()
    : await supabase
        .from("sites")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<Site>();
  if (error) throw translateDatabaseError(error, "The site");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "site",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Created"} site ${data.name} (${data.site_code}).`,
      newValues: { site_code: data.site_code, site_type: data.site_type, is_active: data.is_active },
    },
    meta,
  );

  revalidatePath("/master-data/sites");
  return data;
}

export type WarehouseRow = Warehouse & {
  site: { id: string; name: string; site_code: string } | null;
  manager: { id: string; first_name: string; last_name: string } | null;
  location_count: number;
};

export async function getWarehouses(): Promise<WarehouseRow[]> {
  await requirePermission("master_data.warehouses.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("warehouses")
    .select(
      "*, site:sites!warehouses_site_id_fkey(id, name, site_code), manager:employees!warehouses_manager_employee_id_fkey(id, first_name, last_name)",
    )
    .order("name")
    .returns<Omit<WarehouseRow, "location_count">[]>();
  if (error) throw translateDatabaseError(error, "The warehouse register");

  const { data: locations } = await supabase.from("warehouse_locations").select("warehouse_id").returns<{ warehouse_id: string }[]>();
  const counts = new Map<string, number>();
  for (const location of locations ?? []) {
    counts.set(location.warehouse_id, (counts.get(location.warehouse_id) ?? 0) + 1);
  }
  return (data ?? []).map((warehouse) => ({ ...warehouse, location_count: counts.get(warehouse.id) ?? 0 }));
}

export async function getWarehouse(id: string): Promise<{ warehouse: WarehouseRow; locations: WarehouseLocation[] } | null> {
  await requirePermission("master_data.warehouses.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("warehouses")
    .select(
      "*, site:sites!warehouses_site_id_fkey(id, name, site_code), manager:employees!warehouses_manager_employee_id_fkey(id, first_name, last_name)",
    )
    .eq("id", id)
    .maybeSingle<Omit<WarehouseRow, "location_count">>();
  if (error) throw translateDatabaseError(error, "The warehouse");
  if (!data) return null;

  const { data: locations } = await supabase
    .from("warehouse_locations")
    .select("*")
    .eq("warehouse_id", id)
    .order("location_code")
    .returns<WarehouseLocation[]>();

  return {
    warehouse: { ...data, location_count: (locations ?? []).length },
    locations: locations ?? [],
  };
}

export async function saveWarehouse(input: unknown, meta: RequestMeta = {}): Promise<Warehouse> {
  await requirePermission("master_data.warehouses.manage");
  const payload = warehouseSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const record = {
    warehouse_code: payload.warehouseCode,
    name: payload.name,
    description: payload.description || null,
    warehouse_type: payload.warehouseType,
    site_id: payload.siteId,
    country: payload.country || null,
    state_region: payload.stateRegion || null,
    city: payload.city || null,
    address: payload.address || null,
    manager_employee_id: payload.managerEmployeeId,
    contact_phone: payload.contactPhone,
    is_active: payload.isActive ?? true,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("warehouses").update(record).eq("id", payload.id).select("*").single<Warehouse>()
    : await supabase
        .from("warehouses")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<Warehouse>();
  if (error) throw translateDatabaseError(error, "The warehouse");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "warehouse",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Created"} warehouse ${data.name} (${data.warehouse_code}).`,
      newValues: { warehouse_code: data.warehouse_code, warehouse_type: data.warehouse_type, site_id: data.site_id },
      metadata: { note: "Warehouse master data only. Phase 2 records no stock balances." },
    },
    meta,
  );

  revalidatePath("/master-data/warehouses");
  revalidatePath(`/master-data/warehouses/${data.id}`);
  return data;
}

/** Hierarchical storage locations, reusing the organisation tree helper (cycle-safe). */
export function locationTree(locations: WarehouseLocation[]) {
  return buildTree(
    locations.map((location) => ({
      ...location,
      parentId: location.parent_location_id,
    })),
  );
}

export function orderedLocations(locations: WarehouseLocation[]) {
  return flattenTree(locationTree(locations));
}

export async function saveWarehouseLocation(input: unknown, meta: RequestMeta = {}): Promise<WarehouseLocation> {
  await requirePermission("master_data.warehouse_locations.manage");
  const payload = warehouseLocationSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const record = {
    warehouse_id: payload.warehouseId,
    parent_location_id: payload.parentLocationId,
    location_code: payload.locationCode,
    name: payload.name,
    location_type: payload.locationType,
    description: payload.description || null,
    is_active: payload.isActive ?? true,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("warehouse_locations").update(record).eq("id", payload.id).select("*").single<WarehouseLocation>()
    : await supabase
        .from("warehouse_locations")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<WarehouseLocation>();
  if (error) throw translateDatabaseError(error, "The storage location");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "warehouse_location",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Created"} storage location ${data.location_code} (${data.location_type}).`,
      newValues: { location_code: data.location_code, parent_location_id: data.parent_location_id },
    },
    meta,
  );

  revalidatePath(`/master-data/warehouses/${payload.warehouseId}`);
  return data;
}

export async function peekWarehouseReference(): Promise<string> {
  await requirePermission("master_data.warehouses.manage");
  return peekNextReference("warehouse");
}
