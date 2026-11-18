import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileEdit } from "lucide-react";

import {
  decideAdjustmentAction,
  postAdjustmentAction,
  submitAdjustmentAction,
} from "@/app/(dashboard)/inventory/actions";
import { ActionButton, ActionForm } from "@/components/shared/action-form";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { inventoryStatusTone, labelForInventoryStatus } from "@/lib/inventory/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getAdjustmentDetail } from "@/services/inventory/counts";

export const metadata: Metadata = { title: "Stock adjustment" };
export const dynamic = "force-dynamic";

const number = (value: number | string | null) =>
  value === null || value === ""
    ? "—"
    : new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value));

/** One adjustment, with the moves its status permits and nothing else. */
export default async function AdjustmentDetailPage({
  params,
}: {
  params: Promise<{ adjustmentId: string }>;
}) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.adjustment.view")) {
    return <PermissionGuard permission="inventory.adjustment.view" />;
  }

  const { adjustmentId } = await params;
  const detail = await getAdjustmentDetail(adjustmentId).catch(() => null);
  if (!detail) notFound();

  const { adjustment, lines, nextStep } = detail;
  const canCreate = principal.permissions.has("inventory.adjustment.create");
  const canApprove = principal.permissions.has("inventory.adjustment.approve");

  return (
    <div className="space-y-4">
      <PageHeader
        title={adjustment.reference}
        description={`${adjustment.reason_code} · ${formatDate(adjustment.adjustment_date)}`}
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Adjustments", href: "/inventory/adjustments" },
          { label: adjustment.reference },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={inventoryStatusTone(adjustment.status)} dot>
              {labelForInventoryStatus(adjustment.status)}
            </Badge>
            <Link
              href="/inventory/adjustments"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              <ArrowLeft aria-hidden /> All adjustments
            </Link>
          </div>
        }
      />

      <Alert tone="info" title="What is needed next">
        <p>{nextStep}</p>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Stated reason</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{adjustment.reason}</p>
          {adjustment.notes ? <p className="text-ink-muted">{adjustment.notes}</p> : null}
        </CardContent>
      </Card>

      {adjustment.status === "draft" && canCreate ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-ink-muted">Submit for approval. Nothing posts yet.</p>
            <ActionButton
              action={submitAdjustmentAction}
              fields={{ adjustmentId: adjustment.id }}
              label="Submit for approval"
              successMessage="Adjustment submitted."
            />
          </CardContent>
        </Card>
      ) : null}

      {adjustment.status === "submitted" && canApprove ? (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ActionButton
              action={decideAdjustmentAction}
              fields={{ adjustmentId: adjustment.id, decision: "approved" }}
              label="Approve"
              successMessage="Adjustment approved."
            />
            <div className="border-t border-border pt-3">
              <ActionForm action={decideAdjustmentAction} submitLabel="Reject" successMessage="Adjustment rejected.">
                <input type="hidden" name="adjustmentId" value={adjustment.id} />
                <input type="hidden" name="decision" value="rejected" />
                <div className="space-y-1">
                  <Label htmlFor="reject-reason">Why is it rejected?</Label>
                  <Textarea id="reject-reason" name="reason" rows={2} className="text-xs" required />
                </div>
              </ActionForm>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {adjustment.status === "approved" && canApprove ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-ink-muted">
              Posting writes one adjustment in or out movement per line, attributed to this document.
            </p>
            <ActionButton
              action={postAdjustmentAction}
              fields={{ adjustmentId: adjustment.id }}
              label="Post adjustment"
              pendingLabel="Posting…"
              successMessage="Adjustment posted to the ledger."
              confirmMessage="Post the adjustment movements now?"
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lines.length === 0 ? (
            <EmptyState icon={FileEdit} title="No lines" description="This adjustment has no lines." />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Line</TH>
                    <TH>Lot</TH>
                    <TH>Product</TH>
                    <TH className="text-right">Change</TH>
                    <TH>Line reason</TH>
                  </TR>
                </THead>
                <TBody>
                  {lines.map((line) => {
                    const change = Number(line.quantity_change);
                    return (
                      <TR key={line.id}>
                        <TD className="tabular-nums">{line.line_number}</TD>
                        <TD className="font-mono text-xs">{line.lotReference}</TD>
                        <TD>
                          <span className="font-mono text-xs text-ink-subtle">{line.productCode}</span>
                          <span className="ml-2">{line.productName}</span>
                        </TD>
                        <TD
                          className={cn(
                            "text-right font-medium tabular-nums",
                            change < 0 ? "text-danger-600" : "text-success-700",
                          )}
                        >
                          {change > 0 ? `+${number(change)}` : number(change)}
                        </TD>
                        <TD className="text-xs text-ink-muted">{line.reason ?? "—"}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trail</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div>Created {formatDateTime(adjustment.created_at)}</div>
          <div>Approved {adjustment.approved_at ? formatDateTime(adjustment.approved_at) : "—"}</div>
          <div>Posted {adjustment.posted_at ? formatDateTime(adjustment.posted_at) : "—"}</div>
          {adjustment.status_reason ? (
            <div className="text-ink-muted">Status note: {adjustment.status_reason}</div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
