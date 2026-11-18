import type { Metadata } from "next";
import Link from "next/link";
import { FileWarning } from "lucide-react";

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
import { NCR_SEVERITIES, NCR_STATUSES, labelForQualityStatus, qualityTone } from "@/lib/quality/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { listNcrs } from "@/services/quality/ncr";

export const metadata: Metadata = { title: "Non-conformance" };
export const dynamic = "force-dynamic";

/**
 * Non-conformance register.
 *
 * An NCR is about the process, not the stock: closing one never implies the material was dealt with, and rejecting
 * material never implies the cause was found. The open-action count is shown because an NCR with unfinished actions
 * cannot honestly be closed.
 */
export default async function NcrPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; severity?: string; page?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.ncr.view")) {
    return <PermissionGuard permission="quality.ncr.view" />;
  }

  const params = await searchParams;
  const page = await listNcrs({
    status: params.status,
    severity: params.severity,
    page: params.page ? Number(params.page) : 1,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Non-conformance"
        description="What went wrong, what was contained, and what is being corrected. Closing a report is refused while any corrective or preventive action is still open."
        breadcrumbs={[{ label: "Quality", href: "/quality" }, { label: "Non-conformance" }]}
        actions={
          principal.permissions.has("quality.ncr.create") ? (
            <Link href="/quality/ncr/new" className={cn(buttonVariants({ size: "sm" }))}>
              Raise non-conformance
            </Link>
          ) : undefined
        }
      />

      <Card className="overflow-hidden">
        <FilterBar
          action="/quality/ncr"
          fields={[
            {
              type: "select",
              name: "status",
              label: "Status",
              options: [
                { value: "", label: "All statuses" },
                ...NCR_STATUSES.map((status) => ({ value: status, label: labelForQualityStatus(status) })),
              ],
              defaultValue: params.status,
            },
            {
              type: "select",
              name: "severity",
              label: "Severity",
              options: [
                { value: "", label: "All severities" },
                ...NCR_SEVERITIES.map((severity) => ({ value: severity, label: labelForQualityStatus(severity) })),
              ],
              defaultValue: params.severity,
            },
          ]}
        />

        {page.rows.length === 0 ? (
          <EmptyState
            icon={FileWarning}
            title="No non-conformances"
            description="Nothing matches this filter. A non-conformance can be raised from a failed inspection, a supplier problem, an internal deviation or a complaint."
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Title</TH>
                    <TH>Severity</TH>
                    <TH>Source</TH>
                    <TH>Lot</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Actions</TH>
                    <TH>Raised</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link href={`/quality/ncr/${row.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                          {row.reference}
                        </Link>
                      </TD>
                      <TD className="max-w-[20rem] truncate">{row.title}</TD>
                      <TD>
                        <Badge tone={qualityTone(row.severity)} dot>
                          {labelForQualityStatus(row.severity)}
                        </Badge>
                      </TD>
                      <TD>{labelForQualityStatus(row.source)}</TD>
                      <TD className="font-mono text-xs">{row.lot_reference ?? "—"}</TD>
                      <TD>
                        <Badge tone={qualityTone(row.status)}>{labelForQualityStatus(row.status)}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums">
                        {row.action_count}
                        {row.open_action_count ? (
                          <span className="text-pending-600"> ({row.open_action_count} open)</span>
                        ) : null}
                      </TD>
                      <TD>{formatDate(row.detected_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              baseHref="/quality/ncr"
              params={{ status: params.status, severity: params.severity }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
