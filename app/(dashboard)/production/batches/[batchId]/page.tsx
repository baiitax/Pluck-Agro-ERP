import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Factory, Lock, ScrollText } from "lucide-react";

import {
  closeBatchAction,
  issueMaterialAction,
  logEntryAction,
  recordOutputAction,
} from "@/app/(dashboard)/production/actions";
import { ActionForm } from "@/components/shared/action-form";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { inventoryStatusTone, labelForInventoryStatus } from "@/lib/inventory/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getBatchDetail } from "@/services/production/batches";
import { listSelectableLots } from "@/services/inventory/stock";

export const metadata: Metadata = { title: "Production batch" };
export const dynamic = "force-dynamic";

const number = (value: number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value ?? 0));

/**
 * One batch, from issue to close.
 *
 * Two things are deliberate here. The output form says, before it is used, that the produced lot will be held
 * pending inspection — because that is what will happen, and a storekeeper who did not expect it would think
 * the stock had gone missing. And the close form is explicit that yield is only computed when input and output
 * share a unit, so a batch in mixed units is closed with a stated reason instead of a fabricated percentage.
 */
export default async function BatchDetailPage({ params }: { params: Promise<{ batchId: string }> }) {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("production.batch.view")) {
    return <PermissionGuard permission="production.batch.view" />;
  }

  const { batchId } = await params;
  const detail = await getBatchDetail(batchId).catch(() => null);
  if (!detail) notFound();

  const { batch, materials, outputs, logs, restrictedOutputs, nextStep } = detail;
  const canExecute = principal.permissions.has("production.batch.execute");
  const canClose = principal.permissions.has("production.batch.close");
  const running = batch.status === "in_progress";
  const lots = canExecute && running ? await listSelectableLots(batch.warehouse_id) : [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <PageHeader
        title={batch.reference}
        description={`${batch.product_code} · ${batch.product_name} · ${batch.warehouse_name}`}
        breadcrumbs={[
          { label: "Production", href: "/production" },
          { label: "Batches", href: "/production/batches" },
          { label: batch.reference },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={inventoryStatusTone(batch.status)} dot>
              {labelForInventoryStatus(batch.status)}
            </Badge>
            <Link
              href="/production/batches"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              <ArrowLeft aria-hidden /> All batches
            </Link>
          </div>
        }
      />

      <Alert tone="info" title="What is needed next">
        <p>{nextStep}</p>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Planned", value: number(Number(batch.planned_quantity)) },
          { label: "Issued", value: number(Number(batch.issued_quantity)) },
          { label: "Output", value: number(Number(batch.output_quantity)) },
          { label: "Waste", value: number(Number(batch.waste_quantity)) },
          {
            label: "Recorded yield",
            value:
              batch.recorded_yield_percent === null
                ? batch.recorded_yield_basis === "mixed_units"
                  ? "Not comparable"
                  : "—"
                : `${number(Number(batch.recorded_yield_percent))}%`,
          },
        ].map((metric) => (
          <Card key={metric.label} className="p-4">
            <p className="text-xs font-medium text-ink-muted">{metric.label}</p>
            <p className="mt-1.5 text-xl font-semibold tracking-tight text-ink">{metric.value}</p>
            <p className="mt-1 text-[0.6875rem] text-ink-subtle">{batch.unit_code}</p>
          </Card>
        ))}
      </div>

      {restrictedOutputs.length > 0 ? (
        <Alert tone="warning" title="Output is in stock but not yet available">
          <p>
            {restrictedOutputs.length} output lot(s) are held pending inspection. They count as on hand and do
            not count as available, so nothing can be dispatched from them until Quality releases the hold.
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {restrictedOutputs.map((row) => (
              <li key={row.outputId}>
                {row.lotReference ?? "Output lot"} — {row.reason ?? "pending inspection"}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {running && canExecute ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Issue material</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm action={issueMaterialAction} submitLabel="Issue to batch" successMessage="Material issued.">
                <input type="hidden" name="batchId" value={batch.id} />
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label htmlFor="lotId">Lot</Label>
                    <select
                      id="lotId"
                      name="lotId"
                      required
                      className="h-9 w-full rounded-md border border-border bg-surface px-2 text-xs"
                    >
                      <option value="">Select a lot in this warehouse…</option>
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
                  <div className="space-y-1">
                    <Label htmlFor="issue-notes">Note</Label>
                    <Input id="issue-notes" name="notes" className="h-8 text-xs" />
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  Availability already excludes restricted and reserved stock. An over-issue is refused and
                  names the lot and the quantity it actually holds.
                </p>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Record output</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm action={recordOutputAction} submitLabel="Record output" successMessage="Output recorded.">
                <input type="hidden" name="batchId" value={batch.id} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="outputType">Output type</Label>
                    <Select id="outputType" name="outputType" defaultValue="main">
                      <option value="main">Main product</option>
                      <option value="by_product">By-product</option>
                      <option value="waste">Waste</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="output-quantity">Quantity</Label>
                    <Input id="output-quantity" name="quantity" inputMode="decimal" required className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="grade">Grade</Label>
                    <Input id="grade" name="grade" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="expiryDate">Expiry</Label>
                    <Input id="expiryDate" name="expiryDate" type="date" className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="manufactureDate">Manufactured</Label>
                    <Input id="manufactureDate" name="manufactureDate" type="date" defaultValue={today} className="h-9" />
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  A new lot is created for the output, inheriting this batch as its provenance. Unless it is
                  waste, the lot is held pending inspection and is not immediately available.
                </p>
              </ActionForm>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {canClose && (batch.status === "in_progress" || batch.status === "completed") ? (
        <Card>
          <CardHeader>
            <CardTitle>Close the batch</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={closeBatchAction}
              submitLabel="Close batch"
              successMessage="Batch closed."
              disabled={materials.length === 0 || outputs.length === 0}
              disabledHint={
                materials.length === 0
                  ? "No material has been issued, so there is nothing to reconcile."
                  : outputs.length === 0
                    ? "No output has been recorded, so there is nothing to reconcile."
                    : undefined
              }
            >
              <input type="hidden" name="batchId" value={batch.id} />
              <div className="space-y-1">
                <Label htmlFor="reason">Reason (required when the yield is outside a declared band, or none is declared)</Label>
                <Textarea id="reason" name="reason" rows={2} className="text-xs" />
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                Closing records the observed yield as output ÷ input where both are in{" "}
                {batch.unit_code}. It moves no stock. If the product has no declared band, a reason of at least
                ten characters is required — the system will not call a yield normal or abnormal on its own.
              </p>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Material issued</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {materials.length === 0 ? (
              <EmptyState icon={Factory} title="Nothing issued" description="No material has been taken from stock for this batch." />
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Line</TH>
                      <TH>Lot</TH>
                      <TH>Product</TH>
                      <TH className="text-right">Quantity</TH>
                      <TH>Issued</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {materials.map((line) => (
                      <TR key={line.id}>
                        <TD className="tabular-nums">{line.line_number}</TD>
                        <TD>
                          <Link
                            href={`/inventory/lots/${line.lot_id}`}
                            className="font-mono text-xs font-medium text-brand-700 hover:underline"
                          >
                            {line.lotReference}
                          </Link>
                        </TD>
                        <TD>{line.productName}</TD>
                        <TD className="text-right tabular-nums">{number(Number(line.quantity))}</TD>
                        <TD className="text-xs">{formatDateTime(line.issued_at)}</TD>
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
            <CardTitle>Output recorded</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {outputs.length === 0 ? (
              <EmptyState icon={Factory} title="No output" description="Nothing has been produced into stock yet." />
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Line</TH>
                      <TH>Type</TH>
                      <TH>Product</TH>
                      <TH className="text-right">Quantity</TH>
                      <TH>Output lot</TH>
                      <TH>Held</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {outputs.map((line) => (
                      <TR key={line.id}>
                        <TD className="tabular-nums">{line.line_number}</TD>
                        <TD>{labelForInventoryStatus(line.output_type)}</TD>
                        <TD>{line.productName}</TD>
                        <TD className="text-right tabular-nums">{number(Number(line.quantity))}</TD>
                        <TD>
                          <Link
                            href={`/inventory/lots/${line.lot_id}`}
                            className="font-mono text-xs font-medium text-brand-700 hover:underline"
                          >
                            {line.lotReference}
                          </Link>
                        </TD>
                        <TD>
                          {line.restriction_id ? (
                            <Badge tone="warning">
                              <Lock className="size-3" aria-hidden /> Pending inspection
                            </Badge>
                          ) : (
                            <span className="text-xs text-ink-subtle">Available</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Batch log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canExecute ? (
            <ActionForm action={logEntryAction} submitLabel="Add entry" successMessage="Log entry added.">
              <input type="hidden" name="batchId" value={batch.id} />
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="space-y-1 sm:col-span-3">
                  <Label htmlFor="body">What happened?</Label>
                  <Input id="body" name="body" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="logType">Type</Label>
                  <Select id="logType" name="logType" defaultValue="note">
                    <option value="note">Note</option>
                    <option value="downtime">Downtime</option>
                    <option value="issue">Issue</option>
                    <option value="observation">Observation</option>
                    <option value="handover">Handover</option>
                  </Select>
                </div>
              </div>
            </ActionForm>
          ) : null}

          {logs.length === 0 ? (
            <EmptyState icon={ScrollText} title="No log entries" description="Nothing has been written about this run yet." />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Type</TH>
                    <TH>Entry</TH>
                    <TH>Shift</TH>
                  </TR>
                </THead>
                <TBody>
                  {logs.map((log) => (
                    <TR key={log.id}>
                      <TD className="text-xs">{formatDateTime(log.created_at)}</TD>
                      <TD>{labelForInventoryStatus(log.log_type)}</TD>
                      <TD className="text-xs">{log.body}</TD>
                      <TD className="text-xs">{log.shift ?? "—"}</TD>
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
          <div>Batch date {formatDate(batch.batch_date)}</div>
          <div>
            Plan{" "}
            {batch.plan_id ? (
              <Link href={`/production/plans/${batch.plan_id}`} className="font-medium text-brand-700 hover:underline">
                {batch.plan_reference}
              </Link>
            ) : (
              "Standalone"
            )}
          </div>
          <div>Started {batch.started_at ? formatDateTime(batch.started_at) : "—"}</div>
          <div>Completed {batch.completed_at ? formatDateTime(batch.completed_at) : "—"}</div>
          <div>Closed {batch.closed_at ? formatDateTime(batch.closed_at) : "—"}</div>
          <div>
            Declared band{" "}
            {batch.within_declared_band === null
              ? "none declared"
              : batch.within_declared_band
                ? "within"
                : "outside — reason recorded"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
