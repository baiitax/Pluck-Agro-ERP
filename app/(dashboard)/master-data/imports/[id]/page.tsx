import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DetailList } from "@/components/master-data/detail-list";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { labelFor } from "@/lib/master-data/statuses";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { getImportJob } from "@/services/master-data/imports";

export const metadata: Metadata = { title: "Import job" };
export const dynamic = "force-dynamic";

export default async function ImportJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { allowed } = await guardMasterDataPage("master_data.imports.view");
  if (!allowed) return <PermissionGuard permission="master_data.imports.view" />;

  const result = await getImportJob(id);
  if (!result) notFound();
  const { job, rows } = result;

  return (
    <div>
      <PageHeader
        title={job.file_name}
        description={`${labelFor(job.entity_type)} import · ${job.total_rows} row(s)`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Master data", href: "/master-data" },
          { label: "Imports", href: "/master-data/imports" },
          { label: job.file_name },
        ]}
        badge={
          <Badge tone={job.status === "imported" ? "success" : job.status === "failed" ? "danger" : "neutral"} dot>
            {labelFor(job.status)}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Summary</h2>
          <DetailList
            items={[
              { label: "Type", value: labelFor(job.entity_type) },
              { label: "Status", value: labelFor(job.status) },
              { label: "Total rows", value: job.total_rows },
              { label: "Accepted", value: job.accepted_rows ?? "—" },
              { label: "Rejected", value: job.rejected_rows ?? "—" },
              { label: "Imported", value: job.imported_rows ?? "—" },
              { label: "Duplicate rows", value: job.duplicate_rows ?? "—" },
              { label: "Uploaded", value: new Date(job.created_at).toLocaleString("en-GB") },
              { label: "Confirmed", value: job.confirmed_at ? new Date(job.confirmed_at).toLocaleString("en-GB") : "Not confirmed" },
              { label: "Completed", value: job.completed_at ? new Date(job.completed_at).toLocaleString("en-GB") : "—" },
            ]}
          />
          <Link href="/master-data/imports" className="mt-3 inline-block text-xs font-medium text-brand-700 hover:underline">
            Back to the import centre
          </Link>
        </Card>

        <Card className="overflow-hidden lg:col-span-2">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold text-ink">Rows</h2>
            <p className="text-[0.6875rem] text-ink-subtle">Every uploaded row is kept, including the rejected ones and the reason.</p>
          </div>
          {rows.length === 0 ? (
            <EmptyState title="No rows stored" description="This job has no staged rows. An empty upload produces no rows rather than a silent success." />
          ) : (
            <TableWrapper>
              <Table className="min-w-[48rem]">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH className="w-16">Row</TH>
                    <TH>Status</TH>
                    <TH>Data</TH>
                    <TH>Messages</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((row) => {
                    const errors = (row.errors as { messages?: string[] } | null)?.messages ?? [];
                    return (
                      <TR key={row.id}>
                        <TD className="font-mono text-xs text-ink-muted">{row.row_number}</TD>
                        <TD>
                          <Badge
                            tone={
                              row.status === "imported"
                                ? "success"
                                : row.status === "rejected"
                                  ? "danger"
                                  : row.status === "skipped_duplicate"
                                    ? "warning"
                                    : "neutral"
                            }
                            dot
                          >
                            {labelFor(row.status)}
                          </Badge>
                        </TD>
                        <TD className="max-w-[22rem] truncate text-[0.6875rem] text-ink-muted">
                          {Object.entries(row.raw_data as Record<string, string>)
                            .filter(([, value]) => value)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(" · ")}
                        </TD>
                        <TD className="text-[0.6875rem] text-danger-600">{errors.join("; ") || "—"}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </Card>
      </div>
    </div>
  );
}
