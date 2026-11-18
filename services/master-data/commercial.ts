import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  currencySchema,
  deliveryTermSchema,
  exchangeRateSchema,
  paymentTermSchema,
  taxCategorySchema,
} from "@/lib/validation/master-data.schemas";
import { requirePermission } from "@/services/authorization";
import { getActiveProfileId } from "@/services/master-data/helpers";
import { numeric, recordMasterAudit, translateDatabaseError } from "@/services/master-data/shared";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { Currency, DeliveryTerm, ExchangeRate, PaymentTerm, TaxCategory } from "@/types/database.types";

// ---------------------------------------------------------------- currencies
export async function getCurrencies(): Promise<Currency[]> {
  await requirePermission("master_data.currencies.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("currencies").select("*").order("code").returns<Currency[]>();
  if (error) throw translateDatabaseError(error, "The currency registry");
  return data ?? [];
}

export async function saveCurrency(input: unknown, meta: RequestMeta = {}): Promise<Currency> {
  await requirePermission("master_data.currencies.manage");
  const payload = currencySchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const record = {
    code: payload.code,
    name: payload.name,
    symbol: payload.symbol || null,
    decimal_places: payload.decimalPlaces,
    is_active: payload.isActive ?? true,
    notes: payload.notes || null,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("currencies").update(record).eq("id", payload.id).select("*").single<Currency>()
    : await supabase
        .from("currencies")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<Currency>();
  if (error) throw translateDatabaseError(error, "The currency");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "currency",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Added"} currency ${data.code}.`,
      newValues: { code: data.code, decimal_places: data.decimal_places, is_active: data.is_active },
    },
    meta,
  );

  revalidatePath("/master-data/currencies");
  return data;
}

// ---------------------------------------------------------------- exchange rates
export type ExchangeRateRow = ExchangeRate & {
  base: { code: string; name: string } | null;
  quote: { code: string; name: string } | null;
};

export async function getExchangeRates(limit = 100): Promise<ExchangeRateRow[]> {
  await requirePermission("master_data.exchange_rates.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("*, base:currencies!exchange_rates_base_currency_code_fkey(code, name), quote:currencies!exchange_rates_quote_currency_code_fkey(code, name)")
    .order("rate_date", { ascending: false })
    .limit(limit)
    .returns<ExchangeRateRow[]>();
  if (error) throw translateDatabaseError(error, "The exchange rates");
  return data ?? [];
}

/**
 * Records a rate. Approved rates are never edited: re-rating creates a new row so a historical
 * transaction's applied rate can always be reproduced.
 */
export async function saveExchangeRate(input: unknown, meta: RequestMeta = {}): Promise<ExchangeRate> {
  const actor = await requirePermission("master_data.exchange_rates.manage");
  const payload = exchangeRateSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  if (payload.id) {
    const { data: existing } = await supabase
      .from("exchange_rates")
      .select("*")
      .eq("id", payload.id)
      .maybeSingle<ExchangeRate>();
    if (!existing) throw new AppError("NOT_FOUND", "That rate no longer exists.");
    if (existing.status === "approved") {
      throw new AppError(
        "CONFLICT",
        "An approved rate is historical evidence and cannot be edited. Record a new rate instead; the old one stays reproducible.",
      );
    }
  }

  const status = payload.status ?? "draft";
  const record = {
    base_currency_code: payload.baseCurrencyCode,
    quote_currency_code: payload.quoteCurrencyCode,
    exchange_rate: numeric(payload.exchangeRate) ?? 0,
    rate_date: payload.rateDate,
    effective_from: payload.effectiveFrom,
    effective_until: payload.effectiveUntil || null,
    rate_source: payload.rateSource || null,
    rate_type: payload.rateType,
    status,
    notes: payload.notes || null,
    approved_by: status === "approved" ? actor.user.id : null,
    approved_at: status === "approved" ? new Date().toISOString() : null,
  };

  const { data, error } = payload.id
    ? await supabase.from("exchange_rates").update(record).eq("id", payload.id).select("*").single<ExchangeRate>()
    : await supabase
        .from("exchange_rates")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<ExchangeRate>();
  if (error) throw translateDatabaseError(error, "The exchange rate");

  await recordMasterAudit(
    {
      action: "master_data.exchange_rate_changed",
      entityType: "exchange_rate",
      entityId: data.id,
      description: `${data.rate_type} rate ${data.base_currency_code}/${data.quote_currency_code} = ${data.exchange_rate} on ${data.rate_date} (${data.status}).`,
      severity: "warning",
      newValues: {
        base: data.base_currency_code,
        quote: data.quote_currency_code,
        rate: data.exchange_rate,
        rate_type: data.rate_type,
        status: data.status,
      },
    },
    meta,
  );

  revalidatePath("/master-data/exchange-rates");
  return data;
}

// ---------------------------------------------------------------- payment terms
export async function getPaymentTerms(): Promise<PaymentTerm[]> {
  await requirePermission("master_data.payment_terms.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("payment_terms").select("*").order("payment_days").returns<PaymentTerm[]>();
  if (error) throw translateDatabaseError(error, "The payment terms");
  return data ?? [];
}

export async function savePaymentTerm(input: unknown, meta: RequestMeta = {}): Promise<PaymentTerm> {
  await requirePermission("master_data.payment_terms.manage");
  const payload = paymentTermSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const record = {
    code: payload.code,
    name: payload.name,
    description: payload.description || null,
    payment_days: payload.paymentDays === "" || payload.paymentDays === undefined ? null : payload.paymentDays,
    payment_type: payload.paymentType,
    is_active: payload.isActive ?? true,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("payment_terms").update(record).eq("id", payload.id).select("*").single<PaymentTerm>()
    : await supabase
        .from("payment_terms")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<PaymentTerm>();
  if (error) throw translateDatabaseError(error, "The payment term");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "payment_term",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Created"} payment term ${data.name}.`,
      newValues: { code: data.code, payment_days: data.payment_days, is_active: data.is_active },
    },
    meta,
  );

  revalidatePath("/master-data/payment-terms");
  return data;
}

// ---------------------------------------------------------------- delivery terms
export async function getDeliveryTerms(): Promise<DeliveryTerm[]> {
  await requirePermission("master_data.delivery_terms.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("delivery_terms").select("*").order("term_kind").order("code").returns<DeliveryTerm[]>();
  if (error) throw translateDatabaseError(error, "The delivery terms");
  return data ?? [];
}

export async function saveDeliveryTerm(input: unknown, meta: RequestMeta = {}): Promise<DeliveryTerm> {
  await requirePermission("master_data.delivery_terms.manage");
  const payload = deliveryTermSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const record = {
    code: payload.code,
    name: payload.name,
    term_kind: payload.termKind,
    edition: payload.edition || null,
    description: payload.description || null,
    is_active: payload.isActive ?? true,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("delivery_terms").update(record).eq("id", payload.id).select("*").single<DeliveryTerm>()
    : await supabase
        .from("delivery_terms")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<DeliveryTerm>();
  if (error) throw translateDatabaseError(error, "The delivery term");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "delivery_term",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Created"} delivery term ${data.code} (${data.term_kind}).`,
      newValues: { code: data.code, edition: data.edition, is_active: data.is_active },
    },
    meta,
  );

  revalidatePath("/master-data/delivery-terms");
  return data;
}

// ---------------------------------------------------------------- tax categories
export async function getTaxCategories(): Promise<TaxCategory[]> {
  await requirePermission("master_data.tax_categories.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("tax_categories").select("*").order("code").returns<TaxCategory[]>();
  if (error) throw translateDatabaseError(error, "The tax categories");
  return data ?? [];
}

export async function saveTaxCategory(input: unknown, meta: RequestMeta = {}): Promise<TaxCategory> {
  await requirePermission("master_data.tax_categories.manage");
  const payload = taxCategorySchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const record = {
    code: payload.code,
    name: payload.name,
    description: payload.description || null,
    country: payload.country || null,
    tax_type: payload.taxType || null,
    effective_from: payload.effectiveFrom || null,
    effective_until: payload.effectiveUntil || null,
    is_active: payload.isActive ?? true,
    updated_by: profileId,
  };

  const { data, error } = payload.id
    ? await supabase.from("tax_categories").update(record).eq("id", payload.id).select("*").single<TaxCategory>()
    : await supabase
        .from("tax_categories")
        .insert({ ...record, created_by: profileId })
        .select("*")
        .single<TaxCategory>();
  if (error) throw translateDatabaseError(error, "The tax category");

  await recordMasterAudit(
    {
      action: payload.id ? "master_data.updated" : "master_data.created",
      entityType: "tax_category",
      entityId: data.id,
      description: `${payload.id ? "Updated" : "Created"} tax category ${data.code}. No rate is stored or computed.`,
      newValues: { code: data.code, country: data.country, tax_type: data.tax_type },
    },
    meta,
  );

  revalidatePath("/master-data/tax-categories");
  return data;
}
