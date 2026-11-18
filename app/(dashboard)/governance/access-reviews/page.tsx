import type { Metadata } from "next";
import { UserSearch } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { RecordReviewDialog } from "@/components/governance/access-review-form";
import { currentReviewPeriod, recentReviewPeriods, reviewPeriodLabel } from "@/lib/governance/review-period";
import { formatDateTime } from "@/lib/formatting";
import { requirePermission } from "@/services/authorization";
import { getAccessReviews } from "@/services/governance/access-reviews";
import { getUserAccounts } from "@/services/users/get-users";

export const metadata: Metadata = { title: "Access reviews" };
export const dynamic = "force-dynamic";

const STATUS_TONE = { pending: "pending", in_review: "info", completed: "success", flagged: "danger" } as const;
const DECISION_TONE = { retain: "success", amend: "warning", revoke: "danger" } as const;

export default async function AccessReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const principal = await requirePermission("governance.reviews.view");
  const params = await searchParams;
  const requested = Array.isArray(params.period) ? params.period[0] : params.period;
  const period = requested || currentReviewPeriod();

  const [reviews, accounts] = await Promise.all([getAccessReviews(period), getUserAccounts()]);
  const canManage = principal.permissions.has("governance.reviews.manage");

  const reviewedUserIds = new Set(reviews.map((review) => review.user_id).filter(Boolean));
  const outstanding = accounts.filter(
    (account) => account.account_status !== "deactivated" && !reviewedUserIds.has(account.id),
  );

  return (
    <div>
      <PageHeader
        title="Access reviews"
        description={`Access review evidence for ${reviewPeriodLabel(period)}. Recording a decision does not itself change access — revocation is performed through the account lifecycle, so the two decisions stay separate and both are audited.`}
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Governance" }, { label: "Access reviews" }]}
        actions={
          canManage ? (
            <RecordReviewDialog
              reviewPeriod={period}
              accounts={outstanding.map((account) => ({
                id: account.id,
                label: `${account.display_name ?? account.id.slice(0, 8)} · ${account.account_status}`,
              }))}
            />
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[0.6875rem] text-ink-subtle">
        <span>Periods:</span>
        {recentReviewPeriods(4).map((candidate) => (
          <a
            key={candidate}
            href={`/governance/access-reviews?period=${candidate}`}
            className={
              candidate === period
                ? "rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-800"
                : "rounded-full px-2 py-0.5 hover:bg-surface-sunken"
            }
          >
            {reviewPeriodLabel(candidate)}
          </a>
        ))}
      </div>

      <div className="erp-card overflow-hidden">
        {reviews.length === 0 ? (
          <EmptyState
            icon={UserSearch}
            title="No reviews recorded for this period"
            description={
              canManage
                ? `${outstanding.length} account(s) have not been reviewed for ${period}. Record each review with a finding and a decision.`
                : "No access reviews have been recorded for this period yet."
            }
          />
        ) : (
          <TableWrapper>
            <Table className="min-w-[52rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Account</TH>
                  <TH>Period</TH>
                  <TH>Reviewer</TH>
                  <TH>Status</TH>
                  <TH>Decision</TH>
                  <TH>Findings</TH>
                  <TH>Reviewed</TH>
                </TR>
              </THead>
              <TBody>
                {reviews.map((review) => (
                  <TR key={review.id}>
                    <TD className="text-xs">
                      <span className="font-medium text-ink">{review.user?.display_name ?? "Unknown account"}</span>
                      <span className="block text-[0.625rem] text-ink-subtle">{review.user?.account_status ?? ""}</span>
                    </TD>
                    <TD className="text-xs">{review.review_period}</TD>
                    <TD className="text-xs">{review.reviewer?.display_name ?? "—"}</TD>
                    <TD>
                      <Badge tone={(STATUS_TONE as Record<string, BadgeTone>)[review.review_status] ?? "neutral"} dot>
                        {review.review_status.replace(/_/g, " ")}
                      </Badge>
                    </TD>
                    <TD>
                      {review.decision ? (
                        <Badge tone={(DECISION_TONE as Record<string, BadgeTone>)[review.decision] ?? "neutral"}>
                          {review.decision}
                        </Badge>
                      ) : (
                        <span className="text-[0.6875rem] text-ink-subtle">—</span>
                      )}
                    </TD>
                    <TD className="max-w-sm text-[0.6875rem] text-ink-muted">{review.findings ?? "—"}</TD>
                    <TD className="text-[0.6875rem] text-ink-muted">
                      {review.reviewed_at ? formatDateTime(review.reviewed_at) : "Not completed"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {reviews.length} review(s) in {reviewPeriodLabel(period)} ·{" "}
        {reviews.filter((review) => review.review_status === "completed").length} completed · {outstanding.length}{" "}
        account(s) still unreviewed.
      </p>
    </div>
  );
}
