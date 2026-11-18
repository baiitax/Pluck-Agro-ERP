import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Factory, Layers } from "lucide-react";

import {
  applyDeclaredInputsAction,
  decidePlanAction,
  reserveMaterialAction,
  startBatchAction,
  submitPlanAction,
} from "@/app/(dashboard)/production/actions";
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
import { getPlanDetail } from "@/services/production/plans";
import { listSelectableLots } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "Production plan" };
export const dynamic = "force-dynamic";

const number = (value: number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

/**
 * One production plan.
 *
 * The requirement table shows what must be consumed and how much of it is already reserved. Reservation is a
 * deliberate per-lot act below it: which lot to draw from is a warehouse decision (age, grade, location), and
 * a system that picked silently would be making that decision without the knowledge to make it.
 */
export default async function PlanDetailPage({ params }: { params: Promise<{ planId: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("production.plan.view")) {
    return <PermissionGuard permission="production.plan.view" />;
  }

  const { planId } = await params;
  const detail = await getPlanDetail(planId).catch(() => null);
  if (!detail) notFound();

  const { plan, record, materials, batches, declaredInputCount, nextStep } = detail;
  const canCreate = principal.permissions.has("production.plan.create");
  const canApprove = principal.permissions.has("production.plan.approve");
  const canExecute = principal.permissions.has("production.plan.execute");
  const lots = canExecute ? await listSelectableLots() : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={plan.reference}
        description={`${plan.product_code} · ${plan.product_name} · ${number(Number(plan.planned_quantity))} ${plan.unit_code} planned`}
        breadcrumbs={[
          { label: "Production", href: "/production" },
          { label: "Plans", href: "/production/plans" },
          { label: plan.reference },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={inventoryStatusTone(plan.status)} dot>
              {labelForInventoryStatus(plan.status)}
            </Badge>
            <Link
              href="/production/plans"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              <ArrowLeft aria-hidden /> All plans
            </Link>
          </div>
        }
      />

      <Alert tone="info" title="What is needed next">
        <p>{nextStep}</p>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Planned", value: number(Number(plan.planned_quantity)), hint: plan.unit_code },
          { label: "Produced", value: number(Number(plan.produced_quantity)), hint: "From closed batches" },
          { label: "Outstanding", value: number(Number(plan.outstanding_quantity)), hint: "Still to produce" },
          {
            label: "Progress",
            value: plan.progress_percent === null ? "—" : `${number(Number(plan.progress_percent))}%`,
            hint: `${plan.batch_count} batch(es) started`,
          },
        ].map((metric) => (
          <Card key={metric.label} className="p-4">
            <p className="text-xs font-medium text-ink-muted">{metric.label}</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">{metric.value}</p>
            <p className="mt-1 text-[0.6875rem] text-ink-subtle">{metric.hint}</p>
          </Card>
        ))}
      </div>

      {plan.status === "draft" && canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Prepare and submit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink-muted">
              {declaredInputCount === 0
                ? "No declared input exists for this product, so copying the requirement will add nothing. Declare the input quantities in configuration first if the factory uses them."
                : `${declaredInputCount} declared input(s) exist for this product. Copying scales them to the planned quantity.`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                action={applyDeclaredInputsAction}
                fields={{ planId: plan.id }}
                label="Copy declared requirements"
                variant="secondary"
                successMessage="Requirement lines copied."
              />
              <ActionButton
                action={submitPlanAction}
                fields={{ planId: plan.id }}
                label="Submit for approval"
                successMessage="Plan submitted."
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {plan.status === "submitted" && canApprove ? (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ActionButton
              action={decidePlanAction}
              fields={{ planId: plan.id, decision: "approved" }}
              label="Approve plan"
              successMessage="Plan approved."
            />
            <div className="border-t border-border pt-3">
              <ActionForm action={decidePlanAction} submitLabel="Reject" successMessage="Plan rejected.">
                <input type="hidden" name="planId" value={plan.id} />
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

      {plan.status === "approved" && canExecute ? (
        <Card>
          <CardHeader>
            <CardTitle>Reserve material and start work</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-sm text-ink-muted">
                Reserve available stock for one material line. The claim goes through the same reservation table
                every other module uses, so the stock stops being offered elsewhere.
              </p>
              <ActionForm action={reserveMaterialAction} submitLabel="Reserve stock" successMessage="Stock reserved for the plan.">
                <input type="hidden" name="planId" value={plan.id} />
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="lotId">Lot</Label>
                    <select
                      id="lotId"
                      name="lotId"
                      required
                      className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs"
                    >
                      <option value="">Select a lot with availability…</option>
                      {lots.map((lot) => (
                        <option key={lot.id} value={lot.id}>
                          {lot.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="quantity">Quantity</Label>
                    <Input id="quantity" name="quantity" inputMode="decimal" required className="h-9" />
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  <Label htmlFor="reserve-notes">Note</Label>
                  <Input id="reserve-notes" name="notes" className="h-8 text-xs" />
                </div>
              </ActionForm>
            </div>

            <div className="border-t border-border pt-3">
              <p className="mb-2 text-sm text-ink-muted">
                Starting a batch opens the run. Material is issued against the batch, not the plan, so the
                quantities stay attributable to the run that used them.
              </p>
              <ActionButton
                action={startBatchAction}
                fields={{ planId: plan.id }}
                label="Start a batch"
                successMessage="Batch started."
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {plan.status === "in_progress" && canExecute ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-ink-muted">Work is under way. Start another batch or open a running one.</p>
            <ActionButton
              action={startBatchAction}
              fields={{ planId: plan.id }}
              label="Start another batch"
              successMessage="Batch started."
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Material requirement</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {materials.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No requirement lines"
              description="Either the declared routing has not been copied onto this plan, or the factory has declared no inputs for this product. Nothing has been invented to fill the gap."
            />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Line</TH>
                    <TH>Material</TH>
                    <TH className="text-right">Required</TH>
                    <TH className="text-right">Declared basis</TH>
                    <TH className="text-right">Reserved</TH>
                    <TH className="text-right">Still to reserve</TH>
                  </TR>
                </THead>
                <TBody>
                  {materials.map((line) => {
                    const required = Number(line.required_quantity);
                    const reserved = line.reservedQuantity;
                    return (
                      <TR key={line.id}>
                        <TD className="tabular-nums">{line.line_number}</TD>
                        <TD>
                          <span className="font-mono text-xs text-ink-subtle">{line.productCode}</span>
                          <span className="ml-2">{line.productName}</span>
                        </TD>
                        <TD className="text-right tabular-nums">
                          {number(required)} {line.unitCode}
                        </TD>
                        <TD className="text-right text-xs text-ink-muted">
                          {line.declared_quantity === null
                            ? "—"
                            : `${number(Number(line.declared_quantity))} per ${number(Number(line.declared_basis_quantity ?? 1))}`}
                        </TD>
                        <TD className="text-right tabular-nums">{number(reserved)}</TD>
                        <TD className="text-right font-medium tabular-nums">
                          {number(Math.max(required - reserved, 0))}
                        </TD>
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
          <CardTitle>Batches</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {batches.length === 0 ? (
            <EmptyState icon={Factory} title="No batches yet" description="No production run has started for this plan." />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Reference</TH>
                    <TH>Date</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Output</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {batches.map((batch) => (
                    <TR key={batch.id}>
                      <TD className="font-mono text-xs">{batch.reference}</TD>
                      <TD>{formatDate(batch.batch_date)}</TD>
                      <TD>
                        <Badge tone={inventoryStatusTone(batch.status)} dot>
                          {labelForInventoryStatus(batch.status)}
                        </Badge>
                      </TD>
                      <TD className="text-right tabular-nums">{number(Number(batch.output_quantity))}</TD>
                      <TD>
                        <Link
                          href={`/production/batches/${batch.id}`}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          Open
                        </Link>
                      </TD>
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
          <CardTitle>Trail</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div>Planned {formatDate(plan.planned_date)}</div>
          <div>Approved {record.approved_at ? formatDateTime(record.approved_at) : "—"}</div>
          <div>Completed {record.completed_at ? formatDateTime(record.completed_at) : "—"}</div>
          <div>Priority {record.priority}</div>
          {record.notes ? <div className="sm:col-span-2 text-ink-muted">Notes: {record.notes}</div> : null}
          {record.status_reason ? (
            <div className="sm:col-span-2 text-ink-muted">Status note: {record.status_reason}</div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
