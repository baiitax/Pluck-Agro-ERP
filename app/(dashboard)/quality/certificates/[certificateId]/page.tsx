import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/shared/action-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { labelForQualityStatus, qualityTone } from "@/lib/quality/statuses";
import { voidCertificateAction } from "@/app/(dashboard)/quality/actions";
import { requireActiveProfile } from "@/services/authorization";
import { getCertificate } from "@/services/quality/dispositions";

export const metadata: Metadata = { title: "Certificate of analysis" };
export const dynamic = "force-dynamic";

type CertificateContent = {
  product?: { code?: string; name?: string };
  lot?: { reference?: string; received_date?: string | null; expiry_date?: string | null; grade?: string | null };
  specification?: { reference?: string; version?: number; stage?: string; method_reference?: string | null };
  inspection?: { reference?: string; inspected_at?: string | null; approved_at?: string | null; result_summary?: string };
  disposition?: { reference?: string; disposition?: string; quantity?: number; decided_at?: string | null };
  results?: {
    parameter?: string;
    result_type?: string;
    value_numeric?: number | null;
    value_text?: string | null;
    unit?: string | null;
    min_value?: number | null;
    max_value?: number | null;
    expected_text?: string | null;
    conformance?: string;
    method_reference?: string | null;
    criticality?: string;
  }[];
};

const amount = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(Number(value));

/**
 * A certificate, as issued.
 *
 * Everything on this page comes from the frozen `content` snapshot, not from live tables. That is the point: if the
 * specification is superseded tomorrow, this certificate must still say exactly what it said when the customer received
 * it.
 */
export default async function CertificateDetailPage({ params }: { params: Promise<{ certificateId: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.certificate.view")) {
    return <PermissionGuard permission="quality.certificate.view" />;
  }

  const { certificateId } = await params;
  let detail: Awaited<ReturnType<typeof getCertificate>>;
  try {
    detail = await getCertificate(certificateId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const { certificate, register } = detail;
  const content = certificate.content as CertificateContent;
  const canVoid = principal.permissions.has("quality.certificate.issue");

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Certificate of analysis ${certificate.reference}`}
        description={`${content.product?.code ?? ""} ${content.product?.name ?? ""} · lot ${content.lot?.reference ?? ""}`}
        breadcrumbs={[
          { label: "Quality", href: "/quality" },
          { label: "Certificates", href: "/quality/certificates" },
          { label: certificate.reference ?? "Certificate" },
        ]}
        badge={
          <Badge tone={qualityTone(certificate.status)} dot>
            {labelForQualityStatus(certificate.status)}
          </Badge>
        }
      />

      {certificate.status === "superseded" ? (
        <Alert tone="warning" title="Superseded">
          <p>
            A later version of this certificate replaced it. Both are kept: a customer may still be holding this one, and
            the register has to be able to explain what it said.
          </p>
        </Alert>
      ) : null}

      {certificate.status === "void" ? (
        <Alert tone="danger" title="Void">
          <p>{certificate.void_reason}</p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Certificate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-ink-muted">Issued to</dt>
              <dd>{register?.customer_name ?? certificate.issued_to ?? "Not stated"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Version</dt>
              <dd className="tabular-nums">{certificate.version}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Issued</dt>
              <dd>{formatDateTime(certificate.issued_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Laboratory</dt>
              <dd>{certificate.laboratory_name ?? "Not stated"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Accreditation reference</dt>
              <dd>{certificate.accreditation_reference ?? "None claimed"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Specification</dt>
              <dd className="font-mono text-xs">
                {content.specification?.reference} v{content.specification?.version}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Inspection</dt>
              <dd>
                {content.inspection?.reference ? (
                  <Link className="text-brand-700 hover:underline" href={`/quality/inspections/${certificate.inspection_id}`}>
                    {content.inspection.reference}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Disposition</dt>
              <dd className="font-mono text-xs">{content.disposition?.reference}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Received</dt>
              <dd>{content.lot?.received_date ? formatDate(content.lot.received_date) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Expiry</dt>
              <dd>{content.lot?.expiry_date ? formatDate(content.lot.expiry_date) : "—"}</dd>
            </div>
          </dl>

          <div className="rounded-md border border-border bg-surface-muted p-3 text-xs text-ink-muted">
            {certificate.statement}
          </div>

          {certificate.remarks ? (
            <p className="text-sm">
              <span className="text-xs text-ink-muted">Remarks: </span>
              {certificate.remarks}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Results, as issued</CardTitle>
        </CardHeader>
        <TableWrapper>
          <Table>
            <THead>
              <TR>
                <TH>Parameter</TH>
                <TH className="text-right">Minimum</TH>
                <TH className="text-right">Maximum</TH>
                <TH>Expected</TH>
                <TH className="text-right">Result</TH>
                <TH>Conformance</TH>
                <TH>Method</TH>
              </TR>
            </THead>
            <TBody>
              {(content.results ?? []).map((row, index) => (
                <TR key={`${row.parameter}-${index}`}>
                  <TD>{row.parameter}</TD>
                  <TD className="text-right tabular-nums">{amount(row.min_value)}</TD>
                  <TD className="text-right tabular-nums">{amount(row.max_value)}</TD>
                  <TD>{row.expected_text ?? "—"}</TD>
                  <TD className="text-right tabular-nums">
                    {row.value_numeric !== null && row.value_numeric !== undefined
                      ? `${amount(row.value_numeric)}${row.unit ? ` ${row.unit}` : ""}`
                      : (row.value_text ?? "—")}
                  </TD>
                  <TD>
                    <Badge tone={qualityTone(row.conformance)}>{labelForQualityStatus(row.conformance)}</Badge>
                  </TD>
                  <TD className="max-w-[16rem] truncate text-xs text-ink-muted" title={row.method_reference ?? ""}>
                    {row.method_reference ?? "Not stated"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      </Card>

      {canVoid && certificate.status === "issued" ? (
        <Card>
          <CardHeader>
            <CardTitle>Void this certificate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-ink-muted">
              Voiding keeps the certificate and records why. A certificate that was wrong is never deleted, because a
              deleted certificate cannot be reconciled with the copy a customer holds.
            </p>
            <ActionForm
              action={voidCertificateAction}
              submitLabel="Void"
              successMessage="Certificate voided."
              hidden={{ certificateId: certificate.id }}
            >
              <div className="space-y-1">
                <Label htmlFor="reason">Reason</Label>
                <Input id="reason" name="reason" required placeholder="At least 10 characters" />
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
