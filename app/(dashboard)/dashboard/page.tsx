import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Database,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";

import { MetricCard } from "@/components/shared/metric-card";
import { PageHeader } from "@/components/shared/page-header";
import { ModuleStatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { formatRelative } from "@/lib/formatting";
import { NAVIGATION } from "@/config/navigation.config";
import { requireActiveProfile } from "@/services/authorization";
import { getAuditEvents } from "@/services/audit/get-audit-events";
import { employeeFullName } from "@/services/employees/get-employees";
import { getSystemHealth } from "@/services/system/health-check";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const principal = await requireActiveProfile();
  const health = await getSystemHealth();
  const canViewAudit = principal.permissions.has("governance.audit.view");

  const recentActivity = canViewAudit ? await getAuditEvents({ pageSize: 10 }) : null;

  const availableModules = NAVIGATION.flatMap((group) => group.items).filter((item) => item.status === "ready");
  const displayName =
    principal.profile.display_name ??
    (principal.employee ? employeeFullName(principal.employee) : principal.user.email);

  return (
    <div>
      <PageHeader
        title={`Welcome, ${displayName}`}
        description="This is the Phase 0 foundation: secure sign-in, role-based access, employee administration and audit history. Operational and financial dashboards appear once those modules are implemented with verified data."
        breadcrumbs={[{ label: "Dashboard" }]}
        badge={
          <Badge tone="brand" dot>
            {principal.roles[0]?.roleName ?? "No role"}
          </Badge>
        }
        actions={
          principal.permissions.has("access.accounts.view") ? (
            <Link href="/administration/users" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Manage access
            </Link>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Account status"
          value={principal.profile.is_active ? "Active" : "Inactive"}
          hint="Enforced on every request"
          icon={CheckCircle2}
          tone="brand"
        />
        <MetricCard
          label="Effective permissions"
          value={String(principal.permissions.size)}
          hint={`Across ${principal.roles.length} role${principal.roles.length === 1 ? "" : "s"}`}
          icon={ShieldCheck}
        />
        <MetricCard
          label="Database"
          value={health.checks.database === "ok" ? "Connected" : health.checks.database}
          hint="Row Level Security enabled"
          icon={Database}
          tone={health.checks.database === "ok" ? "brand" : "danger"}
        />
        <MetricCard
          label="Available modules"
          value={`${availableModules.length} of ${NAVIGATION.flatMap((group) => group.items).length}`}
          hint="Remaining modules are scheduled for later phases"
          icon={Activity}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Your access</CardTitle>
              <CardDescription>
                Permissions are resolved from your role assignments on every request and enforced again in the
                database.
              </CardDescription>
            </div>
            <Link href="/profile" className="text-xs font-medium text-brand-700 hover:underline">
              View profile
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-subtle">Roles</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {principal.roles.length === 0 ? (
                  <span className="text-xs text-ink-muted">No active roles assigned.</span>
                ) : (
                  principal.roles.map((role) => (
                    <Badge key={role.id} tone="info" dot>
                      {role.roleName}
                    </Badge>
                  ))
                )}
              </div>
            </div>

            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-subtle">
                Departments &amp; profile
              </p>
              <dl className="mt-1.5 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                <div className="flex justify-between gap-2 border-b border-border pb-1">
                  <dt className="text-ink-muted">Display name</dt>
                  <dd className="font-medium text-ink">{displayName}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-border pb-1">
                  <dt className="text-ink-muted">Employee number</dt>
                  <dd className="font-medium text-ink">{principal.employee?.employee_number ?? "Not linked"}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-border pb-1">
                  <dt className="text-ink-muted">Job title</dt>
                  <dd className="font-medium text-ink">{principal.employee?.job_title ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-border pb-1">
                  <dt className="text-ink-muted">Last sign-in</dt>
                  <dd className="font-medium text-ink">{formatRelative(principal.profile.last_login_at)}</dd>
                </div>
              </dl>
            </div>

            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-subtle">
                Module availability
              </p>
              <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {NAVIGATION.flatMap((group) => group.items)
                  .filter((item) => principal.permissions.has(item.permission))
                  .map((item) => (
                    <li key={item.href} className="flex items-center justify-between gap-2 text-xs">
                      <Link href={item.href} className="truncate text-ink-muted hover:text-ink hover:underline">
                        {item.label}
                      </Link>
                      <ModuleStatusBadge status={item.status} />
                    </li>
                  ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Recent activity</CardTitle>
                <CardDescription>Authorised audit history only</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {!canViewAudit ? (
                <p className="text-xs text-ink-muted">
                  Your role does not include <code className="rounded bg-surface-sunken px-1">audit.view</code>.
                </p>
              ) : recentActivity && recentActivity.rows.length > 0 ? (
                <ul className="space-y-2.5">
                  {recentActivity.rows.slice(0, 6).map((event) => (
                    <li key={event.id} className="flex gap-2 text-xs">
                      <Clock3 className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{event.description ?? event.action}</p>
                        <p className="text-[0.6875rem] text-ink-subtle">
                          {event.module} · {formatRelative(event.created_at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={ClipboardList}
                  title="No activity recorded yet"
                  description="Administrative changes will appear here as they happen."
                />
              )}
              {canViewAudit ? (
                <Link
                  href="/audit-logs"
                  className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-3 w-full")}
                >
                  Open audit log
                </Link>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>System status</CardTitle>
                <CardDescription>Live checks, not sample data</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <Database className="size-3.5" aria-hidden /> Database
                </span>
                <ModuleStatusBadge status={health.checks.database === "ok" ? "ready" : "planned"} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <ShieldCheck className="size-3.5" aria-hidden /> Environment
                </span>
                <ModuleStatusBadge status={health.checks.environment === "ok" ? "ready" : "planned"} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <Users className="size-3.5" aria-hidden /> Users &amp; access
                </span>
                <Badge tone="success" dot>
                  Available
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <Building2 className="size-3.5" aria-hidden /> Departments
                </span>
                <Badge tone="success" dot>
                  Available
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <TriangleAlert className="size-3.5" aria-hidden /> Pending approvals
                </span>
                <Badge tone="pending" dot>
                  Not built yet
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
