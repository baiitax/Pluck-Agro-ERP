import "server-only";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePermission } from "@/services/authorization";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { Database } from "@/types/database.types";
import {
  callQualityRpc,
  numeric,
  pageOf,
  recordQualityAudit,
  type RegisterPage,
} from "@/services/quality/shared";

type DispositionRow = Database["public"]["Tables"]["quality_dispositions"]["Row"];
type ReleaseRegisterRow = Database["public"]["Views"]["quality_release_register"]["Row"];
type HoldRow = Database["public"]["Tables"]["quality_holds"]["Row"];
type OpenHoldRow = Database["public"]["Views"]["quality_open_holds"]["Row"];
type CertificateRow = Database["public"]["Tables"]["quality_certificates"]["Row"];
type CertificateRegisterRow = Database["public"]["Views"]["quality_certificate_register"]["Row"];

/**
 * Dispositions, holds and certificates — everything that decides what stock may be used.
 *
 * Each of these wraps a database function rather than writing a table, because the tables are granted read-only to
 * clients. That is not ceremony: if a client could insert a disposition it could release a lot without an inspection,
 * and the whole phase would be decorative. The function is where the permission, the lifecycle rule and the inventory
 * integration meet in one transaction.
 */

export async function listDispositions(
  filters: { disposition?: string; page?: number } = {},
): Promise<RegisterPage<ReleaseRegisterRow>> {
  await requirePermission("quality.disposition.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;

  let query = supabase
    .from("quality_release_register")
    .select("*", { count: "exact" })
    .order("decided_at", { ascending: false });
  if (filters.disposition) query = query.eq("disposition", filters.disposition);

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Dispositions could not be loaded. ${error.message}`);

  return pageOf(data ?? [], page, pageSize, count ?? 0);
}

export async function recordDisposition(
  input: {
    inspectionId: string;
    disposition: string;
    reason: string;
    quantity?: string;
    instruction?: string;
    nextReviewDate?: string;
  },
  meta: RequestMeta = {},
): Promise<DispositionRow> {
  await requirePermission("quality.disposition.record");

  const decision = await callQualityRpc<DispositionRow>("quality_record_disposition", {
    p_inspection_id: input.inspectionId,
    p_disposition: input.disposition,
    p_reason: input.reason,
    p_quantity: input.quantity ? numeric(input.quantity) : null,
    p_instruction: input.instruction || null,
    p_next_review_date: input.nextReviewDate || null,
  });

  await recordQualityAudit(
    {
      action: "quality.disposition.recorded",
      entityType: "quality_disposition",
      entityId: decision.id,
      description: `Disposition ${decision.reference}: ${decision.disposition} for lot ${decision.lot_id} (${decision.quantity}).`,
      // A release changes what may be sold or issued, so it is recorded at a higher severity than the others.
      severity: decision.disposition === "release" ? "warning" : "notice",
      newValues: { disposition: decision.disposition, quantity: decision.quantity, reason: decision.reason },
    },
    meta,
  );

  return decision;
}

export async function revokeDisposition(
  dispositionId: string,
  reason: string,
  meta: RequestMeta = {},
): Promise<DispositionRow> {
  await requirePermission("quality.disposition.release");

  const decision = await callQualityRpc<DispositionRow>("quality_revoke_disposition", {
    p_disposition_id: dispositionId,
    p_reason: reason,
  });

  await recordQualityAudit(
    {
      action: "quality.disposition.revoked",
      entityType: "quality_disposition",
      entityId: dispositionId,
      description: `Disposition ${decision.reference} revoked: ${reason}`,
      severity: "critical",
      newValues: { status: decision.status, revocation_reason: reason },
    },
    meta,
  );

  return decision;
}

export async function listHolds(): Promise<OpenHoldRow[]> {
  await requirePermission("quality.disposition.view");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quality_open_holds")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<OpenHoldRow[]>();
  if (error) throw new AppError("DATABASE_ERROR", `Quality holds could not be loaded. ${error.message}`);
  return data ?? [];
}

export async function placeHold(
  input: { lotId: string; quantity: string; reasonCode: string; reason: string; inspectionId?: string },
  meta: RequestMeta = {},
): Promise<HoldRow> {
  await requirePermission("quality.disposition.hold");

  const hold = await callQualityRpc<HoldRow>("quality_place_hold", {
    p_lot_id: input.lotId,
    p_quantity: numeric(input.quantity),
    p_reason_code: input.reasonCode,
    p_reason: input.reason,
    p_inspection_id: input.inspectionId || null,
  });

  await recordQualityAudit(
    {
      action: "quality.hold.placed",
      entityType: "quality_hold",
      entityId: hold.id,
      description:
        hold.restriction_state === "confirmed"
          ? `Hold ${hold.reference} placed on lot ${hold.lot_id}; the inventory restriction was applied.`
          : `Hold ${hold.reference} FAILED to restrict stock: ${hold.failure_reason}`,
      // A hold that did not take effect is a defect in control, not a routine event.
      severity: hold.restriction_state === "failed" ? "critical" : "notice",
      newValues: {
        quantity: hold.quantity,
        reason_code: hold.reason_code,
        restriction_state: hold.restriction_state,
      },
    },
    meta,
  );

  return hold;
}

export async function releaseHold(
  input: { holdId: string; quantity?: string; reason: string },
  meta: RequestMeta = {},
): Promise<HoldRow> {
  await requirePermission("quality.disposition.release");

  const hold = await callQualityRpc<HoldRow>("quality_release_hold", {
    p_hold_id: input.holdId,
    p_quantity: input.quantity ? numeric(input.quantity) : null,
    p_reason: input.reason,
  });

  await recordQualityAudit(
    {
      action: "quality.hold.released",
      entityType: "quality_hold",
      entityId: input.holdId,
      description: `Hold ${hold.reference} released: ${input.reason}`,
      newValues: { released_at: hold.released_at, release_reason: input.reason },
    },
    meta,
  );

  return hold;
}

export async function listCertificates(
  filters: { status?: string; page?: number } = {},
): Promise<RegisterPage<CertificateRegisterRow>> {
  await requirePermission("quality.certificate.view");
  const supabase = await createSupabaseServerClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = 25;

  let query = supabase
    .from("quality_certificate_register")
    .select("*", { count: "exact" })
    .order("issued_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new AppError("DATABASE_ERROR", `Certificates could not be loaded. ${error.message}`);

  return pageOf(data ?? [], page, pageSize, count ?? 0);
}

export async function getCertificate(certificateId: string): Promise<{
  certificate: CertificateRow;
  register: CertificateRegisterRow | null;
}> {
  await requirePermission("quality.certificate.view");
  const supabase = await createSupabaseServerClient();

  const [{ data: certificate, error }, { data: register }] = await Promise.all([
    supabase
      .from("quality_certificates")
      .select("*")
      .eq("id", certificateId)
      .maybeSingle<CertificateRow>(),
    supabase
      .from("quality_certificate_register")
      .select("*")
      .eq("id", certificateId)
      .maybeSingle<CertificateRegisterRow>(),
  ]);

  if (error) throw new AppError("DATABASE_ERROR", `That certificate could not be loaded. ${error.message}`);
  if (!certificate) throw new AppError("NOT_FOUND", "That certificate does not exist, or you cannot see it.");

  return { certificate, register: register ?? null };
}

export async function issueCertificate(
  input: {
    inspectionId: string;
    issuedTo?: string;
    customerId?: string;
    remarks?: string;
    laboratoryName?: string;
    accreditationReference?: string;
  },
  meta: RequestMeta = {},
): Promise<CertificateRow> {
  await requirePermission("quality.certificate.issue");

  const certificate = await callQualityRpc<CertificateRow>("quality_issue_certificate", {
    p_inspection_id: input.inspectionId,
    p_issued_to: input.issuedTo || null,
    p_customer_id: input.customerId || null,
    p_remarks: input.remarks || null,
    p_laboratory_name: input.laboratoryName || null,
    p_accreditation_reference: input.accreditationReference || null,
  });

  await recordQualityAudit(
    {
      action: "quality.certificate.issued",
      entityType: "quality_certificate",
      entityId: certificate.id,
      description: `Certificate of analysis ${certificate.reference} issued for lot ${certificate.lot_id}.`,
      newValues: {
        issued_to: certificate.issued_to,
        laboratory_name: certificate.laboratory_name,
        accreditation_reference: certificate.accreditation_reference,
        version: certificate.version,
      },
    },
    meta,
  );

  return certificate;
}

export async function voidCertificate(
  certificateId: string,
  reason: string,
  meta: RequestMeta = {},
): Promise<CertificateRow> {
  await requirePermission("quality.certificate.issue");

  const certificate = await callQualityRpc<CertificateRow>("quality_void_certificate", {
    p_certificate_id: certificateId,
    p_reason: reason,
  });

  await recordQualityAudit(
    {
      action: "quality.certificate.voided",
      entityType: "quality_certificate",
      entityId: certificateId,
      description: `Certificate ${certificate.reference} voided: ${reason}`,
      severity: "warning",
      newValues: { status: certificate.status, void_reason: reason },
    },
    meta,
  );

  return certificate;
}
