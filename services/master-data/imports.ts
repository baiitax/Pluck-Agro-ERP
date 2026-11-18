import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { IMPORT_TEMPLATES, parseCsv, type ImportEntity } from "@/lib/master-data/csv";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { importConfirmSchema, importUploadSchema } from "@/lib/validation/master-data.schemas";
import { requirePermission } from "@/services/authorization";
import { getActiveProfileId } from "@/services/master-data/helpers";
import { recordMasterAudit, translateDatabaseError } from "@/services/master-data/shared";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { MasterDataImportJob, MasterDataImportRow } from "@/types/database.types";

/**
 * Master data import centre.
 *
 * Staged, not streamed: every uploaded row is persisted with its own verdict before anything is
 * written to a master table. That is what makes a rejected row reviewable instead of lost, and
 * what makes a retry safe — the job carries a `batch_key` derived from the file, so an accidental
 * second upload of the same file cannot duplicate records.
 */

export type StagedRow = {
  rowNumber: number;
  status: "accepted" | "rejected";
  errors: string[];
  values: Record<string, string>;
};

export type ImportPreview = {
  jobId: string;
  entityType: ImportEntity;
  headers: string[];
  accepted: StagedRow[];
  rejected: StagedRow[];
  structuralErrors: { rowNumber: number; message: string }[];
};

type ValidationContext = {
  supplierCategoryCodes: Set<string>;
  customerCategoryCodes: Set<string>;
  productCategoryCodes: Set<string>;
  unitCodes: Map<string, string>;
  currencyCodes: Set<string>;
};

async function loadValidationContext(): Promise<ValidationContext> {
  const supabase = await createSupabaseServerClient();
  const [supplierCategories, customerCategories, productCategories, units, currencies] = await Promise.all([
    supabase.from("supplier_categories").select("code").returns<{ code: string }[]>(),
    supabase.from("customer_categories").select("code").returns<{ code: string }[]>(),
    supabase.from("product_categories").select("code").returns<{ code: string }[]>(),
    supabase.from("units_of_measure").select("id, code").returns<{ id: string; code: string }[]>(),
    supabase.from("currencies").select("code").returns<{ code: string }[]>(),
  ]);

  return {
    supplierCategoryCodes: new Set((supplierCategories.data ?? []).map((row) => row.code)),
    customerCategoryCodes: new Set((customerCategories.data ?? []).map((row) => row.code)),
    productCategoryCodes: new Set((productCategories.data ?? []).map((row) => row.code)),
    unitCodes: new Map((units.data ?? []).map((row) => [row.code.toLowerCase(), row.id])),
    currencyCodes: new Set((currencies.data ?? []).map((row) => row.code)),
  };
}

/** Row-level validation. Each rule names the field, so the report can be acted on. */
function validateRow(
  entity: ImportEntity,
  values: Record<string, string>,
  context: ValidationContext,
): string[] {
  const errors: string[] = [];
  const required = IMPORT_TEMPLATES[entity].required as readonly string[];

  for (const field of required) {
    if (!values[field] || values[field].trim() === "") {
      errors.push(`${field} is required`);
    }
  }

  if (values.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) {
    errors.push("email is not a valid address");
  }
  if (values.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.contact_email)) {
    errors.push("contact_email is not a valid address");
  }
  for (const field of ["preferred_currency_code", "code"]) {
    const value = values[field];
    if (!value) continue;
    if (entity === "currency" && field === "code" && !/^[A-Z]{3}$/.test(value.toUpperCase())) {
      errors.push("code must be a 3-letter ISO 4217 currency code");
    }
    if (field === "preferred_currency_code" && !/^[A-Z]{3}$/.test(value.toUpperCase())) {
      errors.push("preferred_currency_code must be a 3-letter code such as NGN");
    }
    if (field === "preferred_currency_code" && !context.currencyCodes.has(value.toUpperCase())) {
      errors.push(`preferred_currency_code "${value}" is not in the currency registry`);
    }
  }

  if (entity === "product") {
    if (values.category_code && !context.productCategoryCodes.has(values.category_code.toLowerCase())) {
      errors.push(`category_code "${values.category_code}" does not exist`);
    }
    if (values.base_unit_code && !context.unitCodes.has(values.base_unit_code.toLowerCase())) {
      errors.push(`base_unit_code "${values.base_unit_code}" is not a registered unit`);
    }
    if (values.product_type && !/^[a-z_]+$/.test(values.product_type)) {
      errors.push("product_type must be one of the documented lower-case values");
    }
  }

  if (entity === "unit_of_measure") {
    if (values.category && !["MASS", "VOLUME", "COUNT", "LENGTH", "AREA", "TIME", "PACKAGING", "OTHER"].includes(values.category.toUpperCase())) {
      errors.push("category must be MASS, VOLUME, COUNT, LENGTH, AREA, TIME, PACKAGING or OTHER");
    }
    if (values.precision && !/^\d$/.test(values.precision)) {
      errors.push("precision must be a single digit between 0 and 6");
    }
  }

  if (entity === "payment_term" && values.payment_days && !/^\d{1,3}$/.test(values.payment_days)) {
    errors.push("payment_days must be a whole number of days");
  }

  if (entity === "supplier" && values.status && !["draft", "submitted"].includes(values.status)) {
    errors.push("status may only be draft or submitted on import; verification is a human decision");
  }
  if (entity === "customer" && values.status && !["lead", "prospect"].includes(values.status)) {
    errors.push("status may only be lead or prospect on import; verification is a human decision");
  }

  return errors;
}

/** Creates a job and stages every parsed row. Returns the preview the user confirms. */
export async function stageImport(input: unknown, meta: RequestMeta = {}): Promise<ImportPreview> {
  await requirePermission("master_data.imports.execute");
  const payload = importUploadSchema.parse(input);
  const entity = payload.entityType as ImportEntity;
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const parsed = parseCsv(payload.content);
  if (parsed.errors.some((error) => error.rowNumber === 0)) {
    throw new AppError("VALIDATION_ERROR", parsed.errors[0]?.message ?? "The file could not be read.");
  }

  const unknownColumns = parsed.headers.filter(
    (header) => !(IMPORT_TEMPLATES[entity].columns as readonly string[]).includes(header),
  );
  if (unknownColumns.length > 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      `The file has column(s) this template does not use: ${unknownColumns.join(", ")}. Download the template to see the expected headers.`,
    );
  }

  const context = await loadValidationContext();
  const accepted: StagedRow[] = [];
  const rejected: StagedRow[] = [];

  for (const row of parsed.rows) {
    const errors = validateRow(entity, row.values, context);
    const staged: StagedRow = {
      rowNumber: row.rowNumber,
      status: errors.length === 0 ? "accepted" : "rejected",
      errors,
      values: row.values,
    };
    (errors.length === 0 ? accepted : rejected).push(staged);
  }

  // Idempotency: the same file, the same entity and the same row count is the same batch.
  const batchKey = `${entity}:${payload.fileName}:${parsed.rows.length}:${hashString(payload.content)}`;

  const { data: job, error } = await supabase
    .from("master_data_import_jobs")
    .insert({
      entity_type: entity,
      file_name: payload.fileName,
      batch_key: batchKey,
      status: "validated",
      total_rows: parsed.rows.length,
      accepted_rows: accepted.length,
      rejected_rows: rejected.length,
      error_summary: parsed.errors.length > 0 ? { structural: parsed.errors } : null,
      created_by: profileId,
    })
    .select("*")
    .single<MasterDataImportJob>();

  if (error) {
    if (error.code === "23505") {
      throw new AppError(
        "CONFLICT",
        "This exact file was already imported. Importing it again would duplicate records, so it was refused.",
      );
    }
    throw translateDatabaseError(error, "The import job");
  }

  const rows = [...accepted, ...rejected]
    .sort((left, right) => left.rowNumber - right.rowNumber)
    .map((row) => ({
      job_id: job.id,
      row_number: row.rowNumber,
      raw_data: row.values,
      status: row.status,
      errors: row.errors.length > 0 ? { messages: row.errors } : null,
    }));

  if (rows.length > 0) {
    const { error: rowError } = await supabase.from("master_data_import_rows").insert(rows);
    if (rowError) throw translateDatabaseError(rowError, "The import rows");
  }

  await recordMasterAudit(
    {
      action: "master_data.import_staged",
      entityType: "master_data_import",
      entityId: job.id,
      description: `Staged ${parsed.rows.length} ${entity} row(s) from ${payload.fileName}: ${accepted.length} accepted, ${rejected.length} rejected.`,
      severity: rejected.length > 0 ? "warning" : "notice",
      metadata: { job_id: job.id, accepted: accepted.length, rejected: rejected.length },
    },
    meta,
  );

  revalidatePath("/master-data/imports");
  return { jobId: job.id, entityType: entity, headers: parsed.headers, accepted, rejected, structuralErrors: parsed.errors };
}

/**
 * Executes an already-staged job.
 *
 * Only accepted rows are written, and the job status moves to `imported` in the same request. If a
 * write fails the error surfaces instead of being swallowed, so a partial import is visible rather
 * than silently half-applied.
 */
export async function executeImport(input: unknown, meta: RequestMeta = {}): Promise<{ imported: number; skipped: number }> {
  await requirePermission("master_data.imports.execute");
  const payload = importConfirmSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data: job } = await supabase
    .from("master_data_import_jobs")
    .select("*")
    .eq("id", payload.jobId)
    .maybeSingle<MasterDataImportJob>();
  if (!job) throw new AppError("NOT_FOUND", "That import job no longer exists.");
  if (job.status === "imported") {
    throw new AppError("CONFLICT", "This import has already been executed. Re-running it is refused to protect the data.");
  }
  if (job.status === "cancelled" || job.status === "failed") {
    throw new AppError("CONFLICT", "This import job is closed. Upload the file again to start a new job.");
  }

  const { data: rows } = await supabase
    .from("master_data_import_rows")
    .select("*")
    .eq("job_id", job.id)
    .eq("status", "accepted")
    .order("row_number")
    .returns<MasterDataImportRow[]>();

  let imported = 0;
  let skipped = 0;

  for (const row of rows ?? []) {
    const values = row.raw_data as Record<string, string>;
    try {
      const targetId = await writeImportRow(job.entity_type as ImportEntity, values, profileId);
      if (targetId) {
        await supabase
          .from("master_data_import_rows")
          .update({ status: "imported", target_id: targetId })
          .eq("id", row.id);
        imported += 1;
      } else {
        await supabase
          .from("master_data_import_rows")
          .update({ status: "skipped_duplicate", errors: { messages: ["A record with this identifier already exists"] } })
          .eq("id", row.id);
        skipped += 1;
      }
    } catch (error) {
      await supabase
        .from("master_data_import_rows")
        .update({
          status: "rejected",
          errors: { messages: [error instanceof Error ? error.message : "Row could not be imported"] },
        })
        .eq("id", row.id);
      skipped += 1;
    }
  }

  const { error: jobError } = await supabase
    .from("master_data_import_jobs")
    .update({
      status: "imported",
      imported_rows: imported,
      duplicate_rows: skipped,
      confirmed_by: profileId,
      confirmed_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  if (jobError) throw translateDatabaseError(jobError, "The import job");

  await recordMasterAudit(
    {
      action: "master_data.import_executed",
      entityType: "master_data_import",
      entityId: job.id,
      description: `Imported ${imported} ${job.entity_type} row(s); ${skipped} skipped.`,
      severity: skipped > 0 ? "warning" : "notice",
      metadata: { job_id: job.id, imported, skipped },
    },
    meta,
  );

  revalidatePath("/master-data/imports");
  revalidatePath("/master-data");
  return { imported, skipped };
}

/** Writes one staged row, or returns null when the record already exists (idempotent retry). */
async function writeImportRow(entity: ImportEntity, values: Record<string, string>, profileId: string | null): Promise<string | null> {
  const supabase = await createSupabaseServerClient();

  if (entity === "supplier") {
    const { data: existing } = await supabase
      .from("suppliers")
      .select("id")
      .eq("legal_name", values.legal_name ?? "")
      .maybeSingle<{ id: string }>();
    if (existing) return null;

    const { data, error } = await supabase
      .from("suppliers")
      .insert({
        legal_name: values.legal_name ?? "",
        trading_name: values.trading_name || null,
        supplier_type: values.supplier_type || "company",
        registration_number: values.registration_number || null,
        tax_identification_number: values.tax_identification_number || null,
        registration_country: values.registration_country || null,
        phone: values.phone || null,
        email: values.email || null,
        website: values.website || null,
        contact_person: values.contact_person || null,
        preferred_currency_code: values.preferred_currency_code?.toUpperCase() || null,
        status: values.status === "submitted" ? "submitted" : "draft",
        created_by: profileId,
        updated_by: profileId,
      })
      .select("id")
      .single<{ id: string }>();
    if (error) throw translateDatabaseError(error, "An imported supplier");
    return data.id;
  }

  if (entity === "customer") {
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("legal_name", values.legal_name ?? "")
      .maybeSingle<{ id: string }>();
    if (existing) return null;

    const { data, error } = await supabase
      .from("customers")
      .insert({
        legal_name: values.legal_name ?? "",
        trading_name: values.trading_name || null,
        customer_type: values.customer_type || "direct_buyer",
        registration_number: values.registration_number || null,
        tax_identification_number: values.tax_identification_number || null,
        registration_country: values.registration_country || null,
        contact_name: values.contact_name || null,
        contact_email: values.contact_email || null,
        contact_phone: values.contact_phone || null,
        preferred_currency_code: values.preferred_currency_code?.toUpperCase() || null,
        status: values.status === "prospect" ? "prospect" : "lead",
        created_by: profileId,
        updated_by: profileId,
      })
      .select("id")
      .single<{ id: string }>();
    if (error) throw translateDatabaseError(error, "An imported customer");
    return data.id;
  }

  if (entity === "product") {
    const { data: existing } = await supabase
      .from("products")
      .select("id")
      .eq("code", values.code ?? "")
      .maybeSingle<{ id: string }>();
    if (existing) return null;

    const [{ data: category }, { data: unit }] = await Promise.all([
      supabase
        .from("product_categories")
        .select("id")
        .eq("code", (values.category_code ?? "").toLowerCase())
        .maybeSingle<{ id: string }>(),
      supabase
        .from("units_of_measure")
        .select("id")
        .eq("code", values.base_unit_code ?? "")
        .maybeSingle<{ id: string }>(),
    ]);
    if (!category || !unit) throw new Error("Category or base unit no longer exists");

    const { data, error } = await supabase
      .from("products")
      .insert({
        code: values.code ?? "",
        name: values.name ?? "",
        short_description: values.short_description || null,
        category_id: category.id,
        product_type: values.product_type || "raw_material",
        base_unit_id: unit.id,
        status: "draft",
        created_by: profileId,
        updated_by: profileId,
      })
      .select("id")
      .single<{ id: string }>();
    if (error) throw translateDatabaseError(error, "An imported product");
    return data.id;
  }

  if (entity === "unit_of_measure") {
    const { data, error } = await supabase
      .from("units_of_measure")
      .upsert(
        {
          code: values.code ?? "",
          name: values.name ?? "",
          symbol: values.symbol || null,
          category: (values.category ?? "OTHER").toUpperCase(),
          precision: values.precision ? Number(values.precision) : 3,
          updated_by: profileId,
        },
        { onConflict: "code" },
      )
      .select("id")
      .single<{ id: string }>();
    if (error) throw translateDatabaseError(error, "An imported unit");
    return data.id;
  }

  if (entity === "payment_term") {
    const { data, error } = await supabase
      .from("payment_terms")
      .upsert(
        {
          code: values.code ?? "",
          name: values.name ?? "",
          description: values.description || null,
          payment_days: values.payment_days ? Number(values.payment_days) : null,
          payment_type: values.payment_type || "credit",
          is_active: false,
          updated_by: profileId,
        },
        { onConflict: "code" },
      )
      .select("id")
      .single<{ id: string }>();
    if (error) throw translateDatabaseError(error, "An imported payment term");
    return data.id;
  }

  const { data, error } = await supabase
    .from("currencies")
    .upsert(
      {
        code: values.code ?? "",
        name: values.name ?? "",
        symbol: values.symbol || null,
        decimal_places: values.decimal_places ? Number(values.decimal_places) : 2,
        is_active: false,
        updated_by: profileId,
      },
      { onConflict: "code" },
    )
    .select("id")
    .single<{ id: string }>();
  if (error) throw translateDatabaseError(error, "An imported currency");
  return data.id;
}

export async function getImportJobs(limit = 50): Promise<(MasterDataImportJob & { creator: { display_name: string | null } | null })[]> {
  await requirePermission("master_data.imports.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("master_data_import_jobs")
    .select("*, creator:profiles!master_data_import_jobs_created_by_fkey(display_name)")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<(MasterDataImportJob & { creator: { display_name: string | null } | null })[]>();
  if (error) throw translateDatabaseError(error, "The import history");
  return data ?? [];
}

export async function getImportJob(id: string): Promise<{
  job: MasterDataImportJob;
  rows: MasterDataImportRow[];
} | null> {
  await requirePermission("master_data.imports.view");
  const supabase = await createSupabaseServerClient();
  const { data: job } = await supabase
    .from("master_data_import_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle<MasterDataImportJob>();
  if (!job) return null;

  const { data: rows } = await supabase
    .from("master_data_import_rows")
    .select("*")
    .eq("job_id", id)
    .order("row_number")
    .returns<MasterDataImportRow[]>();

  return { job, rows: rows ?? [] };
}

/** Tiny deterministic hash so `batch_key` is stable for identical content. */
function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}
