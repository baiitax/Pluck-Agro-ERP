import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3 } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireActiveProfile } from "@/services/authorization";
import { PROCUREMENT_REPORTS, getProcurementDataQuality } from "@/services/procurement/reports";

export const metadata: Metadata = { title: "Procurement reports" };
export const dynamic = "force-dynamic";

const GROUP_LABELS: Record<string, string> = {
  requisitions: "Requisitions",
  sourcing: "Sourcing and quotations",
  orders: "Purchase orders",
  receiving: "Receiving",
  suppliers: "Suppliers and money",
  governance: "Approvals and audit",
};

/**
 * The report catalogue.
 *
 * Every report is a database view, not a query assembled in TypeScript, so a figure in a report and the
 * same figure on a document come from one definition. Each entry states its own limitation: a report
 * that hides what it cannot tell you invites the reader to assume it can.
 */
export default async function ProcurementReportsPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.reports.view")) {
    return <PermissionGuard permission="procurement.reports.view" />;
  }

  const quality = await getProcurementDataQuality();
  const groups = Array.from(new Set(PROCUREMENT_REPORTS.map((report) => report.group)));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Procurement reports"
        description="Every report reads a database view. Filters run on the server, dates filter the report's own date column, and rows are capped — a report is a reading of the record, not a replacement for it."
        breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Reports" }]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Data quality</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {quality.length === 0 ? (
            <p className="text-xs text-ink-muted">
              No data-quality indicators are configured, so none are reported. Their absence is not a statement that the
              data is clean.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {quality.map((indicator) => (
                <li
                  key={`${indicator.entity_type}-${indicator.indicator}`}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <div>
                    <p className="text-xs font-medium text-ink">{indicator.description}</p>
                    <p className="text-[0.6875rem] text-ink-subtle">
                      {indicator.entity_type} · {indicator.indicator}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-xs text-ink">{indicator.record_count}</span>
                    <Badge
                      tone={
                        indicator.severity === "high" ? "danger" : indicator.severity === "medium" ? "warning" : "neutral"
                      }
                    >
                      {indicator.severity}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Alert tone="info" title="How to read these reports">
        A commitment is not a debt, an estimate is not a price, and a receipt is not stock. Where a report mixes two of
        those ideas, its limitation says so in the report itself.
      </Alert>

      {groups.map((group) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle>{GROUP_LABELS[group] ?? group}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {PROCUREMENT_REPORTS.filter((report) => report.group === group).map((report) => (
              <div key={report.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <div className="max-w-3xl">
                  <Link href={`/procurement/reports/${report.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                    {report.title}
                  </Link>
                  <p className="text-xs text-ink-muted">{report.description}</p>
                  <p className="pt-0.5 text-[0.6875rem] text-ink-subtle">{report.limitations}</p>
                </div>
                <div className="flex items-center gap-2 text-[0.6875rem] text-ink-subtle">
                  {report.dateColumn ? <Badge tone="neutral">Date filter</Badge> : null}
                  {report.currencyColumn ? <Badge tone="neutral">Currency</Badge> : null}
                  <span>{report.columns.length} columns</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {PROCUREMENT_REPORTS.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-xs text-ink-muted">
            <BarChart3 className="size-4" aria-hidden /> No reports are registered.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
