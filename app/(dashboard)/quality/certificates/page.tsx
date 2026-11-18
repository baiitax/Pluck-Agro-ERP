import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { CERTIFICATE_STATUSES, labelForQualityStatus, qualityTone } from "@/lib/quality/statuses";
import { requireActiveProfile } from "@/services/authorization";
import { listCertificates } from "@/services/quality/dispositions";

export const metadata: Metadata = { title: "Certificates of analysis" };
export const dynamic = "force-dynamic";

/**
 * Certificate register.
 *
 * A certificate is issued only from an approved, released inspection, and it is a snapshot: reissuing supersedes the
 * previous certificate and keeps both. The list shows superseded versions for that reason — a customer may be holding
 * one, and the register must be able to explain what it said.
 */
export default async function CertificatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.certificate.view")) {
    return <PermissionGuard permission="quality.certificate.view" />;
  }

  const params = await searchParams;
  const page = await listCertificates({ status: params.status, page: params.page ? Number(params.page) : 1 });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Certificates of analysis"
        description="Issued from an approved inspection whose disposition was release. Each one is a frozen snapshot of the results and the limits they were judged against."
        breadcrumbs={[{ label: "Quality", href: "/quality" }, { label: "Certificates" }]}
      />

      <Alert tone="info" title="What a certificate from this system is, and is not">
        <p>
          It is a reproduction of results recorded in this system, with the specification version and disposition that
          justified them. It is not a statement by an external laboratory or an accreditation body. Any laboratory name
          or accreditation reference shown was entered by a person from a real document; when nothing was entered, nothing
          is claimed.
        </p>
      </Alert>

      <Card className="overflow-hidden">
        <FilterBar
          action="/quality/certificates"
          fields={[
            {
              type: "select",
              name: "status",
              label: "Status",
              options: [
                { value: "", label: "All statuses" },
                ...CERTIFICATE_STATUSES.map((status) => ({ value: status, label: labelForQualityStatus(status) })),
              ],
              defaultValue: params.status,
            },
          ]}
        />

        {page.rows.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No certificates"
            description="A certificate can only be issued once an inspection is approved and its disposition is release. Nothing matches this filter yet."
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Status</TH>
                    <TH>Version</TH>
                    <TH>Lot</TH>
                    <TH>Product</TH>
                    <TH>Issued to</TH>
                    <TH>Inspection</TH>
                    <TH>Issued</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link href={`/quality/certificates/${row.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                          {row.reference}
                        </Link>
                      </TD>
                      <TD>
                        <Badge tone={qualityTone(row.status)} dot>
                          {labelForQualityStatus(row.status)}
                        </Badge>
                      </TD>
                      <TD className="tabular-nums">{row.version}</TD>
                      <TD className="font-mono text-xs">{row.lot_reference}</TD>
                      <TD>{row.product_name}</TD>
                      <TD>{row.customer_name ?? row.issued_to ?? "—"}</TD>
                      <TD className="font-mono text-xs">{row.inspection_reference}</TD>
                      <TD>{formatDate(row.issued_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              baseHref="/quality/certificates"
              params={{ status: params.status }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
