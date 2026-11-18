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
import { formatDate, formatDateTime } from "@/lib/formatting";
import { labelForQualityStatus, qualityTone } from "@/lib/quality/statuses";
import {
  addSpecificationLineAction,
  approveSpecificationAction,
  removeSpecificationLineAction,
} from "@/app/(dashboard)/quality/actions";
import { AppError } from "@/lib/errors";
import { requireActiveProfile } from "@/services/authorization";
import { getSpecification, listParameters } from "@/services/quality/specifications";

export const metadata: Metadata = { title: "Specification" };
export const dynamic = "force-dynamic";

const amount = (value: number | null) =>
  value === null ? "—" : new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(Number(value));

/**
 * A specification and its limits.
 *
 * While the version is a draft, lines can be added and removed — the database guard allows exactly that and nothing
 * more. Once approved, the page stops offering edits and says why: inspections were judged against these limits, and a
 * limit that can be changed afterwards makes every verdict derived from it worthless.
 */
export default async function SpecificationDetailPage({
  params,
}: {
  params: Promise<{ specificationId: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.specification.view")) {
    return <PermissionGuard permission="quality.specification.view" />;
  }

  const { specificationId } = await params;

  let detail: Awaited<ReturnType<typeof getSpecification>>;
  try {
    detail = await getSpecification(specificationId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const { specification, lines, effectiveReference, inspectionCount } = detail;
  const isDraft = specification.status === "draft";
  const parameters = isDraft ? await listParameters() : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${specification.reference} — ${specification.product_name}`}
        description={`Version ${specification.version} for the ${labelForQualityStatus(specification.stage)} stage.`}
        breadcrumbs={[
          { label: "Quality", href: "/quality" },
          { label: "Specifications", href: "/quality/specifications" },
          { label: specification.reference ?? "Specification" },
        ]}
        badge={
          <Badge tone={qualityTone(specification.status)} dot>
            {labelForQualityStatus(specification.status)}
          </Badge>
        }
      />

      {specification.status === "approved" && effectiveReference === specification.reference ? (
        <Alert tone="success" title="This is the version in force">
          <p>Inspections raised for this product and stage today are judged against this version.</p>
        </Alert>
      ) : null}

      {specification.status === "superseded" ? (
        <Alert tone="info" title="Superseded">
          <p>
            A later version replaced this one. It is kept, not deleted, because inspections recorded against it must
            still be able to explain their verdict.
          </p>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Header</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-ink-muted">Product</dt>
              <dd className="font-medium text-ink">
                {specification.product_code} — {specification.product_name}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Stage</dt>
              <dd>{labelForQualityStatus(specification.stage)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Effective from</dt>
              <dd>{specification.effective_from ? formatDate(specification.effective_from) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Approved</dt>
              <dd>
                {specification.approved_at
                  ? `${formatDateTime(specification.approved_at)}${specification.approved_by_name ? ` by ${specification.approved_by_name}` : ""}`
                  : "Not approved"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Supersedes</dt>
              <dd>{specification.supersedes_reference ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Inspections against this version</dt>
              <dd className="tabular-nums">{inspectionCount}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Parameter lines</CardTitle>
        </CardHeader>
        {lines.length === 0 ? (
          <CardContent>
            <p className="text-sm text-ink-muted">
              No parameter lines yet. A specification cannot be approved until it has at least one, and until every
              mandatory line can produce a verdict.
            </p>
          </CardContent>
        ) : (
          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Parameter</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Minimum</TH>
                  <TH className="text-right">Maximum</TH>
                  <TH className="text-right">Target</TH>
                  <TH>Expected</TH>
                  <TH>Criticality</TH>
                  <TH>Mandatory</TH>
                  <TH>Method</TH>
                  {isDraft && principal.permissions.has("quality.specification.update") ? <TH /> : null}
                </TR>
              </THead>
              <TBody>
                {lines.map((line, index) => (
                  <TR key={line.id}>
                    <TD className="tabular-nums text-ink-subtle">{index + 1}</TD>
                    <TD>{line.parameter?.name ?? "—"}</TD>
                    <TD>{labelForQualityStatus(line.parameter?.result_type ?? null)}</TD>
                    <TD className="text-right tabular-nums">{amount(line.min_value)}</TD>
                    <TD className="text-right tabular-nums">{amount(line.max_value)}</TD>
                    <TD className="text-right tabular-nums">{amount(line.target_value)}</TD>
                    <TD>{line.expected_text ?? "—"}</TD>
                    <TD>
                      <Badge tone={line.criticality === "critical" ? "danger" : line.criticality === "major" ? "warning" : "neutral"}>
                        {labelForQualityStatus(line.criticality)}
                      </Badge>
                    </TD>
                    <TD>{line.is_mandatory ? "Yes" : "No"}</TD>
                    <TD className="max-w-[16rem] truncate text-xs text-ink-muted" title={line.method_reference ?? ""}>
                      {line.method_reference ?? line.parameter?.method_reference ?? "Not stated"}
                    </TD>
                    {isDraft && principal.permissions.has("quality.specification.update") ? (
                      <TD>
                        <ActionForm
                          action={removeSpecificationLineAction}
                          submitLabel="Remove"
                          successMessage="Line removed."
                          hidden={{ lineId: line.id }}
                        >
                          <span />
                        </ActionForm>
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      {isDraft && principal.permissions.has("quality.specification.update") ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a parameter line</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={addSpecificationLineAction} submitLabel="Add line" successMessage="Line added." hidden={{ specificationId }}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="parameterId">Parameter</Label>
                  <Select id="parameterId" name="parameterId" required>
                    <option value="">Select a parameter</option>
                    {parameters.map((parameter) => (
                      <option key={parameter.id} value={parameter.id}>
                        {parameter.name} ({labelForQualityStatus(parameter.result_type)})
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="minValue">Minimum</Label>
                  <Input id="minValue" name="minValue" inputMode="decimal" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="maxValue">Maximum</Label>
                  <Input id="maxValue" name="maxValue" inputMode="decimal" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="targetValue">Target</Label>
                  <Input id="targetValue" name="targetValue" inputMode="decimal" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="expectedText">Expected value (text / pass-fail)</Label>
                  <Input id="expectedText" name="expectedText" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="criticality">Criticality</Label>
                  <Select id="criticality" name="criticality" defaultValue="major">
                    <option value="critical">Critical</option>
                    <option value="major">Major</option>
                    <option value="minor">Minor</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="isMandatory">Mandatory</Label>
                  <Select id="isMandatory" name="isMandatory" defaultValue="on">
                    <option value="on">Yes — must carry a result</option>
                    <option value="off">No</option>
                  </Select>
                </div>
                <div className="space-y-1 sm:col-span-2 lg:col-span-4">
                  <Label htmlFor="methodReference">Method reference</Label>
                  <Input id="methodReference" name="methodReference" placeholder="Optional" />
                </div>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      {isDraft && principal.permissions.has("quality.specification.approve") ? (
        <Card>
          <CardHeader>
            <CardTitle>Approve this version</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink-muted">
              Approving supersedes the currently approved version for this product and stage. Approval is refused if any
              mandatory line has neither a limit nor an expected value — the refusal names the parameters, rather than
              creating a specification that can only ever pass.
            </p>
            <ActionForm
              action={approveSpecificationAction}
              submitLabel="Approve version"
              successMessage="Specification approved."
              hidden={{ specificationId }}
            >
              <div className="space-y-1">
                <Label htmlFor="reason">Reason (optional)</Label>
                <Input id="reason" name="reason" placeholder="Why this version is being approved" />
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      {!isDraft ? (
        <Alert tone="info" title="This version is read-only">
          <p>
            Lines cannot be changed once a specification is approved: the inspections recorded against it were judged on
            exactly these limits. To change a limit, create a new version.
          </p>
          <p className="mt-2">
            <Link className="text-brand-700 hover:underline" href="/quality/specifications/new">
              Create a new version
            </Link>
          </p>
        </Alert>
      ) : null}

      <p className="font-mono text-xs text-ink-subtle">{specification.reference}</p>
    </div>
  );
}
