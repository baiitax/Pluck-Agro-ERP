import type { Metadata } from "next";
import Link from "next/link";
import { Boxes } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { labelForQualityStatus, qualityTone } from "@/lib/quality/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { listLotQuality } from "@/services/quality/reporting";

export const metadata: Metadata = { title: "Lot traceability" };
export const dynamic = "force-dynamic";

const amount = (value: number | null) =>
  value === null ? "—" : new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value));

/**
 * Lot quality position — the answer to "may this stock be used?".
 *
 * The quantity columns are Phase 4's own availability figures, not a second calculation, and the `quality_status`
 * column is derived from the latest disposition and the live restrictions. The two are shown together so a reader can
 * see a released lot with restricted stock (a hold added after release) rather than a single reassuring word.
 */
export default async function TraceabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ qualityStatus?: string; page?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.traceability.view")) {
    return <PermissionGuard permission="quality.traceability.view" />;
  }

  const params = await searchParams;
  const page = await listLotQuality({
    qualityStatus: params.qualityStatus,
    page: params.page ? Number(params.page) : 1,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Traceability"
        description="Every lot with its quality position, the disposition that decided it and any hold still in force. Quantities are the inventory ledger's own figures."
        breadcrumbs={[{ label: "Quality", href: "/quality" }, { label: "Traceability" }]}
      />

      <Card className="overflow-hidden">
        <FilterBar
          action="/quality/traceability"
          fields={[
            {
              type: "select",
              name: "qualityStatus",
              label: "Quality position",
              options: [
                { value: "", label: "All positions" },
                { value: "released", label: "Released" },
                { value: "pending_inspection", label: "Pending inspection" },
                { value: "held", label: "Held" },
                { value: "rejected", label: "Rejected" },
                { value: "restricted", label: "Restricted" },
                { value: "not_inspected", label: "Not inspected" },
              ],
              defaultValue: params.qualityStatus,
            },
          ]}
        />

        {page.rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No lots"
            description="Nothing matches this filter. Lots appear here as soon as stock exists, whether or not it has been inspected."
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Lot</TH>
                    <TH>Product</TH>
                    <TH>Warehouse</TH>
                    <TH>Position</TH>
                    <TH className="text-right">On hand</TH>
                    <TH className="text-right">Restricted</TH>
                    <TH className="text-right">Available</TH>
                    <TH>Latest inspection</TH>
                    <TH>Disposition</TH>
                    <TH>Certificate</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.rows.map((row) => (
                    <TR key={row.lot_id}>
                      <TD className="font-mono text-xs font-medium">{row.lot_reference}</TD>
                      <TD>{row.product_name}</TD>
                      <TD className="text-xs text-ink-muted">{row.warehouse_name}</TD>
                      <TD>
                        <Badge tone={qualityTone(row.quality_status)} dot>
                          {labelForQualityStatus(row.quality_status)}
                        </Badge>
                      </TD>
                      <TD className="text-right tabular-nums">{amount(row.on_hand_quantity)}</TD>
                      <TD className="text-right tabular-nums">{amount(row.restricted_quantity)}</TD>
                      <TD className="text-right tabular-nums font-medium">{amount(row.available_quantity)}</TD>
                      <TD>
                        {row.latest_inspection_id ? (
                          <Link
                            href={`/quality/inspections/${row.latest_inspection_id}`}
                            className="font-mono text-xs text-brand-700 hover:underline"
                          >
                            {row.latest_inspection_reference}
                          </Link>
                        ) : (
                          <span className="text-ink-subtle">None</span>
                        )}
                      </TD>
                      <TD>
                        {row.disposition ? (
                          <Badge tone={qualityTone(row.disposition)}>{labelForQualityStatus(row.disposition)}</Badge>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </TD>
                      <TD className="font-mono text-xs">{row.certificate_reference ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              baseHref="/quality/traceability"
              params={{ qualityStatus: params.qualityStatus }}
            />
          </>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What this view does not claim</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-ink-muted">
          Traceability is assembled from posted records: the movements the ledger holds, the batches that consumed or
          produced each lot, and the inspections and dispositions attached to it. Nothing here is reconstructed from
          paperwork, and where a link was never recorded the column says so rather than inferring one.
        </CardContent>
      </Card>
    </div>
  );
}
