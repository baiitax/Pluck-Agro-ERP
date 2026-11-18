import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";
import { translateDatabaseError } from "@/services/master-data/shared";
import type { MasterDataOverview } from "@/services/master-data/overview";

export type QualityIssue = {
  entity_type: string;
  indicator: string;
  description: string;
  severity: "info" | "warning" | "critical";
  record_count: number;
};

/**
 * Data-quality indicators.
 *
 * Every number comes from the `master_data_quality_issues` view, which is defined in SQL alongside
 * the tables it measures. There is no scoring formula invented in TypeScript and no sample data:
 * if the underlying table is empty, the indicator is zero, and the UI says so.
 */
export async function getQualityIssues(): Promise<QualityIssue[]> {
  await requirePermission("master_data.quality.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("master_data_quality_issues" as never)
    .select("*")
    .returns<QualityIssue[]>();
  if (error) throw translateDatabaseError(error, "The data-quality indicators");

  return (data ?? [])
    .filter((issue) => issue.record_count > 0)
    .sort((left, right) => {
      const rank = { critical: 0, warning: 1, info: 2 } as const;
      return rank[left.severity] - rank[right.severity] || right.record_count - left.record_count;
    });
}

/** Completeness per entity: how many records are missing at least one required-quality field. */
export async function getCompletenessSummary(): Promise<
  { entity: string; metric: string; value: number; total: number }[]
> {
  await requirePermission("master_data.quality.view");
  const supabase = await createSupabaseServerClient();

  const [suppliers, customers, products] = await Promise.all([
    supabase.from("suppliers").select("id, phone, email, primary_category_id, status", { count: "exact" }),
    supabase.from("customers").select("id, registration_country, contact_name, status", { count: "exact" }),
    supabase.from("products").select("id, base_unit_id, status", { count: "exact" }),
  ]);

  const supplierRows = (suppliers.data ?? []) as { phone: string | null; email: string | null; primary_category_id: string | null; status: string }[];
  const customerRows = (customers.data ?? []) as { registration_country: string | null; contact_name: string | null; status: string }[];
  const productRows = (products.data ?? []) as { base_unit_id: string | null; status: string }[];

  const pct = (count: number, total: number) => (total === 0 ? 0 : Math.round((count / total) * 100));

  const suppliersWithContact = supplierRows.filter((row) => row.phone || row.email).length;
  const suppliersCategorised = supplierRows.filter((row) => row.primary_category_id).length;
  const customersWithCountry = customerRows.filter((row) => row.registration_country).length;
  const customersWithContact = customerRows.filter((row) => row.contact_name).length;
  const productsWithUnit = productRows.filter((row) => row.base_unit_id).length;

  return [
    { entity: "Suppliers", metric: "Have a phone number or email", value: pct(suppliersWithContact, supplierRows.length), total: supplierRows.length },
    { entity: "Suppliers", metric: "Have a primary category", value: pct(suppliersCategorised, supplierRows.length), total: supplierRows.length },
    { entity: "Customers", metric: "Have a country of registration", value: pct(customersWithCountry, customerRows.length), total: customerRows.length },
    { entity: "Customers", metric: "Have a named contact", value: pct(customersWithContact, customerRows.length), total: customerRows.length },
    { entity: "Products", metric: "Have a base unit", value: pct(productsWithUnit, productRows.length), total: productRows.length },
  ];
}

export type { MasterDataOverview };
