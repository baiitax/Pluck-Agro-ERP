import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { findDuplicateCandidates, type DuplicateCandidateInput } from "@/lib/master-data/similarity";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { duplicateResolutionSchema } from "@/lib/validation/master-data.schemas";
import { requirePermission } from "@/services/authorization";
import { getActiveProfileId } from "@/services/master-data/helpers";
import { recordMasterAudit, translateDatabaseError } from "@/services/master-data/shared";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { MasterDataDuplicateCandidate } from "@/types/database.types";

export type DuplicateCandidateRow = MasterDataDuplicateCandidate & {
  reviewed_by_profile: { display_name: string | null } | null;
};

export async function getDuplicateCandidates(status?: string): Promise<DuplicateCandidateRow[]> {
  await requirePermission("master_data.duplicates.view");
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("master_data_duplicate_candidates")
    .select("*, reviewed_by_profile:profiles!master_data_duplicate_candidates_reviewed_by_fkey(display_name)");
  if (status) query = query.eq("status", status as MasterDataDuplicateCandidate["status"]);
  const { data, error } = await query
    .order("match_score", { ascending: false })
    .limit(200)
    .returns<DuplicateCandidateRow[]>();
  if (error) throw translateDatabaseError(error, "The duplicate candidates");
  return data ?? [];
}

/**
 * Re-scans one entity type and stores any candidates that are not already recorded.
 *
 * This only ever inserts rows into `master_data_duplicate_candidates`. It never merges, renames or
 * soft-deletes a master record: merging requires an authorised, audited operation that does not
 * exist in Phase 2 because there are no transactions to protect yet.
 */
export async function detectDuplicates(
  entity: "supplier" | "customer",
  meta: RequestMeta = {},
): Promise<{ found: number; created: number }> {
  await requirePermission("master_data.duplicates.review");
  const supabase = await createSupabaseServerClient();

  const records: DuplicateCandidateInput[] =
    entity === "supplier"
      ? ((await supabase
          .from("suppliers")
          .select("id, reference, legal_name, trading_name, registration_number, tax_identification_number, email, phone, website, registration_country")
          .neq("status", "archived")
          .returns<
            {
              id: string;
              reference: string;
              legal_name: string;
              trading_name: string | null;
              registration_number: string | null;
              tax_identification_number: string | null;
              email: string | null;
              phone: string | null;
              website: string | null;
              registration_country: string | null;
            }[]
          >()).data ?? []).map((row) => ({
          id: row.id,
          label: `${row.legal_name} (${row.reference})`,
          legalName: row.legal_name,
          registrationNumber: row.registration_number,
          taxId: row.tax_identification_number,
          email: row.email,
          phone: row.phone,
          website: row.website,
          country: row.registration_country,
        }))
      : ((await supabase
          .from("customers")
          .select("id, reference, legal_name, trading_name, registration_number, tax_identification_number, contact_email, registration_country")
          .neq("status", "archived")
          .returns<
            {
              id: string;
              reference: string;
              legal_name: string;
              trading_name: string | null;
              registration_number: string | null;
              tax_identification_number: string | null;
              contact_email: string | null;
              registration_country: string | null;
            }[]
          >()).data ?? []).map((row) => ({
          id: row.id,
          label: `${row.legal_name} (${row.reference})`,
          legalName: row.legal_name,
          registrationNumber: row.registration_number,
          taxId: row.tax_identification_number,
          email: row.contact_email,
          country: row.registration_country,
        }));

  // Bank account comparison is deliberately not performed here: it requires
  // master_data.supplier_banking.view and is a separate, audited check.

  const candidates = findDuplicateCandidates(entity, records);
  if (candidates.length === 0) {
    await recordMasterAudit(
      {
        action: "master_data.duplicate_resolved",
        entityType: `${entity}_duplicates`,
        entityId: null,
        description: `Duplicate scan for ${entity} records found no new candidates.`,
        severity: "info",
        metadata: { scanned: records.length },
      },
      meta,
    );
    return { found: 0, created: 0 };
  }

  const { data: existing } = await supabase
    .from("master_data_duplicate_candidates")
    .select("record_a_id, record_b_id")
    .eq("entity_type", entity)
    .returns<{ record_a_id: string; record_b_id: string }[]>();

  const known = new Set((existing ?? []).map((row) => `${row.record_a_id}:${row.record_b_id}`));
  const fresh = candidates.filter((candidate) => !known.has(`${candidate.recordA.id}:${candidate.recordB.id}`));

  if (fresh.length > 0) {
    const { error } = await supabase.from("master_data_duplicate_candidates").insert(
      fresh.map((candidate) => ({
        entity_type: entity,
        record_a_id: candidate.recordA.id,
        record_b_id: candidate.recordB.id,
        record_a_label: candidate.recordA.label,
        record_b_label: candidate.recordB.label,
        match_score: candidate.score,
        matched_fields: candidate.matchedFields,
        status: "open",
      })),
    );
    if (error) throw translateDatabaseError(error, "The duplicate candidates");
  }

  await recordMasterAudit(
    {
      action: "master_data.duplicate_resolved",
      entityType: `${entity}_duplicates`,
      entityId: null,
      description: `Duplicate scan for ${entity} records: ${candidates.length} candidate pair(s), ${fresh.length} new.`,
      severity: fresh.length > 0 ? "notice" : "info",
      metadata: { scanned: records.length, candidates: candidates.length, created: fresh.length },
    },
    meta,
  );

  revalidatePath("/master-data/duplicates");
  return { found: candidates.length, created: fresh.length };
}

export async function resolveDuplicate(input: unknown, meta: RequestMeta = {}): Promise<MasterDataDuplicateCandidate> {
  await requirePermission("master_data.duplicates.review");
  const payload = duplicateResolutionSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const profileId = await getActiveProfileId();

  const { data: existing } = await supabase
    .from("master_data_duplicate_candidates")
    .select("*")
    .eq("id", payload.id)
    .maybeSingle<MasterDataDuplicateCandidate>();
  if (!existing) throw new AppError("NOT_FOUND", "That candidate no longer exists.");

  const { data, error } = await supabase
    .from("master_data_duplicate_candidates")
    .update({
      status: payload.status,
      resolution_notes: payload.notes,
      reviewed_by: profileId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", payload.id)
    .select("*")
    .single<MasterDataDuplicateCandidate>();
  if (error) throw translateDatabaseError(error, "The duplicate decision");

  await recordMasterAudit(
    {
      action: "master_data.duplicate_resolved",
      entityType: `${existing.entity_type}_duplicates`,
      entityId: data.id,
      description: `Duplicate candidate marked ${payload.status.replace(/_/g, " ")}. No records were merged or modified.`,
      severity: "warning",
      oldValues: { status: existing.status },
      newValues: { status: data.status, notes: payload.notes },
    },
    meta,
  );

  revalidatePath("/master-data/duplicates");
  return data;
}
