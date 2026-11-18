import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ClipboardList, FileText, PackageCheck, Wallet } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { MetricCard } from "@/components/shared/metric-card";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/formatting";
import { labelForStatus, procurementStatusTone } from "@/lib/procurement/statuses";
import { cn } from "@/lib/utils";
import { requireActiveProfile } from "@/services/authorization";
import { getProcurementDashboard } from "@/services/procurement/dashboard";

export const metadata: Metadata = { title: "Procurement" };
export const dynamic = "force-dynamic";

const money = (currency: string, value: number) =>
  `${currency} ${new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

/**
 * Procurement overview.
 *
 * Every number is a count or a sum produced by the database from real documents. There are no
 * sample metrics, no targets the company has not set, and no chart of invented history. Where a
 * figure cannot be computed honestly the page says so, and the data-quality panel lists the
 * indicators that currently have records behind them.
 */
export default async function ProcurementOverviewPage() {
  const principal = await requireActiveProfile();

  if (!principal.permissions.has("procurement.dashboard.view")) {
    return <PermissionGuard permission="procurement.dashboard.view" />;
  }

  const dashboard = await getProcurementDashboard();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Procurement"
        description="Requisitions, supplier quotations, purchase orders, deliveries and supplier advances. Every figure on this page comes from a document somebody recorded."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Procurement" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/procurement/reports" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              <FileText aria-hidden /> Reports
            </Link>
            <Link href="/procurement/requisitions/new" className={cn(buttonVariants({ size: "sm" }))}>
              New requisition
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {dashboard.metrics.map((metric) => (
          <MetricCard key={metric.label} label={metric.label} value={metric.value} hint={metric.hint} tone={metric.tone} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Committed spend by currency</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dashboard.committed.length === 0 ? (
              <p className="text-xs text-ink-muted">
                No order has been submitted yet, so there is nothing committed to report.
              </p>
            ) : (
              <>
                {dashboard.committed.map((entry) => (
                  <div key={entry.currency} className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">{entry.currency}</span>
                    <span className="font-semibold tabular-nums text-ink">{money(entry.currency, entry.total)}</span>
                  </div>
                ))}
                <p className="pt-1 text-[0.6875rem] text-ink-subtle">
                  Orders that reached approval, issue or receipt. Amounts are never added across currencies:
                  doing so would need an exchange-rate convention this system has not been configured with.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Supplier advances outstanding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dashboard.advanceBalances.length === 0 ? (
              <p className="text-xs text-ink-muted">
                No advance has been confirmed as paid by treasury, so there is no advance balance.
              </p>
            ) : (
              <>
                {dashboard.advanceBalances.map((entry) => (
                  <div key={entry.currency} className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted">{entry.currency}</span>
                    <span className="font-semibold tabular-nums text-ink">{money(entry.currency, entry.total)}</span>
                  </div>
                ))}
                <p className="pt-1 text-[0.6875rem] text-ink-subtle">
                  An advance is an asset, not an expense. It reduces only when Finance confirms an application
                  against an invoice.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Overdue deliveries</CardTitle>
          <Link href="/procurement/purchase-orders?overdue=1" className="text-xs font-medium text-brand-700">
            All outstanding <ArrowRight className="inline size-3" aria-hidden />
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {dashboard.overdue.length === 0 ? (
            <EmptyState
              icon={PackageCheck}
              title="Nothing overdue"
              description="No issued order has passed its expected delivery date with quantity still outstanding. An order without an expected date cannot be counted as late."
            />
          ) : (
            <TableWrapper>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Order</TH>
                    <TH>Supplier</TH>
                    <TH>Expected</TH>
                    <TH className="text-right">Outstanding</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {dashboard.overdue.map((order) => (
                    <TR key={order.purchase_order_id}>
                      <TD>
                        <Link
                          href={`/procurement/purchase-orders/${order.purchase_order_id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {order.reference}
                        </Link>
                      </TD>
                      <TD>{order.supplier_name_snapshot}</TD>
                      <TD>{formatDate(order.expected_delivery_date)}</TD>
                      <TD className="text-right tabular-nums">
                        {new Intl.NumberFormat("en-NG", { maximumFractionDigits: 6 }).format(order.outstanding_quantity)}
                      </TD>
                      <TD>
                        <Badge tone={procurementStatusTone(order.status)}>{labelForStatus(order.status)}</Badge>
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
          <CardTitle>Data quality</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {dashboard.quality.length === 0 ? (
            <Alert tone="success" title="No data-quality findings">
              The indicators cover issued orders without a version snapshot, posted receipts without an inventory
              handoff event, accepted quantities reported as rejected, open advances and orders against unverified
              suppliers. All currently read zero.
            </Alert>
          ) : (
            dashboard.quality.map((indicator) => (
              <div
                key={indicator.indicator}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    <AlertTriangle
                      className={cn("size-3.5", indicator.severity === "critical" ? "text-danger-600" : "text-warning-600")}
                      aria-hidden
                    />
                    {indicator.indicator.replace(/_/g, " ")}
                  </p>
                  <p className="text-xs text-ink-muted">{indicator.description}</p>
                </div>
                <Badge tone={indicator.severity === "critical" ? "danger" : "warning"}>
                  {indicator.record_count} record(s)
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            href: "/procurement/requisitions",
            icon: ClipboardList,
            title: "Requisitions",
            body: "Requests from departments. Approving one authorises the purchase, not the spending.",
          },
          {
            href: "/procurement/purchase-orders",
            icon: FileText,
            title: "Purchase orders",
            body: "Approved and issued orders. An issued order is immutable; changes are amendments.",
          },
          {
            href: "/procurement/goods-receipts",
            icon: Wallet,
            title: "Goods receipts",
            body: "Deliveries with accepted, rejected and quarantined quantities kept apart.",
          },
        ].map((card) => (
          <Link key={card.href} href={card.href} className="erp-card block p-4 transition-colors hover:border-brand-300">
            <card.icon className="size-4 text-brand-700" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-ink">{card.title}</p>
            <p className="mt-1 text-xs text-ink-muted">{card.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
