import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  productAttributeValueSchema,
  productCategorySchema,
  productCreateSchema,
  productPackagingSchema,
  productSpecificationSchema,
  productStatusSchema,
  productUpdateSchema,
  productVariantSchema,
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
  Product,
  ProductAttributeDefinition,
  ProductAttributeValue,
  ProductCategory,
  ProductPackaging,
  ProductSpecification,
  ProductVariant,
  UnitOfMeasure,
} from "@/types/database.types";

export type ProductListFilters = {
  search?: string;
  status?: string;
  categoryId?: string;
  type?: string;
  page?: number;
  pageSize?: number;
};

export type ProductListRow = Product & {
  category: { id: string; name: string; code: string } | null;
  base_unit: { id: string; code: string; name: string } | null;
  variant_count: number;
  packaging_count: number;
};

export async function getProducts(filters: ProductListFilters = {}) {
  await requirePermission("master_data.products.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));

  let query = supabase
    .from("products")
    .select(
      "*, category:product_categories!products_category_id_fkey(id, name, code), base_unit:units_of_measure!products_base_unit_id_fkey(id, code, name)",
      { count: "exact" },
    );

  if (filters.status) query = query.eq("status", filters.status as Product["status"]);
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId);
  if (filters.type) query = query.eq("product_type", filters.type);
  if (filters.search) {
    const term = escapeFilterValue(filters.search);
    if (term) {
      query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%,reference.ilike.%${term}%,barcode.ilike.%${term}%`);
    }
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order("name", { ascending: true })
    .range(from, from + pageSize - 1)
    .returns<Omit<ProductListRow, "variant_count" | "packaging_count">[]>();
  if (error) throw translateDatabaseError(error, "The product list");

  // Counts of related records, for the register view only. Children are counted from the rows
  // themselves rather than stored as denormalised totals that could drift.
  const productIds = (data ?? []).map((row) => row.id);
  const [variants, packaging] = productIds.length === 0
    ? [{ data: [] as { product_id: string }[] }, { data: [] as { product_id: string }[] }]
    : await Promise.all([
        supabase.from("product_variants").select("product_id").in("product_id", productIds).returns<{ product_id: string }[]>(),
        supabase.from("product_packaging").select("product_id").in("product_id", productIds).returns<{ product_id: string }[]>(),
      ]);

  const countBy = (rows: { product_id: string }[] | null) => {
    const map = new Map<string, number>();
    for (const row of rows ?? []) map.set(row.product_id, (map.get(row.product_id) ?? 0) + 1);
    return map;
  };
  const variantCounts = countBy(variants.data);
  const packagingCounts = countBy(packaging.data);

  return {
    rows: (data ?? []).map((row) => ({
      ...row,
      variant_count: variantCounts.get(row.id) ?? 0,
      packaging_count: packagingCounts.get(row.id) ?? 0,
    })),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function getProductCategories(): Promise<ProductCategory[]> {
  await requirePermission("master_data.products.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("product_categories")
    .select("*")
    .order("sort_order")
    .order("name")
    .returns<ProductCategory[]>();
  if (error) throw translateDatabaseError(error, "The product categories");
  return data ?? [];
}

export type ProductDetail = {
  product: Product;
  category: ProductCategory | null;
  baseUnit: UnitOfMeasure | null;
  units: UnitOfMeasure[];
  variants: ProductVariant[];
  specifications: ProductSpecification[];
  packaging: ProductPackaging[];
  attributes: (ProductAttributeValue & { definition: ProductAttributeDefinition | null })[];
  attributeDefinitions: ProductAttributeDefinition[];
  histories: {
    id: string;
    change_type: string;
    changed_fields: string[];
    created_at: string;
    actor: { display_name: string | null } | null;
  }[];
};

export async function getProduct(id: string): Promise<ProductDetail | null> {
  await requirePermission("master_data.products.view");
  const supabase = await createSupabaseServerClient();

  const { data: product, error } = await supabase.from("products").select("*").eq("id", id).maybeSingle<Product>();
  if (error) throw translateDatabaseError(error, "The product");
  if (!product) return null;

  const [units, categories, variants, specifications, packaging, attributes, definitions, history] = await Promise.all([
    supabase.from("units_of_measure").select("*").order("category").returns<UnitOfMeasure[]>(),
    supabase.from("product_categories").select("*").order("sort_order").order("name").returns<ProductCategory[]>(),
    supabase.from("product_variants").select("*").eq("product_id", id).order("name"),
    supabase.from("product_specifications").select("*").eq("product_id", id).order("is_critical", { ascending: false }),
    supabase.from("product_packaging").select("*").eq("product_id", id).order("is_default", { ascending: false }),
    supabase
      .from("product_attribute_values")
      .select("*, definition:product_attribute_definitions(id, code, name, data_type, unit_id, options)")
      .eq("product_id", id)
      .returns<(ProductAttributeValue & { definition: ProductAttributeDefinition | null })[]>(),
    supabase.from("product_attribute_definitions").select("*").eq("is_active", true).order("sort_order"),
    supabase
      .from("master_data_change_history")
      .select("id, change_type, changed_fields, created_at, actor:profiles!master_data_change_history_actor_user_id_fkey(display_name)")
      .eq("entity_type", "product")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(25)
      .returns<ProductDetail["histories"]>(),
  ]);

  const unitRows = (units.data ?? []) as UnitOfMeasure[];
  return {
    product,
    category: (categories.data ?? []).find((category) => category.id === product.category_id) ?? null,
    baseUnit: unitRows.find((unit) => unit.id === product.base_unit_id) ?? null,
    units: unitRows,
    variants: (variants.data ?? []) as ProductVariant[],
    specifications: (specifications.data ?? []) as ProductSpecification[],
    packaging: (packaging.data ?? []) as ProductPackaging[],
    attributes: attributes.data ?? [],
    attributeDefinitions: (definitions.data ?? []) as ProductAttributeDefinition[],
    histories: history.data ?? [],
  };
}

export async function peekProductReference(): Promise<string> {
  await requirePermission("master_data.products.create");
  return peekNextReference("product");
}

export async function createProduct(input: unknown, meta: RequestMeta = {}): Promise<Product> {
  await requirePermission("master_data.products.create");
  const payload = productCreateSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data, error } = await supabase
    .from("products")
    .insert({
      code: payload.code,
      name: payload.name,
      short_description: payload.shortDescription || null,
      description: payload.description || null,
      category_id: payload.categoryId,
      product_type: payload.productType,
      brand: payload.brand || null,
      internal_reference: payload.internalReference || null,
      barcode: payload.barcode || null,
      base_unit_id: payload.baseUnitId,
      purchase_unit_id: payload.purchaseUnitId,
      storage_unit_id: payload.storageUnitId,
      sales_unit_id: payload.salesUnitId,
      production_unit_id: payload.productionUnitId,
      origin: payload.origin || null,
      processing_method: payload.processingMethod || null,
      notes: payload.notes || null,
      status: "draft",
      created_by: profileId,
      updated_by: profileId,
    })
    .select("*")
    .single<Product>();
  if (error) throw translateDatabaseError(error, "The product");

  await recordMasterAudit(
    {
      action: "master_data.created",
      entityType: "product",
      entityId: data.id,
      description: `Created product ${data.code} — ${data.name} (${data.reference}).`,
      newValues: { code: data.code, name: data.name, base_unit_id: data.base_unit_id, status: data.status },
    },
    meta,
  );

  revalidatePath("/master-data/products");
  return data;
}

export async function updateProduct(input: unknown, meta: RequestMeta = {}): Promise<Product> {
  await requirePermission("master_data.products.update");
  const payload = productUpdateSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data: existing } = await supabase.from("products").select("*").eq("id", payload.id).maybeSingle<Product>();
  if (!existing) throw new AppError("NOT_FOUND", "That product no longer exists.");

  const baseUnitChanged = existing.base_unit_id !== payload.baseUnitId;
  if (baseUnitChanged && existing.status !== "draft") {
    throw new AppError(
      "VALIDATION_ERROR",
      "The base unit cannot change once a product leaves draft: it would re-interpret every historical quantity. Create a replacement product instead.",
    );
  }

  const { data, error } = await supabase
    .from("products")
    .update({
      code: payload.code,
      name: payload.name,
      short_description: payload.shortDescription || null,
      description: payload.description || null,
      category_id: payload.categoryId,
      product_type: payload.productType,
      brand: payload.brand || null,
      internal_reference: payload.internalReference || null,
      barcode: payload.barcode || null,
      base_unit_id: payload.baseUnitId,
      purchase_unit_id: payload.purchaseUnitId,
      storage_unit_id: payload.storageUnitId,
      sales_unit_id: payload.salesUnitId,
      production_unit_id: payload.productionUnitId,
      origin: payload.origin || null,
      processing_method: payload.processingMethod || null,
      notes: payload.notes || null,
      updated_by: profileId,
    })
    .eq("id", payload.id)
    .select("*")
    .single<Product>();
  if (error) throw translateDatabaseError(error, "The product");

  await recordMasterAudit(
    {
      action: "master_data.updated",
      entityType: "product",
      entityId: data.id,
      description: `Updated product ${data.code}.`,
      severity: baseUnitChanged ? "critical" : "notice",
      oldValues: baseUnitChanged ? { base_unit_id: existing.base_unit_id } : null,
      newValues: { code: data.code, name: data.name, base_unit_id: data.base_unit_id },
      metadata: baseUnitChanged ? { reason: payload.changeBaseUnitReason ?? null } : null,
    },
    meta,
  );

  revalidatePath("/master-data/products");
  revalidatePath(`/master-data/products/${data.id}`);
  return data;
}

export async function changeProductStatus(input: unknown, meta: RequestMeta = {}): Promise<Product> {
  await requirePermission("master_data.products.update");
  const payload = productStatusSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data: existing } = await supabase
    .from("products")
    .select("status, code")
    .eq("id", payload.id)
    .maybeSingle<Pick<Product, "status" | "code">>();
  if (!existing) throw new AppError("NOT_FOUND", "That product no longer exists.");

  const { data, error } = await supabase
    .from("products")
    .update({
      status: payload.status,
      // The database requires a reason that accompanies *this* transition; sending null would fail
      // for transitions configured as reason-required, so it is validated here first.
      status_reason: payload.reason?.trim() || null,
      updated_by: profileId,
    })
    .eq("id", payload.id)
    .select("*")
    .single<Product>();
  if (error) throw translateDatabaseError(error, "The product status");

  await recordMasterAudit(
    {
      action: auditActionForStatus(payload.status),
      entityType: "product",
      entityId: data.id,
      description: `Product ${data.code} moved from ${existing.status} to ${data.status}.`,
      severity: severityForStatus(payload.status),
      oldValues: { status: existing.status },
      newValues: { status: data.status, reason: payload.reason ?? null },
    },
    meta,
  );

  revalidatePath("/master-data/products");
  revalidatePath(`/master-data/products/${data.id}`);
  return data;
}

// ---------------------------------------------------------------- categories
export async function saveProductCategory(input: unknown, meta: RequestMeta = {}): Promise<ProductCategory> {
  await requirePermission("master_data.product_categories.manage");
  const payload = productCategorySchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const record = {
    code: payload.code,
    name: payload.name,
    description: payload.description || null,
    parent_category_id: payload.parentCategoryId,
    sort_order: payload.sortOrder ?? 0,
    is_active: payload.isActive ?? true,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("product_categories").update(record).eq("id", payload.id).select("*").single<ProductCategory>()
    : await supabase
        .from("product_categories")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<ProductCategory>();
  if (error) throw translateDatabaseError(error, "The product category");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "product_category",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Created"} product category ${data.name} (${data.code}).`,
      newValues: { code: data.code, parent_category_id: data.parent_category_id },
    },
    meta,
  );

  revalidatePath("/master-data/products/categories");
  return data;
}

// ---------------------------------------------------------------- variants
export async function saveProductVariant(input: unknown, meta: RequestMeta = {}): Promise<ProductVariant> {
  await requirePermission("master_data.product_variants.manage");
  const payload = productVariantSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  if (payload.isDefault) {
    await supabase.from("product_variants").update({ is_default: false }).eq("product_id", payload.productId).eq("is_default", true);
  }

  const record = {
    product_id: payload.productId,
    code: payload.code,
    name: payload.name,
    grade: payload.grade || null,
    description: payload.description || null,
    is_default: payload.isDefault ?? false,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("product_variants").update(record).eq("id", payload.id).select("*").single<ProductVariant>()
    : await supabase
        .from("product_variants")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<ProductVariant>();
  if (error) throw translateDatabaseError(error, "The product variant");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "product_variant",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Created"} variant ${data.code} for a product.`,
      metadata: { product_id: payload.productId },
    },
    meta,
  );

  revalidatePath(`/master-data/products/${payload.productId}`);
  return data;
}

// ---------------------------------------------------------------- specifications
export async function saveProductSpecification(input: unknown, meta: RequestMeta = {}): Promise<ProductSpecification> {
  await requirePermission("master_data.product_specifications.manage");
  const payload = productSpecificationSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  if (!payload.valueText && !payload.valueNumber) {
    throw new AppError("VALIDATION_ERROR", "Enter the specification value.");
  }

  const record = {
    product_id: payload.productId,
    variant_id: payload.variantId,
    name: payload.name,
    specification_type: payload.specificationType,
    value_text: payload.valueText || null,
    value_number: numeric(payload.valueNumber),
    unit_id: payload.unitId,
    is_critical: payload.isCritical ?? false,
    notes: payload.notes || null,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("product_specifications").update(record).eq("id", payload.id).select("*").single<ProductSpecification>()
    : await supabase
        .from("product_specifications")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<ProductSpecification>();
  if (error) throw translateDatabaseError(error, "The product specification");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "product_specification",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Recorded"} specification "${data.name}".`,
      severity: data.is_critical ? "warning" : "notice",
      newValues: { name: data.name, value_text: data.value_text, value_number: data.value_number },
      metadata: { product_id: payload.productId },
    },
    meta,
  );

  revalidatePath(`/master-data/products/${payload.productId}`);
  return data;
}

export async function removeProductSpecification(
  input: { id: string; productId: string },
  meta: RequestMeta = {},
): Promise<void> {
  await requirePermission("master_data.product_specifications.manage");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("product_specifications").delete().eq("id", input.id);
  if (error) throw translateDatabaseError(error, "The product specification");
  await recordMasterAudit(
    { action: "master_data.updated", entityType: "product_specification", entityId: input.id, description: "Removed a product specification." },
    meta,
  );
  revalidatePath(`/master-data/products/${input.productId}`);
}

// ---------------------------------------------------------------- attributes
export async function saveProductAttributeValue(input: unknown, meta: RequestMeta = {}): Promise<ProductAttributeValue> {
  await requirePermission("master_data.product_specifications.manage");
  const payload = productAttributeValueSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const record = {
    product_id: payload.productId,
    variant_id: payload.variantId,
    attribute_id: payload.attributeId,
    value_text: payload.valueText || null,
    value_number: numeric(payload.valueNumber),
    value_boolean: payload.valueBoolean ?? null,
    value_date: payload.valueDate || null,
    updated_by: profileId,
  };

  // Upsert on (product, variant, attribute) — one value per attribute per product.
  const { data, error } = await supabase
    .from("product_attribute_values")
    .upsert(record, { onConflict: "product_id,variant_id,attribute_id" })
    .select("*")
    .single<ProductAttributeValue>();
  if (error) throw translateDatabaseError(error, "The product attribute value");

  await recordMasterAudit(
    {
      action: "master_data.updated",
      entityType: "product_attribute_value",
      entityId: data.id,
      description: "Recorded a product attribute value.",
      metadata: { product_id: payload.productId, attribute_id: payload.attributeId },
    },
    meta,
  );

  revalidatePath(`/master-data/products/${payload.productId}`);
  return data;
}

// ---------------------------------------------------------------- packaging
export async function saveProductPackaging(input: unknown, meta: RequestMeta = {}): Promise<ProductPackaging> {
  await requirePermission("master_data.product_packaging.manage");
  const payload = productPackagingSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  if (payload.isDefault) {
    await supabase.from("product_packaging").update({ is_default: false }).eq("product_id", payload.productId).eq("is_default", true);
  }

  const record = {
    product_id: payload.productId,
    variant_id: payload.variantId,
    packaging_type: payload.packagingType,
    packaging_material: payload.packagingMaterial || null,
    package_unit_id: payload.packageUnitId,
    net_quantity: numeric(payload.netQuantity),
    quantity_unit_id: payload.quantityUnitId,
    gross_weight: numeric(payload.grossWeight),
    package_count: payload.packageCount ?? null,
    description: payload.description || null,
    is_default: payload.isDefault ?? false,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("product_packaging").update(record).eq("id", payload.id).select("*").single<ProductPackaging>()
    : await supabase
        .from("product_packaging")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<ProductPackaging>();
  if (error) throw translateDatabaseError(error, "The packaging configuration");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "product_packaging",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Added"} packaging "${data.packaging_type}" with net quantity ${data.net_quantity ?? "—"}.`,
      newValues: { packaging_type: data.packaging_type, net_quantity: data.net_quantity, quantity_unit_id: data.quantity_unit_id },
      metadata: { product_id: payload.productId },
    },
    meta,
  );

  revalidatePath(`/master-data/products/${payload.productId}`);
  return data;
}

export async function removeProductPackaging(input: { id: string; productId: string }, meta: RequestMeta = {}): Promise<void> {
  await requirePermission("master_data.product_packaging.manage");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("product_packaging").delete().eq("id", input.id);
  if (error) throw translateDatabaseError(error, "The packaging configuration");
  await recordMasterAudit(
    { action: "master_data.updated", entityType: "product_packaging", entityId: input.id, description: "Removed a packaging configuration." },
    meta,
  );
  revalidatePath(`/master-data/products/${input.productId}`);
}
