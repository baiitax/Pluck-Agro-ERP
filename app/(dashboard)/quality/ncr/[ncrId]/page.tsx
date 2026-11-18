import type { Metadata } from "next";
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
import { CAPA_STATUSES, CAPA_TYPES, labelForQualityStatus, qualityTone } from "@/lib/quality/statuses";
import {
  closeNcrAction,
  createCapaAction,
  updateCapaAction,
  updateNcrAction,
  verifyCapaAction,
} from "@/app/(dashboard)/quality/actions";
import { requireActiveProfile } from "@/services/authorization";
import { getNcr } from "@/services/quality/ncr";

export const metadata: Metadata = { title: "Non-conformance" };
export const dynamic = "force-dynamic";

/**
 * One non-conformance and its corrective actions.
 *
 * The close form is offered only when no action is open, and the database refuses anyway — the button is a courtesy, not
 * the control. Verification is a separate permission and a separate step from completion, because an owner marking their
 * own action "done" is a claim, not evidence.
 */
export default async function NcrDetailPage({ params }: { params: Promise<{ ncrId: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("quality.ncr.view")) {
    return <PermissionGuard permission="quality.ncr.view" />;
  }

  const { ncrId } = await params;
  let detail: Awaited<ReturnType<typeof getNcr>>;
  try {
    detail = await getNcr(ncrId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const { ncr, actions } = detail;
  const isOpen = ncr.status === "open" || ncr.status === "investigating";
  const openActions = actions.filter((action) => action.status === "open" || action.status === "in_progress");

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${ncr.reference} — ${ncr.title}`}
        description={`Raised ${formatDate(ncr.detected_at)}${ncr.detected_by_name ? ` by ${ncr.detected_by_name}` : ""} from ${labelForQualityStatus(ncr.source)}.`}
        breadcrumbs={[
          { label: "Quality", href: "/quality" },
          { label: "Non-conformance", href: "/quality/ncr" },
          { label: ncr.reference ?? "Report" },
        ]}
        badge={
          <div className="flex gap-2">
            <Badge tone={qualityTone(ncr.status)} dot>
              {labelForQualityStatus(ncr.status)}
            </Badge>
            <Badge tone={qualityTone(ncr.severity)}>{labelForQualityStatus(ncr.severity)}</Badge>
          </div>
        }
      />

      {openActions.length > 0 ? (
        <Alert tone="warning" title={`${openActions.length} action(s) still open`}>
          <p>This report cannot be closed until every corrective and preventive action is complete or cancelled.</p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-xs text-ink-muted">What happened</p>
            <p className="text-ink">{ncr.title}</p>
          </div>
          <div>
            <p className="text-xs text-ink-muted">Root cause</p>
            <p className="text-ink">{ncr.root_cause ?? "Not established yet."}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-ink-muted">Lot</p>
              <p className="font-mono text-xs">{ncr.lot_reference ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Inspection</p>
              <p className="font-mono text-xs">{ncr.inspection_reference ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Supplier</p>
              <p>{ncr.supplier_name ?? "—"}</p>
            </div>
          </div>
          {ncr.closed_at ? (
            <p className="text-xs text-ink-muted">Closed {formatDateTime(ncr.closed_at)}.</p>
          ) : null}
        </CardContent>
      </Card>

      {isOpen && principal.permissions.has("quality.ncr.update") ? (
        <Card>
          <CardHeader>
            <CardTitle>Investigation</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={updateNcrAction} submitLabel="Save investigation" successMessage="Saved." hidden={{ ncrId }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="rootCause">Root cause</Label>
                  <Input id="rootCause" name="rootCause" placeholder="What actually caused it, once established" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="containmentAction">Containment</Label>
                  <Input id="containmentAction" name="containmentAction" placeholder="What stopped it spreading" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="status">Move to investigating</Label>
                  <Select id="status" name="status" defaultValue="">
                    <option value="">Leave status unchanged</option>
                    <option value="investigating">Investigating</option>
                  </Select>
                </div>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Corrective and preventive actions</CardTitle>
        </CardHeader>
        {actions.length === 0 ? (
          <CardContent>
            <p className="text-sm text-ink-muted">No actions recorded. An investigation with no action is a note, not a fix.</p>
          </CardContent>
        ) : (
          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <TH>Reference</TH>
                  <TH>Type</TH>
                  <TH>Title</TH>
                  <TH>Owner</TH>
                  <TH>Due</TH>
                  <TH>Status</TH>
                  <TH>Verified</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {actions.map((action) => (
                  <TR key={action.id}>
                    <TD className="font-mono text-xs font-medium text-brand-700">{action.reference}</TD>
                    <TD>{labelForQualityStatus(action.action_type)}</TD>
                    <TD className="max-w-[18rem] truncate">{action.title}</TD>
                    <TD>{action.owner_name ?? "Unassigned"}</TD>
                    <TD>
                      {action.due_date ? formatDate(action.due_date) : "—"}
                      {action.overdue ? <span className="ml-1 text-danger-600">overdue</span> : null}
                    </TD>
                    <TD>
                      <Badge tone={qualityTone(action.status)}>{labelForQualityStatus(action.status)}</Badge>
                    </TD>
                    <TD className="text-xs text-ink-muted">{action.verified_at ? formatDate(action.verified_at) : "—"}</TD>
                    <TD>
                      <div className="flex flex-col gap-2">
                        {principal.permissions.has("quality.capa.update") &&
                        (action.status === "open" || action.status === "in_progress") ? (
                          <ActionForm
                            action={updateCapaAction}
                            submitLabel="Mark complete"
                            successMessage="Action updated."
                            hidden={{ actionId: action.id ?? "", status: "completed" }}
                          >
                            <span />
                          </ActionForm>
                        ) : null}
                        {principal.permissions.has("quality.capa.verify") && action.status === "completed" ? (
                          <ActionForm
                            action={verifyCapaAction}
                            submitLabel="Verify"
                            successMessage="Action verified."
                            hidden={{ actionId: action.id ?? "" }}
                          >
                            <Input name="notes" placeholder="Evidence that it worked (20+ characters)" required />
                          </ActionForm>
                        ) : null}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      {principal.permissions.has("quality.capa.create") ? (
        <Card>
          <CardHeader>
            <CardTitle>Add an action</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={createCapaAction} submitLabel="Add action" successMessage="Action created." hidden={{ ncrId }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="actionType">Type</Label>
                  <Select id="actionType" name="actionType" defaultValue="corrective">
                    {CAPA_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {labelForQualityStatus(type)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="dueDate">Due</Label>
                  <Input id="dueDate" name="dueDate" type="date" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="title">Title</Label>
                  <Input id="title" name="title" required placeholder="Extend drying time" />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="description">Description</Label>
                  <Input id="description" name="description" required placeholder="What will be done, and how it will be shown to have worked" />
                </div>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      {isOpen && principal.permissions.has("quality.ncr.close") ? (
        <Card>
          <CardHeader>
            <CardTitle>Close the report</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={closeNcrAction} submitLabel="Close" successMessage="Non-conformance closed." hidden={{ ncrId }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="rootCauseClose">Root cause (if not already recorded)</Label>
                  <Input id="rootCauseClose" name="rootCause" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="reason">Closing statement</Label>
                  <Input id="reason" name="reason" required placeholder="At least 10 characters" />
                </div>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-xs text-ink-subtle">
        Available action states: {CAPA_STATUSES.map((status) => labelForQualityStatus(status)).join(", ")}.
      </p>
    </div>
  );
}
