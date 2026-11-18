import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Factory, Scale } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { formatDate } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getConsumptionReport, getYieldReport } from "@/services/inventory/reports";
import { getProductionDashboard } from "@/services/inventory/dashboard";

export const metadata: Metadata = { title: "Production reports" };
export const dynamic = "force-dynamic";

const number = (value: number | string | null) =>
  value === null ? "—" : new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value));

const monthLabel = (value: string) => {
  const parsed = new Date(`${value.slice(0, 7)}-01T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};

/**
 * Production reports: yield and consumption.
 *
 * Both are read straight from the reporting views, which derive every figure from posted issues and outputs —
 * there is no stored rollup to drift out of step. Three honesty rules are carried into the copy:
 *
 *   - a yield is only comparable when input and output share a unit, so batches in mixed units are counted
 *     separately rather than folded into an average;
 *   - a yield outside a declared band is counted, not judged — a blank band means "no tolerance agreed", so
 *     those batches are reported as needing a reason, never as acceptable;
 *   - nothing here is costed. Costs live on the movements and are shown per row in the inventory reports.
 */
export default async function ProductionReportsPage() {
  const principal = await requireActiveProfile();
  if (!principal.permissions.has("production.reports.view")) {
    return <PermissionGuard permission="production.reports.view" />;
  }

  const [yields, consumption, dashboard] = await Promise.all([
    getYieldReport(),
    getConsumptionReport(),
    getProductionDashboard().catch(() => null),
  ]);

  const totals = yields.reduce(
    (acc, row) => ({
      closed: acc.closed + row.closedBatches,
      issued: acc.issued + row.totalIssued,
      output: acc.output + row.totalOutput,
      waste: acc.waste + row.totalWaste,
      outside: acc.outside + row.outsideBand,
      incomparable: acc.incomparable + row.incomparable,
    }),
    { closed: 0, issued: 0, output: 0, waste: 0, outside: 0, incomparable: 0 },
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Production reports"
        description="Yield and material consumption, derived per read from the batches that were actually posted."
        breadcrumbs={[
          { label: "Production", href: "/production" },
          { label: "Reports" },
        ]}
        actions={
          <Link href="/production" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            <ArrowLeft aria-hidden /> Production overview
          </Link>
        }
      />

      <Alert tone="info" title="A yield is a measurement, not a verdict">
        <p>
          The figures below are what the batches recorded: output ÷ input for batches whose quantities share a
          unit. A batch is counted as outside its band only when a band exists; where none has been declared the
          count stays blank and the batch is reported as reason-required. No cost, margin or loss value is
          calculated anywhere on this page.
        </p>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          { label: "Closed batches", value: number(totals.closed) },
          { label: "Issued", value: number(totals.issued) },
          { label: "Output", value: number(totals.output) },
          { label: "Waste", value: number(totals.waste) },
          { label: "Outside declared band", value: number(totals.outside) },
          { label: "Not comparable", value: number(totals.incomparable) },
        ].map((metric) => (
          <Card key={metric.label} className="p-4">
            <p className="text-xs font-medium text-ink-muted">{metric.label}</p>
            <p className="mt-1.5 text-xl font-semibold tracking-tight text-ink tabular-nums">{metric.value}</p>
          </Card>
        ))}
      </div>

      {dashboard ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {dashboard.metrics.slice(0, 4).map((metric) => (
            <Card key={metric.label} className="p-4">
              <p className="text-xs font-medium text-ink-muted">{metric.label}</p>
              <p className="mt-1.5 text-lg font-semibold tracking-tight text-ink tabular-nums">{metric.value}</p>
              <p className="mt-1 text-[0.6875rem] text-ink-subtle">{metric.hint}</p>
            </Card>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Yield by product and month</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {yields.length === 0 ? (
            <EmptyState
              icon={Scale}
              title="No closed batches yet"
              description="Yield appears once a batch has issued material, recorded output and been closed."
            />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Month</TH>
                    <TH>Product</TH>
                    <TH className="text-right">Batches</TH>
                    <TH className="text-right">Issued</TH>
                    <TH className="text-right">Output</TH>
                    <TH className="text-right">Waste</TH>
                    <TH className="text-right">Average yield</TH>
                    <TH className="text-right">Range</TH>
                    <TH className="text-right">Outside band</TH>
                    <TH className="text-right">Not comparable</TH>
                  </TR>
                </THead>
                <TBody>
                  {yields.map((row) => (
                    <TR key={`${row.periodMonth}-${row.productCode}`}>
                      <TD className="whitespace-nowrap text-xs">{monthLabel(row.periodMonth)}</TD>
                      <TD>
                        <span className="font-mono text-xs text-ink-subtle">{row.productCode}</span>{" "}
                        {row.productName}
                      </TD>
                      <TD className="text-right tabular-nums">{row.closedBatches}</TD>
                      <TD className="text-right tabular-nums">{number(row.totalIssued)}</TD>
                      <TD className="text-right tabular-nums">{number(row.totalOutput)}</TD>
                      <TD className="text-right tabular-nums">{number(row.totalWaste)}</TD>
                      <TD className="text-right tabular-nums font-medium">
                        {row.averageYield === null ? "—" : `${number(row.averageYield)}%`}
                      </TD>
                      <TD className="text-right text-xs tabular-nums text-ink-muted">
                        {row.lowestYield === null || row.highestYield === null
                          ? "—"
                          : `${number(row.lowestYield)}% – ${number(row.highestYield)}%`}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {row.outsideBand === 0 ? (
                          <span className="text-ink-subtle">0</span>
                        ) : (
                          <Badge tone="warning">{row.outsideBand}</Badge>
                        )}
                      </TD>
                      <TD className="text-right tabular-nums text-ink-muted">
                        {row.incomparable === 0 ? "0" : row.incomparable}
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
          <CardTitle>Material consumption by batch</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {consumption.length === 0 ? (
            <EmptyState
              icon={Factory}
              title="Nothing consumed yet"
              description="Issues to a batch appear here as soon as material leaves stock."
            />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Batch</TH>
                    <TH>Date</TH>
                    <TH>Product</TH>
                    <TH className="text-right">Consumed</TH>
                    <TH className="text-right">Issues</TH>
                    <TH className="text-right">Lots</TH>
                  </TR>
                </THead>
                <TBody>
                  {consumption.map((row, index) => (
                    <TR key={`${row.batchReference}-${row.productCode}-${index}`}>
                      <TD className="whitespace-nowrap font-mono text-xs">{row.batchReference}</TD>
                      <TD className="whitespace-nowrap text-xs">{formatDate(row.batchDate)}</TD>
                      <TD>
                        <span className="font-mono text-xs text-ink-subtle">{row.productCode}</span>{" "}
                        {row.productName}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {number(row.consumed)} <span className="text-xs text-ink-subtle">{row.unitCode}</span>
                      </TD>
                      <TD className="text-right tabular-nums">{row.issueCount}</TD>
                      <TD className="text-right tabular-nums">{row.lotCount}</TD>
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
          <CardTitle>What these reports do not say</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-ink-muted">
          <p>
            Consumption is a quantity register. It does not express material as a percentage of output per
            stage, because stage-level loss percentages have not been agreed by Pluck Agro.
          </p>
          <p>
            Stock positions, expiry exposure and holds are inventory concerns and live on the{" "}
            <Link href="/inventory/reports" className="font-medium text-brand-700 hover:underline">
              inventory reports
            </Link>{" "}
            page, together with the per-row recorded values that this page deliberately does not sum.
          </p>
          <p>
            Exporting is a separate permission. Nothing on this page is downloadable yet: the export flag exists
            so that a decision to allow bulk extraction can be granted deliberately rather than by default.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
