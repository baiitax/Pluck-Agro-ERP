import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";
import { getQualityIssues, type QualityIssue } from "@/services/master-data/quality";

export type MasterDataOverview = {
  generatedAt: string;
  suppliers: { total: number; active: number; blocked: number; draft: number; unverified: number };
  customers: { total: number; active: number; prospects: number; blocked: number };
  products: { total: number; active: number; draft: number; byType: { type: string; count: number }[] };
  categories: { supplier: number; customer: number; product: number };
  locations: { sites: number; activeSites: number; warehouses: number; activeWarehouses: number; storageLocations: number };
  measurement: { units: number; activeUnits: number; conversions: number; productSpecificConversions: number };
  references: { currencies: number; activeCurrencies: number; exchangeRates: number; paymentTerms: number; activePaymentTerms: number; deliveryTerms: number; taxCategories: number };
  governance: { qualityIssues: number; openDuplicates: number; recentImports: number };
  quality: QualityIssue[];
  recentlyUpdated: { entity: string; id: string; label: string; reference: string | null; updated_at: string }[];
};

/** Counts a table within the caller's RLS visibility. */
async function countRows(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  table: string,
  filters: Record<string, string | boolean> = {},
): Promise<number> {
  let query = supabase.from(table as never).select("id", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column as never, value as never);
  }
  const { count } = await query;
  return count ?? 0;
}

/**
 * The master-data dashboard.
 *
 * Every figure is a count of rows the caller is allowed to see. Nothing is estimated, and nothing
 * is seeded to make the screen look busy: a fresh install shows honest zeros.
 */
export async function getMasterDataOverview(): Promise<MasterDataOverview> {
  await requirePermission("master_data.overview.view");
  const supabase = await createSupabaseServerClient();

  const [
    supplierTotal, supplierActive, supplierBlocked, supplierDraft, supplierUnverified,
    customerTotal, customerActive, customerProspect, customerBlocked,
    productTotal, productActive, productDraft,
    supplierCategories, customerCategories, productCategories,
    sites, activeSites, warehouses, activeWarehouses, storageLocations,
    units, activeUnits, conversions, productConversions,
    currencies, activeCurrencies, exchangeRates, paymentTerms, activePaymentTerms, deliveryTerms, taxCategories,
    openDuplicates, recentImports,
  ] = await Promise.all([
    countRows(supabase, "suppliers"),
    countRows(supabase, "suppliers", { status: "active" }),
    countRows(supabase, "suppliers", { status: "blocked" }),
    countRows(supabase, "suppliers", { status: "draft" }),
    countRows(supabase, "suppliers", { verification_status: "unverified" }),
    countRows(supabase, "customers"),
    countRows(supabase, "customers", { status: "active" }),
    countRows(supabase, "customers", { status: "prospect" }),
    countRows(supabase, "customers", { status: "blocked" }),
    countRows(supabase, "products"),
    countRows(supabase, "products", { status: "active" }),
    countRows(supabase, "products", { status: "draft" }),
    countRows(supabase, "supplier_categories"),
    countRows(supabase, "customer_categories"),
    countRows(supabase, "product_categories"),
    countRows(supabase, "sites"),
    countRows(supabase, "sites", { is_active: true }),
    countRows(supabase, "warehouses"),
    countRows(supabase, "warehouses", { is_active: true }),
    countRows(supabase, "warehouse_locations"),
    countRows(supabase, "units_of_measure"),
    countRows(supabase, "units_of_measure", { is_active: true }),
    countRows(supabase, "unit_conversions"),
    supabase
      .from("unit_conversions")
      .select("id", { count: "exact", head: true })
      .not("product_id", "is", null)
      .then((result) => result.count ?? 0),
    countRows(supabase, "currencies"),
    countRows(supabase, "currencies", { is_active: true }),
    countRows(supabase, "exchange_rates"),
    countRows(supabase, "payment_terms"),
    countRows(supabase, "payment_terms", { is_active: true }),
    countRows(supabase, "delivery_terms"),
    countRows(supabase, "tax_categories"),
    supabase
      .from("master_data_duplicate_candidates")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .then((result) => result.count ?? 0),
    supabase
      .from("master_data_import_jobs")
      .select("id", { count: "exact", head: true })
      .then((result) => result.count ?? 0),
  ]);

  const [types, quality] = await Promise.all([
    supabase.from("products").select("product_type").returns<{ product_type: string }[]>(),
    getQualityIssues().catch(() => [] as QualityIssue[]),
  ]);

  const byType = new Map<string, number>();
  for (const row of types.data ?? []) {
    byType.set(row.product_type, (byType.get(row.product_type) ?? 0) + 1);
  }

  // Recently touched master records, from the change history the triggers maintain.
  const { data: recent } = await supabase
    .from("master_data_change_history")
    .select("entity_type, entity_id, entity_reference, change_type, created_at")
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<{ entity_type: string; entity_id: string; entity_reference: string | null; change_type: string; created_at: string }[]>();

  return {
    generatedAt: new Date().toISOString(),
    suppliers: { total: supplierTotal, active: supplierActive, blocked: supplierBlocked, draft: supplierDraft, unverified: supplierUnverified },
    customers: { total: customerTotal, active: customerActive, prospects: customerProspect, blocked: customerBlocked },
    products: {
      total: productTotal,
      active: productActive,
      draft: productDraft,
      byType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    },
    categories: { supplier: supplierCategories, customer: customerCategories, product: productCategories },
    locations: { sites, activeSites, warehouses, activeWarehouses, storageLocations },
    measurement: { units, activeUnits, conversions, productSpecificConversions: productConversions },
    references: {
      currencies,
      activeCurrencies,
      exchangeRates,
      paymentTerms,
      activePaymentTerms,
      deliveryTerms,
      taxCategories,
    },
    governance: {
      qualityIssues: quality.reduce((sum, issue) => sum + issue.record_count, 0),
      openDuplicates,
      recentImports,
    },
    quality,
    recentlyUpdated: (recent ?? []).map((row) => ({
      entity: row.entity_type,
      id: row.entity_id,
      label: row.change_type.replace(/_/g, " "),
      reference: row.entity_reference,
      updated_at: row.created_at,
    })),
  };
}
