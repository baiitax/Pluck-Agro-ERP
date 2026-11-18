import "server-only";

import { currentReviewPeriod } from "@/lib/governance/review-period";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACCOUNT_STATUSES, type AccountStatusValue } from "@/lib/constants/statuses";
import type { AuditSeverity } from "@/types/database.types";

export type GovernanceAlert = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  href?: string;
};

export type GovernanceMetrics = {
  generatedAt: string;
  workforce: {
    total: number;
    current: number;
    ended: number;
    departments: number;
    activeDepartments: number;
    positions: number;
    withoutDepartment: number;
    withoutSupervisor: number;
  };
  accounts: {
    total: number;
    byStatus: Record<AccountStatusValue, number>;
    withoutRole: number;
    neverSignedIn: number;
    staleInvitations: number;
    sessionsRevokedLast30d: number;
  };
  access: {
    roles: number;
    activeRoles: number;
    customRoles: number;
    permissions: number;
    expiringAssignments: number;
  };
  governance: {
    authorities: number;
    activeAuthorities: number;
    authoritiesExpiringSoon: number;
    liveDelegations: number;
    pendingDelegations: number;
    delegationsExpiringSoon: number;
    sodRules: number;
    activeSodRules: number;
    activeOverrides: number;
    reviewPeriod: string;
    reviewsThisPeriod: number;
    reviewsCompleted: number;
    accountsUnreviewed: number;
  };
  audit: {
    events24h: number;
    critical7d: number;
    warnings7d: number;
    byCategory: { category: string; count: number }[];
    recentCritical: { id: string; action: string; description: string | null; created_at: string; severity: AuditSeverity }[];
  };
  alerts: GovernanceAlert[];
};

const DAY = 86_400_000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

/**
 * Real governance metrics, computed from the database on every request.
 *
 * Nothing here is estimated, seeded or invented: every number is a count of rows the caller is
 * allowed to read. Where a metric cannot be computed (for example a metric that needs Phase 2
 * data) it is simply not reported.
 */
export async function getGovernanceMetrics(): Promise<GovernanceMetrics> {
  const supabase = await createSupabaseServerClient();
  const period = currentReviewPeriod();

  const [
    employees,
    departments,
    positions,
    profiles,
    roleAssignments,
    roles,
    permissions,
    authorities,
    delegations,
    sodRules,
    sodOverrides,
    reviews,
    auditRecent,
    auditCritical,
    auditCategoryRows,
    recentCritical,
  ] = await Promise.all([
    supabase.from("employees").select("id, employment_status, department_id, supervisor_employee_id").returns<
      { id: string; employment_status: string; department_id: string | null; supervisor_employee_id: string | null }[]
    >(),
    supabase.from("departments").select("id, is_active").returns<{ id: string; is_active: boolean }[]>(),
    supabase.from("employee_positions").select("id, is_active").returns<{ id: string; is_active: boolean }[]>(),
    supabase
      .from("profiles")
      .select("id, account_status, last_login_at, invited_at, sessions_revoked_at, employee_id")
      .returns<
        {
          id: string;
          account_status: AccountStatusValue;
          last_login_at: string | null;
          invited_at: string | null;
          sessions_revoked_at: string | null;
          employee_id: string | null;
        }[]
      >(),
    supabase
      .from("user_roles")
      .select("id, user_id, expires_at, is_active")
      .eq("is_active", true)
      .returns<{ id: string; user_id: string; expires_at: string | null; is_active: boolean }[]>(),
    supabase.from("roles").select("id, is_active, is_system_role").returns<{ id: string; is_active: boolean; is_system_role: boolean }[]>(),
    supabase.from("permissions").select("id", { count: "exact", head: true }),
    supabase
      .from("approval_authorities")
      .select("id, is_active, effective_until")
      .returns<{ id: string; is_active: boolean; effective_until: string | null }[]>(),
    supabase
      .from("approval_delegations")
      .select("id, status, effective_until")
      .returns<{ id: string; status: string; effective_until: string }[]>(),
    supabase
      .from("segregation_of_duties_rules")
      .select("id, is_active")
      .returns<{ id: string; is_active: boolean }[]>(),
    supabase
      .from("sod_overrides")
      .select("id, expires_at")
      .returns<{ id: string; expires_at: string | null }[]>(),
    supabase
      .from("access_review_records")
      .select("id, review_period, review_status, user_id")
      .eq("review_period", period)
      .returns<{ id: string; review_period: string; review_status: string; user_id: string | null }[]>(),
    supabase
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", daysAgo(1)),
    supabase
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("severity", "critical")
      .gte("created_at", daysAgo(7)),
    supabase
      .from("audit_logs")
      .select("event_category")
      .gte("created_at", daysAgo(30))
      .returns<{ event_category: string | null }[]>(),
    supabase
      .from("audit_logs")
      .select("id, action, description, created_at, severity")
      .in("severity", ["critical", "warning"])
      .gte("created_at", daysAgo(7))
      .order("created_at", { ascending: false })
      .limit(8)
      .returns<{ id: string; action: string; description: string | null; created_at: string; severity: AuditSeverity }[]>(),
  ]);

  const employeeRows = employees.data ?? [];
  const profileRows = profiles.data ?? [];
  const assignmentRows = roleAssignments.data ?? [];
  const roleRows = roles.data ?? [];
  const authorityRows = authorities.data ?? [];
  const delegationRows = delegations.data ?? [];
  const ruleRows = sodRules.data ?? [];
  const overrideRows = sodOverrides.data ?? [];
  const reviewRows = reviews.data ?? [];

  const now = Date.now();
  const currentStatuses = new Set(["active", "probation", "on_leave", "suspended"]);

  const byStatus = Object.fromEntries(ACCOUNT_STATUSES.map((status) => [status, 0])) as Record<AccountStatusValue, number>;
  for (const profile of profileRows) {
    byStatus[profile.account_status] = (byStatus[profile.account_status] ?? 0) + 1;
  }

  const usersWithRoles = new Set(assignmentRows.map((assignment) => assignment.user_id));

  const metrics: GovernanceMetrics = {
    generatedAt: new Date().toISOString(),
    workforce: {
      total: employeeRows.length,
      current: employeeRows.filter((row) => currentStatuses.has(row.employment_status)).length,
      ended: employeeRows.filter((row) => !currentStatuses.has(row.employment_status)).length,
      departments: (departments.data ?? []).length,
      activeDepartments: (departments.data ?? []).filter((row) => row.is_active).length,
      positions: (positions.data ?? []).filter((row) => row.is_active).length,
      withoutDepartment: employeeRows.filter((row) => currentStatuses.has(row.employment_status) && !row.department_id).length,
      withoutSupervisor: employeeRows.filter(
        (row) => currentStatuses.has(row.employment_status) && !row.supervisor_employee_id,
      ).length,
    },
    accounts: {
      total: profileRows.length,
      byStatus,
      withoutRole: profileRows.filter((row) => !usersWithRoles.has(row.id)).length,
      neverSignedIn: profileRows.filter((row) => !row.last_login_at).length,
      staleInvitations: profileRows.filter(
        (row) =>
          (row.account_status === "invited" || row.account_status === "pending_setup") &&
          row.invited_at &&
          new Date(row.invited_at).getTime() < now - 7 * DAY,
      ).length,
      sessionsRevokedLast30d: profileRows.filter(
        (row) => row.sessions_revoked_at && new Date(row.sessions_revoked_at).getTime() > now - 30 * DAY,
      ).length,
    },
    access: {
      roles: roleRows.length,
      activeRoles: roleRows.filter((row) => row.is_active).length,
      customRoles: roleRows.filter((row) => !row.is_system_role).length,
      permissions: permissions.count ?? 0,
      expiringAssignments: assignmentRows.filter(
        (row) => row.expires_at && new Date(row.expires_at).getTime() < now + 30 * DAY,
      ).length,
    },
    governance: {
      authorities: authorityRows.length,
      activeAuthorities: authorityRows.filter((row) => row.is_active).length,
      authoritiesExpiringSoon: authorityRows.filter(
        (row) =>
          row.is_active &&
          row.effective_until &&
          new Date(row.effective_until).getTime() < now + 30 * DAY &&
          new Date(row.effective_until).getTime() > now,
      ).length,
      liveDelegations: delegationRows.filter(
        (row) =>
          row.status === "approved" &&
          new Date(row.effective_until).getTime() > now,
      ).length,
      pendingDelegations: delegationRows.filter((row) => row.status === "pending_approval").length,
      delegationsExpiringSoon: delegationRows.filter(
        (row) =>
          row.status === "approved" &&
          new Date(row.effective_until).getTime() > now &&
          new Date(row.effective_until).getTime() < now + 7 * DAY,
      ).length,
      sodRules: ruleRows.length,
      activeSodRules: ruleRows.filter((row) => row.is_active).length,
      activeOverrides: overrideRows.filter(
        (row) => !row.expires_at || new Date(row.expires_at).getTime() > now,
      ).length,
      reviewPeriod: period,
      reviewsThisPeriod: reviewRows.length,
      reviewsCompleted: reviewRows.filter((row) => row.review_status === "completed").length,
      accountsUnreviewed: Math.max(
        0,
        profileRows.filter((row) => row.account_status !== "deactivated").length -
          new Set(reviewRows.map((row) => row.user_id)).size,
      ),
    },
    audit: {
      events24h: auditRecent.count ?? 0,
      critical7d: auditCritical.count ?? 0,
      warnings7d: (recentCritical.data ?? []).filter((row) => row.severity === "warning").length,
      byCategory: Object.entries(
        (auditCategoryRows.data ?? []).reduce<Record<string, number>>((accumulator, row) => {
          const key = row.event_category ?? "general";
          accumulator[key] = (accumulator[key] ?? 0) + 1;
          return accumulator;
        }, {}),
      )
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
      recentCritical: recentCritical.data ?? [],
    },
    alerts: [],
  };

  const alerts: GovernanceAlert[] = [];

  if (metrics.accounts.withoutRole > 0) {
    alerts.push({
      id: "accounts-without-role",
      severity: "critical",
      title: `${metrics.accounts.withoutRole} account(s) with no role`,
      description: "These accounts can sign in but can do nothing. Assign a role or deactivate the account.",
      href: "/administration/users?role=none",
    });
  }
  if (metrics.governance.pendingDelegations > 0) {
    alerts.push({
      id: "pending-delegations",
      severity: "warning",
      title: `${metrics.governance.pendingDelegations} delegation request(s) awaiting a decision`,
      description: "A delegation grants nothing until it is approved by someone other than its creator.",
      href: "/governance/delegations?status=pending_approval",
    });
  }
  if (metrics.accounts.staleInvitations > 0) {
    alerts.push({
      id: "stale-invitations",
      severity: "warning",
      title: `${metrics.accounts.staleInvitations} invitation(s) older than 7 days`,
      description: "The invitee has not completed setup. Re-send the invitation or deactivate the account.",
      href: "/administration/users?status=invited",
    });
  }
  if (metrics.governance.delegationsExpiringSoon > 0) {
    alerts.push({
      id: "delegations-expiring",
      severity: "info",
      title: `${metrics.governance.delegationsExpiringSoon} delegation(s) expire within 7 days`,
      description: "Delegated authority ends automatically at the expiry date.",
      href: "/governance/delegations?status=approved",
    });
  }
  if (metrics.governance.authoritiesExpiringSoon > 0) {
    alerts.push({
      id: "authorities-expiring",
      severity: "info",
      title: `${metrics.governance.authoritiesExpiringSoon} authority limit(s) expire within 30 days`,
      description: "Extend or replace the authority configuration before it lapses.",
      href: "/governance/authorities",
    });
  }
  if (metrics.governance.accountsUnreviewed > 0) {
    alerts.push({
      id: "access-reviews-outstanding",
      severity: "warning",
      title: `${metrics.governance.accountsUnreviewed} account(s) not reviewed in ${period}`,
      description: "Access reviews are evidence for auditors. Record the outstanding reviews for this period.",
      href: "/governance/access-reviews",
    });
  }
  if (metrics.audit.critical7d > 0) {
    alerts.push({
      id: "critical-audit-events",
      severity: "critical",
      title: `${metrics.audit.critical7d} critical audit event(s) in the last 7 days`,
      description: "Review these events: deactivations, session revocations and overrides are all critical by design.",
      href: "/audit-logs?severity=critical",
    });
  }
  if (metrics.workforce.withoutDepartment > 0) {
    alerts.push({
      id: "employees-without-department",
      severity: "info",
      title: `${metrics.workforce.withoutDepartment} active employee(s) with no department`,
      description: "Department membership drives department-scoped permissions and org-chart reporting.",
      href: "/administration/employees?department=none",
    });
  }
  if (metrics.governance.sodRules === 0) {
    alerts.push({
      id: "no-sod-rules",
      severity: "info",
      title: "No segregation-of-duties rules configured",
      description:
        "The system ships with none: your management team must approve each conflicting-duty policy before it is enforced.",
      href: "/governance/sod",
    });
  }

  metrics.alerts = alerts;
  return metrics;
}
