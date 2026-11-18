import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Boxes, Building2, ClipboardList, Package, Ruler, Scale, Users } from "lucide-react";

import { PermissionGuard } from "@/components/shared/permission-guard";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { MetricCard } from "@/components/shared/metric-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { guardMasterDataPage } from "@/lib/master-data/page-guard";
import { labelFor } from "@/lib/master-data/statuses";
import { cn } from "@/lib/utils";
import { getMasterDataOverview } from "@/services/master-data/overview";

export const metadata: Metadata = { title: "Master data" };
export const dynamic = "force-dynamic";

export default async function MasterDataOverviewPage() {
  const { allowed } = await guardMasterDataPage("master_data.overview.view");
  if (!allowed) return <PermissionGuard permission="master_data.overview.view" />;

  const overview = await getMasterDataOverview();
  const empty =
    overview.suppliers.total + overview.customers.total + overview.products.total === 0;

  return (
    <div>
      <PageHeader
        title="Master data"
        description="The shared registers every other module reads: business partners, the product catalogue, units of measure, locations and commercial references. Figures below are counts of records you are permitted to see — nothing here is estimated."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Master data" }]}
        badge={<Badge tone="info">Phase 2</Badge>}
      />

      {empty ? (
        <Card className="mb-4">
          <EmptyState
            icon={Boxes}
            title="No master records yet"
            description="This is an honest zero, not a loading state. Start with reference data (units, categories, payment terms), then add suppliers, customers and products — or stage a CSV import."
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/master-data/units" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
                  Units &amp; conversions
                </Link>
                <Link href="/master-data/imports" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
                  Import centre
                </Link>
              </div>
            }
          />
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Suppliers"
          value={overview.suppliers.total}
          hint={`${overview.suppliers.active} active · ${overview.suppliers.blocked} blocked · ${overview.suppliers.draft} draft`}
          icon={Building2}
          tone="brand"
        />
        <MetricCard
          label="Customers"
          value={overview.customers.total}
          hint={`${overview.customers.active} active · ${overview.customers.prospects} prospects`}
          icon={Users}
          tone="brand"
        />
        <MetricCard
          label="Products"
          value={overview.products.total}
          hint={`${overview.products.active} active · ${overview.products.draft} draft`}
          icon={Package}
          tone="brand"
        />
        <MetricCard
          label="Open duplicate candidates"
          value={overview.governance.openDuplicates}
          hint="Reviews pending. Nothing is merged automatically."
          icon={AlertTriangle}
          tone={overview.governance.openDuplicates > 0 ? "pending" : "neutral"}
        />
        <MetricCard
          label="Sites"
          value={overview.locations.sites}
          hint={`${overview.locations.activeSites} active · ${overview.locations.warehouses} warehouse(s) · ${overview.locations.storageLocations} storage location(s)`}
          icon={Building2}
          tone="neutral"
        />
        <MetricCard
          label="Units of measure"
          value={overview.measurement.units}
          hint={`${overview.measurement.activeUnits} active · ${overview.measurement.conversions} conversion rule(s), ${overview.measurement.productSpecificConversions} product-specific`}
          icon={Ruler}
          tone="neutral"
        />
        <MetricCard
          label="Currencies & rates"
          value={overview.references.currencies}
          hint={`${overview.references.activeCurrencies} active · ${overview.references.exchangeRates} rate record(s)`}
          icon={Scale}
          tone="neutral"
        />
        <MetricCard
          label="Quality signals"
          value={overview.governance.qualityIssues}
          hint={`${overview.quality.length} indicator(s) with at least one record`}
          icon={ClipboardList}
          tone={overview.governance.qualityIssues > 0 ? "pending" : "neutral"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold text-ink">Data quality</h2>
            <Link href="/master-data/quality" className="text-xs font-medium text-brand-700 hover:underline">
              Open workspace
            </Link>
          </div>
          {overview.quality.length === 0 ? (
            <EmptyState
              title="No quality indicators triggered"
              description="Indicators are computed from real rows. Nothing is flagged because nothing currently fails a rule."
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.quality.slice(0, 6).map((issue) => (
                <li key={`${issue.entity_type}-${issue.indicator}`} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink">{issue.description}</p>
                    <p className="text-[0.6875rem] text-ink-subtle">
                      {labelFor(issue.entity_type)} · {issue.indicator}
                    </p>
                  </div>
                  <Badge tone={issue.severity === "critical" ? "danger" : issue.severity === "warning" ? "warning" : "neutral"}>
                    {issue.record_count}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold text-ink">Recently changed master data</h2>
            <Link href="/master-data/history" className="text-xs font-medium text-brand-700 hover:underline">
              Full history
            </Link>
          </div>
          {overview.recentlyUpdated.length === 0 ? (
            <EmptyState title="No changes recorded yet" description="The change history is written by database triggers on every master table." />
          ) : (
            <TableWrapper>
              <Table className="min-w-0">
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Record</TH>
                    <TH>Change</TH>
                    <TH>When</TH>
                  </TR>
                </THead>
                <TBody>
                  {overview.recentlyUpdated.map((entry) => (
                    <TR key={`${entry.entity}-${entry.id}-${entry.updated_at}`}>
                      <TD className="text-xs">
                        <span className="font-medium">{entry.reference ?? labelFor(entry.entity)}</span>
                        <span className="block text-[0.6875rem] text-ink-subtle">{labelFor(entry.entity)}</span>
                      </TD>
                      <TD className="text-xs text-ink-muted">{labelFor(entry.label)}</TD>
                      <TD className="text-[0.6875rem] text-ink-subtle">
                        {new Date(entry.updated_at).toLocaleString("en-GB")}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
        </Card>
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        Counted at {new Date(overview.generatedAt).toLocaleString("en-GB")} · product types recorded:{" "}
        {overview.products.byType.length === 0
          ? "none"
          : overview.products.byType.map((entry) => `${labelFor(entry.type)} (${entry.count})`).join(", ")}
      </p>
    </div>
  );
}
