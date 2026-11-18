import type { Metadata } from "next";
import Link from "next/link";

import { ImportUploader } from "@/app/(dashboard)/master-data/imports/import-uploader";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getImportJobs } from "@/services/master-data/imports";

export const metadata: Metadata = { title: "Import centre" };
export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const { allowed, principal } = await guardMasterDataPage("master_data.imports.view");
  if (!allowed) return <PermissionGuard permission="master_data.imports.view" />;

  const jobs = await getImportJobs();
  const canExecute = principal.permissions.has("master_data.imports.execute");

  return (
    <div>
      <PageHeader
        title="Import centre"
        description="Bulk master data entry with a staged, reviewable pipeline: parse, validate, map, preview, confirm. Every uploaded row is stored with its verdict, so a rejected row can be corrected and retried instead of vanishing."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data", href: "/master-data" }, { label: "Imports" }]}
      />

      {canExecute ? (
        <div className="mb-4">
          <ImportUploader />
        </div>
      ) : (
        <Card className="mb-4 p-3">
          <p className="text-xs text-ink-muted">
            You can review import history. Running an import needs the{" "}
            <code className="rounded bg-surface-sunken px-1 py-0.5 text-[0.6875rem]">master_data.imports.execute</code> permission, because a confirmed
            import writes master records in bulk.
          </p>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">Import history</h2>
          <p className="text-[0.6875rem] text-ink-subtle">
            An identical file is refused a second time: the batch key is derived from the file content, so a repeated upload cannot duplicate records.
          </p>
        </div>
        {jobs.length === 0 ? (
          <EmptyState title="No imports yet" description="Uploaded files appear here with their row counts, verdicts and who confirmed them." />
        ) : (
          <TableWrapper>
            <Table className="min-w-[54rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>File</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Rows</TH>
                  <TH className="text-right">Accepted</TH>
                  <TH className="text-right">Rejected</TH>
                  <TH className="text-right">Imported</TH>
                  <TH>Uploaded</TH>
                </TR>
              </THead>
              <TBody>
                {jobs.map((job) => (
                  <TR key={job.id}>
                    <TD className="text-xs">
                      <Link href={`/master-data/imports/${job.id}`} className="font-medium text-ink hover:text-brand-700 hover:underline">
                        {job.file_name}
                      </Link>
                    </TD>
                    <TD className="text-xs">{labelFor(job.entity_type)}</TD>
                    <TD>
                      <Badge tone={job.status === "imported" ? "success" : job.status === "failed" ? "danger" : "neutral"} dot>
                        {labelFor(job.status)}
                      </Badge>
                    </TD>
                    <TD className="text-right font-mono text-xs">{job.total_rows}</TD>
                    <TD className="text-right font-mono text-xs">{job.accepted_rows ?? "—"}</TD>
                    <TD className="text-right font-mono text-xs">{job.rejected_rows ?? "—"}</TD>
                    <TD className="text-right font-mono text-xs">{job.imported_rows ?? "—"}</TD>
                    <TD className="text-[0.6875rem] text-ink-subtle">{new Date(job.created_at).toLocaleString("en-GB")}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {jobs.length} job(s) recorded · failed rows are never silently discarded; they remain attached to their job with the validation messages that rejected them.
      </p>
    </div>
  );
}
