import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ClipboardCheck } from "lucide-react";

import {
  decideCountAction,
  postCountAction,
  recordCountLineAction,
  submitCountAction,
} from "@/app/(dashboard)/inventory/actions";
import { ActionButton, ActionForm } from "@/components/shared/action-form";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { inventoryStatusTone, labelForInventoryStatus } from "@/lib/inventory/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getCountDetail } from "@/services/inventory/counts";

export const metadata: Metadata = { title: "Stock count" };
export const dynamic = "force-dynamic";

const number = (value: number | string | null) =>
  value === null || value === ""
    ? "—"
    : new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value));

/**
 * One stock count.
 *
 * Every line shows three numbers: what the ledger said when the count opened, what was found, and the
 * difference. The third is a generated column, so it is always the arithmetic of the first two.
 */
export default async function CountDetailPage({ params }: { params: Promise<{ countId: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("inventory.count.view")) {
    return <PermissionGuard permission="inventory.count.view" />;
  }

  const { countId } = await params;
  const detail = await getCountDetail(countId).catch(() => null);
  if (!detail) notFound();

  const { count, lines, allCounted, nextStep } = detail;
  const canExecute = principal.permissions.has("inventory.count.execute");
  const canApprove = principal.permissions.has("inventory.count.approve");

  return (
    <div className="space-y-4">
      <PageHeader
        title={count.reference}
        description={`${count.warehouseName ?? "—"} · counted ${formatDate(count.count_date)}`}
        breadcrumbs={[
          { label: "Inventory", href: "/inventory" },
          { label: "Counts", href: "/inventory/counts" },
          { label: count.reference },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={inventoryStatusTone(count.status)} dot>
              {labelForInventoryStatus(count.status)}
            </Badge>
            <Link href="/inventory/counts" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              <ArrowLeft aria-hidden /> All counts
            </Link>
          </div>
        }
      />

      <Alert tone="info" title="What is needed next">
        <p>{nextStep}</p>
      </Alert>

      {count.status === "counting" && canExecute ? (
        <Card>
          <CardHeader>
            <CardTitle>Record a counted quantity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={recordCountLineAction}
              submitLabel="Record"
              successMessage="Counted quantity recorded."
            >
              <input type="hidden" name="countId" value={count.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="lineId">Line</Label>
                  <select
                    id="lineId"
                    name="lineId"
                    required
                    className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs"
                  >
                    <option value="">Select a lot…</option>
                    {lines.map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.lotReference} · {line.productName} · system {number(line.system_quantity)}{" "}
                        {line.unitCode}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="countedQuantity">Counted quantity</Label>
                  <Input id="countedQuantity" name="countedQuantity" inputMode="decimal" required className="h-9" />
                </div>
              </div>
              <div className="mt-2 space-y-1">
                <Label htmlFor="line-notes">Note</Label>
                <Input id="line-notes" name="notes" className="h-8 text-xs" />
              </div>
            </ActionForm>

            {allCounted ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <p className="text-sm text-ink-muted">Every line has been counted.</p>
                <ActionButton
                  action={submitCountAction}
                  fields={{ countId: count.id }}
                  label="Submit for approval"
                  successMessage="Count submitted."
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canApprove && (count.status === "counted" || count.status === "submitted") ? (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink-muted">
              Approving accepts the variances as findings. Rejecting sends the count back for a recount; nothing
              has posted either way.
            </p>
            <ActionButton
              action={decideCountAction}
              fields={{ countId: count.id, decision: "approved" }}
              label="Approve variances"
              successMessage="Count approved."
            />
            <div className="border-t border-border pt-3">
              <ActionForm action={decideCountAction} submitLabel="Reject" successMessage="Count rejected.">
                <input type="hidden" name="countId" value={count.id} />
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

      {canApprove && count.status === "approved" ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-ink-muted">
              Posting writes one movement per non-zero variance: a count gain for a surplus, a count loss for a
              shortfall. It is idempotent — pressing it twice will not double the ledger.
            </p>
            <ActionButton
              action={postCountAction}
              fields={{ countId: count.id }}
              label="Post variances"
              pendingLabel="Posting…"
              successMessage="Variances posted to the ledger."
              confirmMessage="Post the variance movements now?"
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
            <EmptyState
              icon={ClipboardCheck}
              title="No lines"
              description="This count has no lots on it. A count snapshots lots that held a non-zero balance when it started."
            />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Line</TH>
                    <TH>Lot</TH>
                    <TH>Product</TH>
                    <TH className="text-right">System quantity</TH>
                    <TH className="text-right">Counted</TH>
                    <TH className="text-right">Variance</TH>
                    <TH>Counted at</TH>
                  </TR>
                </THead>
                <TBody>
                  {lines.map((line) => {
                    const variance = line.variance_quantity === null ? null : Number(line.variance_quantity);
                    return (
                      <TR key={line.id}>
                        <TD className="tabular-nums">{line.line_number}</TD>
                        <TD className="font-mono text-xs">{line.lotReference}</TD>
                        <TD>
                          <span className="font-mono text-xs text-ink-subtle">{line.productCode}</span>
                          <span className="ml-2">{line.productName}</span>
                        </TD>
                        <TD className="text-right tabular-nums">
                          {number(line.system_quantity)} {line.unitCode}
                        </TD>
                        <TD className="text-right tabular-nums">{number(line.counted_quantity)}</TD>
                        <TD
                          className={cn(
                            "text-right font-medium tabular-nums",
                            variance !== null && variance < 0 ? "text-danger-600" : variance ? "text-success-700" : "",
                          )}
                        >
                          {variance === null ? "Not counted" : variance === 0 ? "0" : variance > 0 ? `+${variance}` : String(variance)}
                        </TD>
                        <TD className="text-xs">{line.counted_at ? formatDateTime(line.counted_at) : "—"}</TD>
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
          <div>Started {count.started_at ? formatDateTime(count.started_at) : "—"}</div>
          <div>Counted {count.counted_at ? formatDateTime(count.counted_at) : "—"}</div>
          <div>Submitted {count.submitted_at ? formatDateTime(count.submitted_at) : "—"}</div>
          <div>Approved {count.approved_at ? formatDateTime(count.approved_at) : "—"}</div>
          <div>Posted {count.posted_at ? formatDateTime(count.posted_at) : "—"}</div>
          {count.notes ? <div className="sm:col-span-2 text-ink-muted">Notes: {count.notes}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
