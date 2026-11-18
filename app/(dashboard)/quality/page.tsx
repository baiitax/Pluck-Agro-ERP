import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, FileWarning, FlaskConical, ShieldAlert, ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { MetricCard } from "@/components/shared/metric-card";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { labelForQualityStatus, qualityTone } from "@/lib/quality/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { listHolds } from "@/services/quality/dispositions";
import { listInspections } from "@/services/quality/inspections";
import { getQualityDashboard } from "@/services/quality/reporting";

export const metadata: Metadata = { title: "Quality control" };
export const dynamic = "force-dynamic";

const number = (value: number | string | null) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

/**
 * Quality overview.
 *
 * The figures come from `quality_dashboard_summary`, which reads the documents and Phase 4's availability view. Two
 * numbers are shown on purpose even when they are zero: `failed holds`, because a hold that did not take effect is a
 * defect in control rather than a rounding error, and `awaiting approval`, because an unapproved inspection cannot
 * release anything.
 */
export default async function QualityPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.dashboard.view") && !principal.permissions.has("quality.inspection.view")) {
    return <PermissionGuard permission="quality.dashboard.view" />;
  }

  const [summary, awaiting, holds] = await Promise.all([
    getQualityDashboard(),
    listInspections({ status: "submitted" }),
    listHolds(),
  ]);

  const failedHolds = holds.filter((hold) => hold.restriction_state === "failed");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Quality control"
        description="Inspections against approved specifications, and the dispositions that decide whether stock may be used. A hold takes stock out of availability through the inventory ledger; a release is the only thing that puts it back."
        breadcrumbs={[{ label: "Quality" }]}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Inspections in progress" value={number(summary.inspections_in_progress)} icon={FlaskConical} />
        <MetricCard
          label="Awaiting approval"
          value={number(summary.inspections_awaiting_approval)}
          hint="An unapproved inspection cannot release stock."
          icon={ClipboardCheck}
        />
        <MetricCard
          label="Open quality holds"
          value={number(summary.open_holds)}
          hint={`${number(summary.total_restricted_quantity)} restricted in total`}
          icon={ShieldAlert}
        />
        <MetricCard
          label="Failed holds"
          value={number(summary.failed_holds)}
          hint="Holds the inventory side refused. These restrict nothing."
          icon={ShieldAlert}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Open non-conformances" value={number(summary.open_ncrs)} icon={FileWarning} />
        <MetricCard label="Open actions" value={number(summary.open_capa_actions)} hint={`${number(summary.overdue_capa_actions)} overdue`} icon={FileWarning} />
        <MetricCard label="Certificates issued" value={number(summary.certificates_issued)} icon={ShieldCheck} />
        <MetricCard label="Available stock" value={number(summary.total_available_quantity)} hint="Released and unrestricted quantity only" icon={ShieldCheck} />
      </div>

      {failedHolds.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Holds that did not take effect</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-ink-muted">
              These holds were recorded but the inventory side refused the restriction, so the quantity is still
              available. They are listed here rather than being hidden, because a hold that restricts nothing is worse
              than no hold at all — it looks like control.
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {failedHolds.map((hold) => (
                <li key={hold.id}>
                  <Link href={`/quality/holds`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                    {hold.reference}
                  </Link>{" "}
                  — {hold.lot_reference}: {hold.failure_reason}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Inspections awaiting approval</CardTitle>
        </CardHeader>
        {awaiting.rows.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Nothing awaiting approval"
            description="A submitted inspection appears here. Approval is a separate step and a separate permission."
          />
        ) : (
          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <TH>Reference</TH>
                  <TH>Product</TH>
                  <TH>Lot</TH>
                  <TH>Stage</TH>
                  <TH>Summary</TH>
                  <TH>Submitted</TH>
                </TR>
              </THead>
              <TBody>
                {awaiting.rows.map((row) => (
                  <TR key={row.id}>
                    <TD>
                      <Link href={`/quality/inspections/${row.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                        {row.reference}
                      </Link>
                    </TD>
                    <TD>{row.product_name}</TD>
                    <TD className="font-mono text-xs">{row.lot_reference}</TD>
                    <TD>{labelForQualityStatus(row.stage)}</TD>
                    <TD>
                      <Badge tone={qualityTone(row.result_summary)} dot>
                        {labelForQualityStatus(row.result_summary)}
                      </Badge>
                    </TD>
                    <TD>{row.submitted_at ? formatDate(row.submitted_at) : "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </Card>
    </div>
  );
}
