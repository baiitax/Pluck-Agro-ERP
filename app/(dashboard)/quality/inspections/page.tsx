import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import {
  INSPECTION_STATUSES,
  QUALITY_STAGES,
  labelForQualityStatus,
  qualityTone,
} from "@/lib/quality/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { listInspections } from "@/services/quality/inspections";

export const metadata: Metadata = { title: "Quality inspections" };
export const dynamic = "force-dynamic";

/**
 * Inspections.
 *
 * The `Summary` column is the derived verdict: conforming, non-conforming, or indeterminate when something could not be
 * judged. `indeterminate` is shown rather than hidden because a blank where a verdict should be is how an unreviewed
 * inspection gets read as a pass.
 */
export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; stage?: string; page?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.inspection.view")) {
    return <PermissionGuard permission="quality.inspection.view" />;
  }

  const params = await searchParams;
  const page = await listInspections({
    status: params.status,
    stage: params.stage,
    page: params.page ? Number(params.page) : 1,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inspections"
        description="Each inspection judges one lot against one approved specification version. Results are compared to the recorded limits by the database — a verdict cannot be typed in."
        breadcrumbs={[{ label: "Quality", href: "/quality" }, { label: "Inspections" }]}
        actions={
          principal.permissions.has("quality.inspection.manage") ? (
            <Link href="/quality/inspections/new" className={cn(buttonVariants({ size: "sm" }))}>
              New inspection
            </Link>
          ) : undefined
        }
      />

      <Card className="overflow-hidden">
        <FilterBar
          action="/quality/inspections"
          fields={[
            {
              type: "select",
              name: "status",
              label: "Status",
              options: [
                { value: "", label: "All statuses" },
                ...INSPECTION_STATUSES.map((status) => ({ value: status, label: labelForQualityStatus(status) })),
              ],
              defaultValue: params.status,
            },
            {
              type: "select",
              name: "stage",
              label: "Stage",
              options: [
                { value: "", label: "All stages" },
                ...QUALITY_STAGES.map((stage) => ({ value: stage, label: labelForQualityStatus(stage) })),
              ],
              defaultValue: params.stage,
            },
          ]}
        />

        {page.rows.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            title="No inspections"
            description="Nothing matches this filter. An inspection starts from an approved specification and the lot it is judging."
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
                    <TH>Stage</TH>
                    <TH>Specification</TH>
                    <TH>Status</TH>
                    <TH>Summary</TH>
                    <TH className="text-right">Results</TH>
                    <TH>Disposition</TH>
                    <TH>Created</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link
                          href={`/quality/inspections/${row.id}`}
                          className="font-mono text-xs font-medium text-brand-700 hover:underline"
                        >
                          {row.reference}
                        </Link>
                      </TD>
                      <TD>{row.product_name}</TD>
                      <TD className="font-mono text-xs">{row.lot_reference ?? "—"}</TD>
                      <TD>{labelForQualityStatus(row.stage)}</TD>
                      <TD className="font-mono text-xs">{row.specification_reference} v{row.specification_version}</TD>
                      <TD>
                        <Badge tone={qualityTone(row.status)} dot>
                          {labelForQualityStatus(row.status)}
                        </Badge>
                      </TD>
                      <TD>
                        {row.result_summary ? (
                          <Badge tone={qualityTone(row.result_summary)}>{labelForQualityStatus(row.result_summary)}</Badge>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {row.result_count}
                        {row.non_conforming_count ? (
                          <span className="text-danger-600"> ({row.non_conforming_count} failed)</span>
                        ) : null}
                      </TD>
                      <TD>
                        {row.disposition ? (
                          <Badge tone={qualityTone(row.disposition)}>{labelForQualityStatus(row.disposition)}</Badge>
                        ) : (
                          <span className="text-ink-subtle">Not decided</span>
                        )}
                      </TD>
                      <TD>{formatDate(row.created_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              baseHref="/quality/inspections"
              params={{ status: params.status, stage: params.stage }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
