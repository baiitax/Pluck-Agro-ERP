import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { MetricCard } from "@/components/shared/metric-card";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/formatting";
import { labelForQualityStatus, qualityTone } from "@/lib/quality/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { listInspectionReport, getQualityDashboard } from "@/services/quality/reporting";

export const metadata: Metadata = { title: "Quality reports" };
export const dynamic = "force-dynamic";

/**
 * Quality reports.
 *
 * The figures are counts of documents and results over a date range. There is deliberately no quality score, no supplier
 * rating and no "first-pass yield" — each would require a weighting or a definition nobody has agreed, and a confident
 * number built on an invented definition is worse than no number.
 */
export default async function QualityReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; page?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.reports.view")) {
    return <PermissionGuard permission="quality.reports.view" />;
  }

  const params = await searchParams;
  const [page, summary] = await Promise.all([
    listInspectionReport({ from: params.from, to: params.to, page: params.page ? Number(params.page) : 1 }),
    getQualityDashboard(),
  ]);

  const conforming = page.rows.filter((row) => row.result_summary === "conforming").length;
  const nonConforming = page.rows.filter((row) => row.result_summary === "non_conforming").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Quality reports"
        description="Inspections in the selected period, with the verdicts derived from their results. Counts are of documents, not of opinions."
        breadcrumbs={[{ label: "Quality", href: "/quality" }, { label: "Reports" }]}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Inspections in this page" value={page.total} />
        <MetricCard label="Conforming" value={conforming} hint="Within the limits recorded against each result" />
        <MetricCard label="Non-conforming" value={nonConforming} hint="At least one result outside its limits" />
        <MetricCard
          label="Open holds (all time)"
          value={Number(summary.open_holds ?? 0)}
          hint={`${Number(summary.failed_holds ?? 0)} hold(s) failed to restrict stock`}
        />
      </div>

      <Card className="overflow-hidden">
        <FilterBar
          action="/quality/reports"
          fields={[
            { type: "search", name: "from", label: "From (YYYY-MM-DD)", placeholder: "2026-01-01", defaultValue: params.from },
            { type: "search", name: "to", label: "To (YYYY-MM-DD)", placeholder: "2026-12-31", defaultValue: params.to },
          ]}
        />

        {page.rows.length === 0 ? (
          <EmptyState
            title="No inspections in this period"
            description="Widen the date range, or check that inspections have been raised."
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Product</TH>
                    <TH>Lot</TH>
                    <TH>Specification</TH>
                    <TH>Status</TH>
                    <TH>Summary</TH>
                    <TH className="text-right">Results</TH>
                    <TH className="text-right">Failed</TH>
                    <TH className="text-right">Not evaluated</TH>
                    <TH>Approved</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link href={`/quality/inspections/${row.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                          {row.reference}
                        </Link>
                      </TD>
                      <TD>{row.product_name}</TD>
                      <TD className="font-mono text-xs">{row.lot_reference ?? "—"}</TD>
                      <TD className="font-mono text-xs">
                        {row.specification_reference} v{row.specification_version}
                      </TD>
                      <TD>{labelForQualityStatus(row.status)}</TD>
                      <TD>
                        {row.result_summary ? (
                          <Badge tone={qualityTone(row.result_summary)}>{labelForQualityStatus(row.result_summary)}</Badge>
                        ) : (
                          "—"
                        )}
                      </TD>
                      <TD className="text-right tabular-nums">{row.result_count}</TD>
                      <TD className="text-right tabular-nums">{row.non_conforming_count}</TD>
                      <TD className="text-right tabular-nums">{row.not_evaluated_count}</TD>
                      <TD>{row.approved_at ? formatDate(row.approved_at) : "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              baseHref="/quality/reports"
              params={{ from: params.from, to: params.to }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
