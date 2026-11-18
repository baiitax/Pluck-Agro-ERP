import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDateTime } from "@/lib/formatting";
import { labelForStatus } from "@/lib/procurement/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { getLegacyReadiness } from "@/services/procurement/dashboard";

export const metadata: Metadata = { title: "Legacy migration readiness" };
export const dynamic = "force-dynamic";

/**
 * Legacy migration readiness.
 *
 * This screen reports what an import would face. It does not connect to the legacy database, it does not
 * map anything automatically, and it never presents an unmatched row as matched. The honest position —
 * that no connection exists and no import has been run — is stated in the page rather than left to
 * inference from an empty table.
 */
export default async function LegacyReadinessPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("procurement.legacy.view")) {
    return <PermissionGuard permission="procurement.legacy.view" />;
  }

  const readiness = await getLegacyReadiness();
  const statusCounts = new Map(readiness.rowCounts.map((entry) => [entry.status, entry.count]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Legacy migration readiness"
        description="What a move from the legacy procurement system would involve: which source tables have been assessed, what has been mapped, and what remains ambiguous."
        breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Legacy readiness" }]}
      />

      <Alert tone="warning" title="No connection to the legacy database">
        This system does not connect to the legacy system. Nothing on this page is live legacy data: it is the record of
        assessments performed against extracts. An import that has never been run leaves this page empty, and an empty
        page is the honest answer.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Assessed source tables", value: readiness.imports.length },
          { label: "Matched rows", value: statusCounts.get("matched") ?? 0 },
          { label: "Unmatched rows", value: statusCounts.get("unmatched") ?? 0 },
          { label: "Ambiguous rows", value: statusCounts.get("ambiguous") ?? 0 },
        ].map((metric) => (
          <Card key={metric.label}>
            <CardContent className="py-4">
              <p className="text-xs text-ink-muted">{metric.label}</p>
              <p className="text-xl font-semibold tabular-nums text-ink">{metric.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assessments</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {readiness.imports.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-ink-muted">
              No legacy assessment has been recorded. Import readiness is unknown, which is not the same as ready.
            </p>
          ) : (
            <TableWrapper>
              <Table className="min-w-[56rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Source table</TH>
                    <TH>Description</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Rows</TH>
                    <TH className="text-right">Mapped</TH>
                    <TH className="text-right">Unmatched</TH>
                    <TH className="text-right">Ambiguous</TH>
                    <TH className="text-right">Duplicates</TH>
                    <TH className="text-right">Orphans</TH>
                    <TH>Recorded</TH>
                  </TR>
                </THead>
                <TBody>
                  {readiness.imports.map((entry) => (
                    <TR key={entry.id}>
                      <TD className="font-medium">{entry.source_table}</TD>
                      <TD className="max-w-[16rem] text-xs text-ink-muted">{entry.description ?? "—"}</TD>
                      <TD>
                        <Badge tone={entry.status === "imported" ? "success" : entry.status === "abandoned" ? "danger" : "neutral"}>
                          {labelForStatus(entry.status)}
                        </Badge>
                      </TD>
                      <TD className="text-right tabular-nums">{entry.total_rows}</TD>
                      <TD className="text-right tabular-nums">{entry.mapped_rows}</TD>
                      <TD className="text-right tabular-nums">
                        {entry.unmatched_rows > 0 ? <span className="text-warning-700">{entry.unmatched_rows}</span> : 0}
                      </TD>
                      <TD className="text-right tabular-nums">{entry.ambiguous_rows}</TD>
                      <TD className="text-right tabular-nums">{entry.duplicate_rows}</TD>
                      <TD className="text-right tabular-nums">{entry.orphan_rows}</TD>
                      <TD className="text-xs text-ink-muted">{formatDateTime(entry.created_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What is already in place</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-ink-muted">
          <p>
            {readiness.totalLegacyReferences} legacy record reference(s) are recorded. Each one ties a legacy identifier to
            the record that replaced it, so an old document number can still be found.
          </p>
          <p>
            Import rows carry their own match status — matched, unmatched, ambiguous, duplicate, orphan or ignored — and a
            confidence figure. A row is never matched on a name alone, and no automatic merge of supplier or product
            records exists by design.
          </p>
          <p>
            Nothing here creates procurement transactions. Historical opening balances are a Finance decision, and this
            system does not assert a balance the legacy source has not been approved to support.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
