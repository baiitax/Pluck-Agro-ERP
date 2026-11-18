import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { MetricCard } from "@/components/shared/metric-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatRelative } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/services/authorization";
import { getGovernanceMetrics } from "@/services/governance/get-governance-metrics";

export const metadata: Metadata = { title: "Governance dashboard" };
export const dynamic = "force-dynamic";

const SEVERITY_ICON = { critical: ShieldAlert, warning: AlertTriangle, info: Info } as const;
const SEVERITY_TONE = { critical: "danger", warning: "warning", info: "info" } as const;

export default async function GovernanceDashboardPage() {
  await requirePermission("governance.approvals.view");
  const metrics = await getGovernanceMetrics();

  return (
    <div>
      <PageHeader
        title="Governance dashboard"
        description="Live figures read from the database on every request. Nothing on this page is estimated: if a number cannot be counted, it is not shown."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Governance" }]}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active employees" value={metrics.workforce.current} hint={`${metrics.workforce.total} records in total`} />
        <MetricCard
          label="Active ERP accounts"
          value={metrics.accounts.byStatus.active}
          hint={`${metrics.accounts.total} accounts · ${metrics.accounts.withoutRole} without a role`}
        />
        <MetricCard
          label="Roles & permissions"
          value={`${metrics.access.activeRoles}/${metrics.access.roles}`}
          hint={`${metrics.access.permissions} permissions · ${metrics.access.customRoles} custom roles`}
        />
        <MetricCard
          label="Audit events (24h)"
          value={metrics.audit.events24h}
          hint={`${metrics.audit.critical7d} critical in 7 days`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Alerts</CardTitle>
              <CardDescription>
                Derived from real state: {metrics.alerts.length} item(s) need attention.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {metrics.alerts.length === 0 ? (
              <p className="text-xs text-success-700">
                No governance alerts. Account coverage, delegations and access reviews are all in order.
              </p>
            ) : (
              <ul className="space-y-2">
                {metrics.alerts.map((alert) => {
                  const Icon = SEVERITY_ICON[alert.severity];
                  return (
                    <li
                      key={alert.id}
                      className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2"
                    >
                      <Icon
                        aria-hidden
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          alert.severity === "critical"
                            ? "text-danger-600"
                            : alert.severity === "warning"
                              ? "text-warning-600"
                              : "text-info-600",
                        )}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink">{alert.title}</p>
                        <p className="text-[0.6875rem] text-ink-muted">{alert.description}</p>
                        {alert.href ? (
                          <Link
                            href={alert.href}
                            className="mt-0.5 inline-block text-[0.6875rem] font-medium text-brand-700 hover:underline"
                          >
                            Open →
                          </Link>
                        ) : null}
                      </div>
                      <Badge tone={SEVERITY_TONE[alert.severity]} className="ml-auto shrink-0">
                        {alert.severity}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Account lifecycle</CardTitle>
              <CardDescription>Distribution across the six lifecycle states.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {Object.entries(metrics.accounts.byStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between text-xs">
                <span className="text-ink-muted">{status.replace(/_/g, " ")}</span>
                <span className="font-semibold text-ink">{count}</span>
              </div>
            ))}
            <div className="mt-2 space-y-1 border-t border-border pt-2 text-[0.6875rem] text-ink-subtle">
              <p>{metrics.accounts.neverSignedIn} account(s) have never signed in</p>
              <p>{metrics.accounts.staleInvitations} invitation(s) older than 7 days</p>
              <p>{metrics.accounts.sessionsRevokedLast30d} session revocation(s) in 30 days</p>
            </div>
            <Link
              href="/administration/users"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-2 w-full")}
            >
              Manage accounts
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Approval authority</CardTitle>
              <CardDescription>Configuration only — no workflow runs in Phase 1.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <Row label="Configured limits" value={metrics.governance.authorities} />
            <Row label="Active" value={metrics.governance.activeAuthorities} />
            <Row label="Expiring in 30 days" value={metrics.governance.authoritiesExpiringSoon} />
            <Link href="/governance/authorities" className="mt-1 inline-block text-[0.6875rem] text-brand-700 hover:underline">
              Open authorities →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Delegations</CardTitle>
              <CardDescription>Delegated authority can never exceed the delegator&apos;s own.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <Row label="Live" value={metrics.governance.liveDelegations} />
            <Row label="Awaiting approval" value={metrics.governance.pendingDelegations} />
            <Row label="Expiring in 7 days" value={metrics.governance.delegationsExpiringSoon} />
            <Link href="/governance/delegations" className="mt-1 inline-block text-[0.6875rem] text-brand-700 hover:underline">
              Open delegations →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Segregation of duties</CardTitle>
              <CardDescription>Rules are configured by management, never seeded.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <Row label="Rules" value={`${metrics.governance.activeSodRules}/${metrics.governance.sodRules}`} />
            <Row label="Active overrides" value={metrics.governance.activeOverrides} />
            <Link href="/governance/sod" className="mt-1 inline-block text-[0.6875rem] text-brand-700 hover:underline">
              Open rules →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Access reviews</CardTitle>
              <CardDescription>Period {metrics.governance.reviewPeriod}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <Row label="Reviews recorded" value={metrics.governance.reviewsThisPeriod} />
            <Row label="Completed" value={metrics.governance.reviewsCompleted} />
            <Row label="Accounts not reviewed" value={metrics.governance.accountsUnreviewed} />
            <Link href="/governance/access-reviews" className="mt-1 inline-block text-[0.6875rem] text-brand-700 hover:underline">
              Open reviews →
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent critical and warning events</CardTitle>
              <CardDescription>Last 7 days, newest first.</CardDescription>
            </div>
            <Link href="/audit-logs" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              Full audit trail
            </Link>
          </CardHeader>
          <CardContent>
            {metrics.audit.recentCritical.length === 0 ? (
              <p className="text-xs text-ink-subtle">No warning or critical events in the last 7 days.</p>
            ) : (
              <ul className="space-y-1.5">
                {metrics.audit.recentCritical.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{event.action}</p>
                      <p className="truncate text-[0.6875rem] text-ink-muted">{event.description ?? "—"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge tone={event.severity === "critical" ? "danger" : "warning"}>{event.severity}</Badge>
                      <p className="mt-0.5 text-[0.625rem] text-ink-subtle" title={formatDateTime(event.created_at)}>
                        {formatRelative(event.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Audit activity by category (30 days)</CardTitle>
              <CardDescription>Event volume per governance category.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {metrics.audit.byCategory.length === 0 ? (
              <p className="text-xs text-ink-subtle">No audit events in the last 30 days.</p>
            ) : (
              <ul className="space-y-1.5">
                {metrics.audit.byCategory.map((row) => {
                  const max = Math.max(...metrics.audit.byCategory.map((entry) => entry.count));
                  return (
                    <li key={row.category} className="text-xs">
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className="text-ink-muted">{row.category.replace(/_/g, " ")}</span>
                        <span className="font-semibold text-ink">{row.count}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-surface-sunken">
                        <div
                          className="h-1.5 rounded-full bg-brand-600"
                          style={{ width: `${Math.round((row.count / max) * 100)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        Metrics generated {formatDateTime(metrics.generatedAt)} · every figure comes from a live database count.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-muted">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}
