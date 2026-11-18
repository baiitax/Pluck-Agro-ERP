import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { isValidReviewPeriod } from "@/lib/governance/review-period";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { accessReviewUpsertSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/services/authorization";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { AccessReviewRecord } from "@/types/database.types";

export type ReviewWithPeople = AccessReviewRecord & {
  employee: { id: string; employee_number: string; first_name: string; last_name: string } | null;
  reviewer: { id: string; display_name: string | null } | null;
  user: { id: string; display_name: string | null; account_status: string } | null;
};

const SELECT =
  "*, employee:employees(id, employee_number, first_name, last_name), reviewer:profiles!access_review_records_reviewer_user_id_fkey(id, display_name), user:profiles!access_review_records_user_id_fkey(id, display_name, account_status)";

export async function getAccessReviews(period?: string): Promise<ReviewWithPeople[]> {
  const supabase = await createSupabaseServerClient();
  let request = supabase.from("access_review_records").select(SELECT);
  if (period) request = request.eq("review_period", period);
  const { data, error } = await request
    .order("created_at", { ascending: false })
    .limit(500)
    .returns<ReviewWithPeople[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Creates or updates an access-review record. Reviews are governance evidence: a decision of
 * `revoke` does NOT revoke access by itself — it records that a reviewer decided it should be
 * revoked, and the revocation is then performed through the account lifecycle actions.
 */
export async function saveAccessReview(
  input: unknown,
  meta: RequestMeta = {},
): Promise<AccessReviewRecord> {
  const actor = await requirePermission("governance.reviews.manage");
  const payload = accessReviewUpsertSchema.parse(input);

  if (!isValidReviewPeriod(payload.reviewPeriod)) {
    throw new AppError("VALIDATION_ERROR", "Use a period such as 2026-Q4 or 2026-11.");
  }

  const supabase = await createSupabaseServerClient();
  const record = {
    review_period: payload.reviewPeriod,
    user_id: payload.userId,
    reviewer_user_id: actor.user.id,
    review_status: payload.reviewStatus,
    findings: payload.findings?.trim() || null,
    decision: payload.decision || null,
    reviewed_at: payload.reviewStatus === "completed" ? new Date().toISOString() : null,
  };

  const { data, error } = payload.id
    ? await supabase
        .from("access_review_records")
        .update(record)
        .eq("id", payload.id)
        .select("*")
        .single<AccessReviewRecord>()
    : await supabase
        .from("access_review_records")
        .insert({ ...record, created_by: actor.user.id })
        .select("*")
        .single<AccessReviewRecord>();

  if (error) {
    if (error.code === "23505") {
      throw new AppError("CONFLICT", "A review for this account and period already exists.");
    }
    throw new Error(error.message);
  }

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: payload.id ? "access_review.updated" : "access_review.created",
    eventCategory: "governance",
    severity: payload.decision === "revoke" ? "warning" : "info",
    module: "governance",
    entityType: "access_review_record",
    entityId: data.id,
    description: `Recorded an access review for period ${data.review_period} with decision ${data.decision ?? "none"}.`,
    newValues: {
      review_period: data.review_period,
      user_id: data.user_id,
      review_status: data.review_status,
      decision: data.decision,
    },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/governance/access-reviews");
  return data;
}
