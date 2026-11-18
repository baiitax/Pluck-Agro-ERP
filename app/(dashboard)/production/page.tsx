import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Factory, Settings2 } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { MetricCard } from "@/components/shared/metric-card";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { inventoryStatusTone, labelForInventoryStatus } from "@/lib/inventory/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getProductionDashboard } from "@/services/inventory/dashboard";

export const metadata: Metadata = { title: "Production" };
export const dynamic = "force-dynamic";

const number = (value: number) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(value);

/**
 * Production overview.
 *
 * Plans and batches that exist, and the configuration the factory has actually declared. The configuration
 * panel is here rather than hidden in a settings page because a zero there explains every "no requirement
 * lines" and "reason required" message a planner will otherwise find mysterious.
 */
export default async function ProductionOverviewPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("production.dashboard.view")) {
    return <PermissionGuard permission="production.dashboard.view" />;
  }

  const dashboard = await getProductionDashboard();
  const notConfigured = dashboard.configuration.stages === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Production"
        description="What the factory intends to make, what it is making, and what it recorded. Material issues and outputs are ledger movements — production is not a separate set of books."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Production" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {principal.permissions.has("production.product.manage") ? (
              <Link
                href="/production/configuration"
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                <Settings2 aria-hidden /> Configuration
              </Link>
            ) : null}
            {principal.permissions.has("production.plan.create") ? (
              <Link href="/production/plans/new" className={cn(buttonVariants({ size: "sm" }))}>
                New plan
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {dashboard.metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            hint={metric.hint}
            tone={metric.tone === "warning" ? "pending" : metric.tone === "danger" ? "danger" : "neutral"}
          />
        ))}
      </div>

      {notConfigured ? (
        <Alert tone="warning" title="The factory has not declared its process yet">
          <p>
            No production stage exists, so no routing or declared input can be recorded and every plan will
            start with an empty material requirement. That is not a bug: the stage list and the input
            quantities are Pluck Agro&apos;s answers, and the system will not invent them.{" "}
            {principal.permissions.has("production.product.manage") ? (
              <Link href="/production/configuration" className="font-medium underline">
                Configure stages and declared inputs
              </Link>
            ) : null}
          </p>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Plans in flight</CardTitle>
            <Link href="/production/plans" className="text-xs font-medium text-brand-700 hover:underline">
              All plans <ArrowRight className="inline size-3" aria-hidden />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {dashboard.plans.length === 0 ? (
              <EmptyState
                icon={Factory}
                title="No plans in flight"
                description="Nothing is approved or running. A plan states a product, a quantity and an output warehouse before any material is touched."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Reference</TH>
                      <TH>Product</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Outstanding</TH>
                      <TH className="text-right">Progress</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {dashboard.plans.map((plan) => (
                      <TR key={plan.id}>
                        <TD>
                          <Link
                            href={`/production/plans/${plan.id}`}
                            className="font-mono text-xs font-medium text-brand-700 hover:underline"
                          >
                            {plan.reference}
                          </Link>
                        </TD>
                        <TD>{plan.productName}</TD>
                        <TD>
                          <Badge tone={inventoryStatusTone(plan.status)} dot>
                            {labelForInventoryStatus(plan.status)}
                          </Badge>
                        </TD>
                        <TD className="text-right tabular-nums">{number(plan.outstanding)}</TD>
                        <TD className="text-right tabular-nums">
                          {plan.progress === null ? "—" : `${number(plan.progress)}%`}
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
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Batches running</CardTitle>
            <Link href="/production/batches" className="text-xs font-medium text-brand-700 hover:underline">
              All batches <ArrowRight className="inline size-3" aria-hidden />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {dashboard.batches.length === 0 ? (
              <EmptyState
                icon={Factory}
                title="No batches running"
                description="A batch is what consumes material and produces output. Starting one is what makes stock move."
              />
            ) : (
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Reference</TH>
                      <TH>Product</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Output</TH>
                      <TH className="text-right">Yield</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {dashboard.batches.map((batch) => (
                      <TR key={batch.id}>
                        <TD>
                          <Link
                            href={`/production/batches/${batch.id}`}
                            className="font-mono text-xs font-medium text-brand-700 hover:underline"
                          >
                            {batch.reference}
                          </Link>
                        </TD>
                        <TD>{batch.productName}</TD>
                        <TD>
                          <Badge tone={inventoryStatusTone(batch.status)} dot>
                            {labelForInventoryStatus(batch.status)}
                          </Badge>
                        </TD>
                        <TD className="text-right tabular-nums">{number(batch.output)}</TD>
                        <TD className="text-right tabular-nums">
                          {batch.yield === null
                            ? batch.basis === "mixed_units"
                              ? "Not comparable"
                              : "—"
                            : `${number(batch.yield)}%`}
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
          <CardTitle>Recorded yield, most recent closed months</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {dashboard.yieldLastClosed.length === 0 ? (
            <EmptyState
              icon={Factory}
              title="No closed batches yet"
              description="Yield appears once a batch has been closed with both material issued and output recorded. Until then there is nothing to divide."
            />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH>Month</TH>
                    <TH className="text-right">Closed batches</TH>
                    <TH className="text-right">Average recorded yield</TH>
                    <TH className="text-right">Outside declared band</TH>
                    <TH className="text-right">Not comparable</TH>
                  </TR>
                </THead>
                <TBody>
                  {dashboard.yieldLastClosed.map((row) => (
                    <TR key={`${row.productCode}-${row.periodMonth}`}>
                      <TD>{row.productName}</TD>
                      <TD>{formatDate(row.periodMonth)}</TD>
                      <TD className="text-right tabular-nums">{row.closedBatches}</TD>
                      <TD className="text-right tabular-nums">
                        {row.averageYield === null ? "—" : `${number(row.averageYield)}%`}
                      </TD>
                      <TD className="text-right tabular-nums">{row.outsideBand}</TD>
                      <TD className="text-right tabular-nums">{row.incomparable}</TD>
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
          <CardTitle>Declared configuration</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-ink-muted">Stages</p>
            <p className="text-lg font-semibold">{dashboard.configuration.stages}</p>
          </div>
          <div>
            <p className="text-xs text-ink-muted">Routed products</p>
            <p className="text-lg font-semibold">{dashboard.configuration.routedProducts}</p>
          </div>
          <div>
            <p className="text-xs text-ink-muted">Declared inputs</p>
            <p className="text-lg font-semibold">{dashboard.configuration.declaredInputs}</p>
          </div>
          <div>
            <p className="text-xs text-ink-muted">Yield rules</p>
            <p className="text-lg font-semibold">{dashboard.configuration.yieldRules}</p>
            <p className="text-xs text-ink-subtle">
              {dashboard.configuration.yieldRules === 0
                ? "No band declared: every batch close requires a stated reason."
                : "Batches outside their declared band require a reason to close."}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
