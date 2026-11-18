import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/shared/action-form";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { DISPOSITIONS, labelForQualityStatus, qualityTone } from "@/lib/quality/statuses";
import {
  approveInspectionAction,
  collectSampleAction,
  issueCertificateAction,
  recordDispositionAction,
  recordResultAction,
  submitInspectionAction,
} from "@/app/(dashboard)/quality/actions";
import { requireActiveProfile } from "@/services/authorization";
import { listUnits } from "@/services/inventory/stock";
import { getInspection } from "@/services/quality/inspections";

export const metadata: Metadata = { title: "Inspection" };
export const dynamic = "force-dynamic";

const amount = (value: number | null) =>
  value === null ? "—" : new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(Number(value));

/**
 * One inspection, from results to disposition.
 *
 * The page deliberately shows every parameter the specification expects, not just the ones with results. A screen that
 * only lists what has been filled in makes an incomplete inspection look complete — which is exactly how an unreviewed
 * parameter becomes an assumed pass.
 */
export default async function InspectionDetailPage({ params }: { params: Promise<{ inspectionId: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.inspection.view")) {
    return <PermissionGuard permission="quality.inspection.view" />;
  }

  const { inspectionId } = await params;

  let detail: Awaited<ReturnType<typeof getInspection>>;
  try {
    detail = await getInspection(inspectionId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const { inspection, results, expectedParameters, samples, editable, missingParameterNames } = detail;
  const units = await listUnits();
  const resultByParameter = new Map(results.map((result) => [result.parameter_id, result]));
  const canRecord = principal.permissions.has("quality.result.record");
  const canSubmit = principal.permissions.has("quality.inspection.submit");
  const canApprove = principal.permissions.has("quality.inspection.approve");
  const canDispose = principal.permissions.has("quality.disposition.record");
  const canCertify = principal.permissions.has("quality.certificate.issue");

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Inspection ${inspection.reference}`}
        description={`${inspection.product_name} · lot ${inspection.lot_reference ?? "—"} · ${labelForQualityStatus(
          inspection.stage,
        )} · specification ${inspection.specification_reference} v${inspection.specification_version}`}
        breadcrumbs={[
          { label: "Quality", href: "/quality" },
          { label: "Inspections", href: "/quality/inspections" },
          { label: inspection.reference ?? "Inspection" },
        ]}
        badge={
          <div className="flex gap-2">
            <Badge tone={qualityTone(inspection.status)} dot>
              {labelForQualityStatus(inspection.status)}
            </Badge>
            {inspection.result_summary ? (
              <Badge tone={qualityTone(inspection.result_summary)}>
                {labelForQualityStatus(inspection.result_summary)}
              </Badge>
            ) : null}
          </div>
        }
      />

      {missingParameterNames.length > 0 && editable ? (
        <Alert tone="warning" title="Results outstanding">
          <p>No result recorded yet for: {missingParameterNames.join(", ")}.</p>
          <p className="mt-1 text-xs">
            Submission is refused while a mandatory parameter is missing, unless the policy switch
            inspection.allow_partial_result_submission has been turned on.
          </p>
        </Alert>
      ) : null}

      {inspection.result_summary === "indeterminate" ? (
        <Alert tone="warning" title="Indeterminate">
          <p>
            Something in this inspection could not be judged — a parameter had no limit to compare against, or a
            mandatory result was missing. It is recorded as indeterminate rather than conforming, because calling it a
            pass would be a claim the data does not support.
          </p>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Results against the specification</CardTitle>
        </CardHeader>
        <TableWrapper>
          <Table>
            <THead>
              <TR>
                <TH>Parameter</TH>
                <TH>Type</TH>
                <TH className="text-right">Minimum</TH>
                <TH className="text-right">Maximum</TH>
                <TH>Expected</TH>
                <TH className="text-right">Result</TH>
                <TH>Conformance</TH>
                <TH>Recorded</TH>
              </TR>
            </THead>
            <TBody>
              {expectedParameters.map((line) => {
                const result = resultByParameter.get(line.parameter_id);
                return (
                  <TR key={line.id}>
                    <TD>
                      {line.parameter?.name ?? "—"}
                      {line.is_mandatory ? <span className="ml-1 text-danger-600">*</span> : null}
                    </TD>
                    <TD>{labelForQualityStatus(line.parameter?.result_type ?? null)}</TD>
                    <TD className="text-right tabular-nums">{amount(line.min_value)}</TD>
                    <TD className="text-right tabular-nums">{amount(line.max_value)}</TD>
                    <TD>{line.expected_text ?? "—"}</TD>
                    <TD className="text-right tabular-nums">
                      {result?.value_numeric !== null && result?.value_numeric !== undefined
                        ? amount(result.value_numeric)
                        : (result?.value_text ?? "—")}
                    </TD>
                    <TD>
                      {result ? (
                        <Badge tone={qualityTone(result.conformance)}>{labelForQualityStatus(result.conformance)}</Badge>
                      ) : (
                        <span className="text-ink-subtle">No result</span>
                      )}
                    </TD>
                    <TD className="text-xs text-ink-muted">
                      {result ? formatDate(result.recorded_at) : "—"}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableWrapper>
      </Card>

      {editable && canRecord ? (
        <Card>
          <CardHeader>
            <CardTitle>Record a result</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-ink-muted">
              Conformance is computed from the limits above and cannot be entered. Re-recording a parameter replaces the
              previous value while the inspection is still open; once submitted, results are frozen.
            </p>
            <ActionForm action={recordResultAction} submitLabel="Record result" successMessage="Result recorded." hidden={{ inspectionId }}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="specificationParameterId">Parameter</Label>
                  <Select id="specificationParameterId" name="specificationParameterId" required>
                    <option value="">Select a parameter</option>
                    {expectedParameters.map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.parameter?.name}
                        {line.is_mandatory ? " (mandatory)" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="valueNumeric">Numeric value</Label>
                  <Input id="valueNumeric" name="valueNumeric" inputMode="decimal" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="valueText">Text value</Label>
                  <Input id="valueText" name="valueText" placeholder="For text or pass/fail parameters" />
                </div>
                <div className="space-y-1 sm:col-span-2 lg:col-span-4">
                  <Label htmlFor="notes">Note</Label>
                  <Input id="notes" name="notes" placeholder="Optional" />
                </div>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Samples</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {samples.length === 0 ? (
            <p className="text-ink-muted">No samples recorded against this inspection.</p>
          ) : (
            <ul className="space-y-1">
              {samples.map((sample) => (
                <li key={sample.id}>
                  <span className="font-mono text-xs">{sample.reference}</span> — {amount(sample.quantity)}{" "}
                  {sample.location_note ? `from ${sample.location_note}` : ""}
                  <span className="text-xs text-ink-subtle"> ({formatDateTime(sample.taken_at)})</span>
                </li>
              ))}
            </ul>
          )}
          {editable && canRecord && units.length > 0 ? (
            <div className="pt-2">
              <ActionForm
                action={collectSampleAction}
                submitLabel="Record sample"
                successMessage="Sample recorded."
                hidden={{ inspectionId }}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="quantity">Quantity</Label>
                    <Input id="quantity" name="quantity" inputMode="decimal" required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="unitId">Unit</Label>
                    <Select id="unitId" name="unitId" required>
                      {units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="locationNote">Taken from</Label>
                    <Input id="locationNote" name="locationNote" placeholder="Bag 12, silo 2…" />
                  </div>
                </div>
              </ActionForm>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {inspection.status !== "approved" ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {canSubmit && (inspection.status === "draft" || inspection.status === "in_progress") ? (
            <Card>
              <CardHeader>
                <CardTitle>Submit for approval</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-ink-muted">
                  Submitting computes the summary from the results. It does not approve anything and it does not release
                  stock.
                </p>
                <ActionForm action={submitInspectionAction} submitLabel="Submit" successMessage="Inspection submitted." hidden={{ inspectionId }}>
                  <span />
                </ActionForm>
              </CardContent>
            </Card>
          ) : null}

          {canApprove && inspection.status === "submitted" ? (
            <Card>
              <CardHeader>
                <CardTitle>Approve results</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-ink-muted">
                  Approving the results is not the same as agreeing the material is good — that judgement belongs to the
                  disposition. The person who submitted the inspection cannot approve it unless the policy switch
                  inspection.allow_self_approval is on.
                </p>
                <ActionForm action={approveInspectionAction} submitLabel="Approve" successMessage="Inspection approved." hidden={{ inspectionId }}>
                  <div className="space-y-1">
                    <Label htmlFor="reason">Reason (optional)</Label>
                    <Input id="reason" name="reason" />
                  </div>
                </ActionForm>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {inspection.disposition ? (
        <Alert tone={inspection.disposition === "release" ? "success" : "warning"} title={`Disposition: ${labelForQualityStatus(inspection.disposition)}`}>
          <p>
            {inspection.disposition_reference} recorded against this inspection.
            {inspection.disposition === "release"
              ? " This is what returned the lot's quantity to availability."
              : " The lot remains restricted: this disposition does not make stock usable."}
          </p>
          {inspection.certificate_reference ? (
            <p className="mt-2">
              Certificate{" "}
              <Link className="text-brand-700 hover:underline" href="/quality/certificates">
                {inspection.certificate_reference}
              </Link>{" "}
              issued.
            </p>
          ) : null}
        </Alert>
      ) : null}

      {canDispose && inspection.status === "approved" && !inspection.disposition ? (
        <Card>
          <CardHeader>
            <CardTitle>Record the disposition</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-ink-muted">
              Only <span className="font-medium text-ink">release</span> returns the quantity to availability. Every other
              disposition keeps it restricted, and reject or quarantine place a hold so the reason is on a document.
            </p>
            <ActionForm action={recordDispositionAction} submitLabel="Record disposition" successMessage="Disposition recorded." hidden={{ inspectionId }} redirectTo="/quality/dispositions">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="disposition">Disposition</Label>
                  <Select id="disposition" name="disposition" required defaultValue="release">
                    {DISPOSITIONS.map((value) => (
                      <option key={value} value={value}>
                        {labelForQualityStatus(value)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input id="quantity" name="quantity" inputMode="decimal" placeholder="Leave empty for the lot's on-hand quantity" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="reason">Statement</Label>
                  <Input id="reason" name="reason" required placeholder="What this decision rests on (at least 10 characters)" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="instruction">Instruction</Label>
                  <Input id="instruction" name="instruction" placeholder="For rework or downgrade: what must happen to the material" />
                </div>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      {canCertify && inspection.status === "approved" && inspection.disposition === "release" && !inspection.certificate_reference ? (
        <Card>
          <CardHeader>
            <CardTitle>Issue a certificate of analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-ink-muted">
              The certificate is a frozen snapshot of these results and the limits they were judged against. Laboratory
              name and accreditation reference are optional and must come from a real document — the system never
              generates either, and the statement it prints says so.
            </p>
            <ActionForm action={issueCertificateAction} submitLabel="Issue certificate" successMessage="Certificate issued." hidden={{ inspectionId }} redirectTo="/quality/certificates">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="issuedTo">Issued to</Label>
                  <Input id="issuedTo" name="issuedTo" placeholder="Customer or consignee" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="remarks">Remarks</Label>
                  <Input id="remarks" name="remarks" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="laboratoryName">Laboratory</Label>
                  <Input id="laboratoryName" name="laboratoryName" placeholder="Only if stated on your own documents" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="accreditationReference">Accreditation reference</Label>
                  <Input id="accreditationReference" name="accreditationReference" placeholder="Leave empty unless you hold one" />
                </div>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
