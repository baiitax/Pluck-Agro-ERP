import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";

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
  QUALITY_STAGES,
  SPECIFICATION_STATUSES,
  labelForQualityStatus,
  qualityTone,
} from "@/lib/quality/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { listSpecifications } from "@/services/quality/specifications";

export const metadata: Metadata = { title: "Quality specifications" };
export const dynamic = "force-dynamic";

/**
 * Specifications.
 *
 * A version is a document, not a preference: approving a new version supersedes the previous one and the old version
 * is kept, because inspections were judged against it. The list therefore shows every version, with its status, rather
 * than only the current one.
 */
export default async function SpecificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; stage?: string; page?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.specification.view")) {
    return <PermissionGuard permission="quality.specification.view" />;
  }

  const params = await searchParams;
  const page = await listSpecifications({
    status: params.status,
    stage: params.stage,
    page: params.page ? Number(params.page) : 1,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Specifications"
        description="What an inspection is judged against. Limits are company data: no specification can be approved unless every mandatory parameter has something to judge against."
        breadcrumbs={[{ label: "Quality", href: "/quality" }, { label: "Specifications" }]}
        actions={
          principal.permissions.has("quality.specification.create") ? (
            <Link href="/quality/specifications/new" className={cn(buttonVariants({ size: "sm" }))}>
              New specification
            </Link>
          ) : undefined
        }
      />

      <Card className="overflow-hidden">
        <FilterBar
          action="/quality/specifications"
          fields={[
            {
              type: "select",
              name: "status",
              label: "Status",
              options: [
                { value: "", label: "All statuses" },
                ...SPECIFICATION_STATUSES.map((status) => ({
                  value: status,
                  label: labelForQualityStatus(status),
                })),
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
            icon={ScrollText}
            title="No specifications"
            description="Nothing matches this filter. A specification starts as a draft and only judges anything once it is approved."
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Product</TH>
                    <TH>Stage</TH>
                    <TH>Version</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Parameters</TH>
                    <TH>Effective from</TH>
                    <TH>Approved</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link
                          href={`/quality/specifications/${row.id}`}
                          className="font-mono text-xs font-medium text-brand-700 hover:underline"
                        >
                          {row.reference}
                        </Link>
                      </TD>
                      <TD>
                        <span className="font-mono text-xs text-ink-subtle">{row.product_code}</span>
                        <span className="ml-2">{row.product_name}</span>
                      </TD>
                      <TD>{labelForQualityStatus(row.stage)}</TD>
                      <TD className="tabular-nums">{row.version}</TD>
                      <TD>
                        <Badge tone={qualityTone(row.status)} dot>
                          {labelForQualityStatus(row.status)}
                        </Badge>
                      </TD>
                      <TD className="text-right tabular-nums">
                        {row.parameter_count}
                        {row.mandatory_parameter_count ? (
                          <span className="text-ink-subtle"> ({row.mandatory_parameter_count} required)</span>
                        ) : null}
                      </TD>
                      <TD>{row.effective_from ? formatDate(row.effective_from) : "—"}</TD>
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
              baseHref="/quality/specifications"
              params={{ status: params.status, stage: params.stage }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
