import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getCompletenessSummary, getQualityIssues } from "@/services/master-data/quality";

export const metadata: Metadata = { title: "Data quality" };
export const dynamic = "force-dynamic";

const DIMENSIONS = [
  { key: "completeness", label: "Completeness", description: "Required fields present on every record." },
  { key: "uniqueness", label: "Uniqueness", description: "No two live records describe the same partner." },
  { key: "validity", label: "Validity", description: "Values conform to their declared format and vocabulary." },
  { key: "consistency", label: "Consistency", description: "Related records agree with each other." },
  { key: "referential_integrity", label: "Referential integrity", description: "References point at records that exist and are active." },
  { key: "timeliness", label: "Timeliness", description: "Records are reviewed within their defined period." },
];

export default async function QualityPage() {
  const { allowed } = await guardMasterDataPage("master_data.quality.view");
  if (!allowed) return <PermissionGuard permission="master_data.quality.view" />;

  const [issues, completeness] = await Promise.all([getQualityIssues(), getCompletenessSummary()]);
  const totalFlags = issues.reduce((sum, issue) => sum + issue.record_count, 0);

  return (
    <div>
      <PageHeader
        title="Data quality"
        description="Indicators computed from the rows that actually exist. There is no invented score and no weighting: each indicator is a count of records that fail a stated rule, and an indicator with no failures is simply absent."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Data quality" }]}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DIMENSIONS.map((dimension) => {
          const related = issues.filter((issue) => issue.indicator.includes(dimension.key) || dimension.key === "completeness");
          const total = related.reduce((sum, issue) => sum + issue.record_count, 0);
          return (
            <Card key={dimension.key} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-ink">{dimension.label}</p>
                <Badge tone={total > 0 ? "pending" : "success"}>{total > 0 ? `${total} flag(s)` : "clear"}</Badge>
              </div>
              <p className="mt-1 text-[0.6875rem] text-ink-subtle">{dimension.description}</p>
            </Card>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold text-ink">Indicators with failures</h2>
            <p className="text-[0.6875rem] text-ink-subtle">{totalFlags} record(s) affected across {issues.length} indicator(s)</p>
          </div>
          {issues.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No failing indicators"
              description="Either the registers are complete or empty — the completeness panel below shows which. Nothing is reported as healthy unless it was measured."
            />
          ) : (
            <TableWrapper>
              <Table className="min-w-[32rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Rule</TH>
                    <TH>Entity</TH>
                    <TH>Severity</TH>
                    <TH className="text-right">Records</TH>
                  </TR>
                </THead>
                <TBody>
                  {issues.map((issue) => (
                    <TR key={`${issue.entity_type}-${issue.indicator}`}>
                      <TD className="text-xs font-medium text-ink">{issue.description}</TD>
                      <TD className="text-xs">{labelFor(issue.entity_type)}</TD>
                      <TD>
                        <Badge tone={issue.severity === "critical" ? "danger" : issue.severity === "warning" ? "warning" : "neutral"} dot>
                          {labelFor(issue.severity)}
                        </Badge>
                      </TD>
                      <TD className="text-right font-mono text-xs">{issue.record_count}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold text-ink">Completeness</h2>
            <p className="text-[0.6875rem] text-ink-subtle">Share of records that carry each field, across the records you can see.</p>
          </div>
          <ul className="divide-y divide-border">
            {completeness.map((row) => (
              <li key={`${row.entity}-${row.metric}`} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-ink">
                    <span className="font-medium">{row.entity}</span> · {row.metric}
                  </p>
                  <span className="font-mono text-xs text-ink-muted">{row.value}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${row.value}%` }} />
                </div>
                <p className="mt-0.5 text-[0.625rem] text-ink-subtle">{row.total} record(s) measured</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
