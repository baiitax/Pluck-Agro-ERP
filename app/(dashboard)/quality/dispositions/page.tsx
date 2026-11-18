import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { DISPOSITIONS, labelForQualityStatus, qualityTone } from "@/lib/quality/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { listDispositions } from "@/services/quality/dispositions";

export const metadata: Metadata = { title: "Quality dispositions" };
export const dynamic = "force-dynamic";

const amount = (value: number | null) =>
  value === null ? "—" : new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value));

/**
 * Dispositions — the register of quality decisions.
 *
 * Every row here is a decision that was applied to stock, and the reason is shown in full rather than truncated: the
 * sentence is the evidence. A release is highlighted because it is the only value in this table that makes quantity
 * available again.
 */
export default async function DispositionsPage({
  searchParams,
}: {
  searchParams: Promise<{ disposition?: string; page?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.disposition.view")) {
    return <PermissionGuard permission="quality.disposition.view" />;
  }

  const params = await searchParams;
  const page = await listDispositions({
    disposition: params.disposition,
    page: params.page ? Number(params.page) : 1,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dispositions"
        description="The quality decision recorded against each approved inspection, and the stock consequence that followed. Only a release returns quantity to availability."
        breadcrumbs={[{ label: "Quality", href: "/quality" }, { label: "Dispositions" }]}
      />

      <Card className="overflow-hidden">
        <FilterBar
          action="/quality/dispositions"
          fields={[
            {
              type: "select",
              name: "disposition",
              label: "Disposition",
              options: [
                { value: "", label: "All dispositions" },
                ...DISPOSITIONS.map((value) => ({ value, label: labelForQualityStatus(value) })),
              ],
              defaultValue: params.disposition,
            },
          ]}
        />

        {page.rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No dispositions"
            description="A disposition is recorded against an approved inspection. Nothing has been decided yet, or nothing matches this filter."
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Disposition</TH>
                    <TH>Lot</TH>
                    <TH>Product</TH>
                    <TH className="text-right">Quantity</TH>
                    <TH>Inspection</TH>
                    <TH>Statement</TH>
                    <TH>Decided</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.rows.map((row) => (
                    <TR key={row.id}>
                      <TD className="font-mono text-xs font-medium text-brand-700">{row.reference}</TD>
                      <TD>
                        <Badge tone={qualityTone(row.disposition)} dot>
                          {labelForQualityStatus(row.disposition)}
                        </Badge>
                      </TD>
                      <TD className="font-mono text-xs">{row.lot_reference}</TD>
                      <TD>{row.product_name}</TD>
                      <TD className="text-right tabular-nums">
                        {amount(row.quantity)} {row.unit_code}
                      </TD>
                      <TD>
                        <Link
                          href={`/quality/inspections/${row.inspection_id}`}
                          className="font-mono text-xs text-brand-700 hover:underline"
                        >
                          {row.inspection_reference}
                        </Link>
                      </TD>
                      <TD className="max-w-[22rem] text-xs text-ink-muted">{row.reason}</TD>
                      <TD>{formatDate(row.decided_at)}</TD>
                      <TD>
                        <Badge tone={qualityTone(row.status)}>{labelForQualityStatus(row.status)}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              baseHref="/quality/dispositions"
              params={{ disposition: params.disposition }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
