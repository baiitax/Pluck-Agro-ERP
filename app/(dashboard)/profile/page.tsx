import type { Metadata } from "next";
import { Building2, CalendarDays, IdCard, Mail, Phone, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { AccountStatusBadge, EmploymentStatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime, formatRelative } from "@/lib/formatting";
import { requireActiveProfile } from "@/services/authorization";
import { employeeFullName } from "@/services/employees/get-employees";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/definitions";

export const metadata: Metadata = { title: "My profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const principal = await requireActiveProfile();
  const { employee, profile, user, roles, permissions } = principal;
  const displayName = profile.display_name ?? (employee ? employeeFullName(employee) : user.email);

  return (
    <div>
      <PageHeader
        title="My profile"
        description="Your ERP identity. Profile and access changes are made by a system administrator and recorded in the audit log."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "My profile" }]}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Identity</CardTitle>
              <CardDescription>Linked employee record and account status</CardDescription>
            </div>
            <AccountStatusBadge status={profile.account_status} />
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-12 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800"
              >
                {displayName.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">{displayName}</p>
                <p className="text-xs text-ink-muted">{employee?.job_title ?? "No job title recorded"}</p>
              </div>
            </div>

            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <Row icon={Mail} label="Work email" value={user.email} />
              <Row icon={IdCard} label="Employee number" value={employee?.employee_number ?? "Not linked"} />
              <Row icon={Phone} label="Phone" value={employee?.phone ?? "—"} />
              <Row icon={CalendarDays} label="Date joined" value={formatDate(employee?.date_joined ?? null)} />
              <Row
                icon={Building2}
                label="Employment status"
                value={employee ? <EmploymentStatusBadge status={employee.employment_status} /> : "—"}
              />
              <Row icon={CalendarDays} label="Last sign-in" value={formatRelative(profile.last_login_at)} />
              <Row icon={ShieldCheck} label="Profile created" value={formatDateTime(profile.created_at)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Roles</CardTitle>
              <CardDescription>Assigned by an administrator</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {roles.length === 0 ? (
              <p className="text-xs text-ink-muted">No roles assigned.</p>
            ) : (
              roles.map((role) => (
                <div key={role.id} className="rounded-lg border border-border px-3 py-2">
                  <p className="flex items-center justify-between gap-2 text-xs font-medium text-ink">
                    {role.roleName}
                    <Badge tone="success" dot>
                      Active
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-[0.6875rem] text-ink-subtle">
                    Assigned {formatDate(role.assignedAt)}
                    {role.expiresAt ? ` · expires ${formatDate(role.expiresAt)}` : ""}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle>Effective permissions ({permissions.size})</CardTitle>
            <CardDescription>
              The union of permissions granted by your active roles. Enforced server-side on every request.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {ALL_PERMISSION_CODES.filter((code) => permissions.has(code)).map((code) => (
              <Badge key={code} tone="neutral">
                {code}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-1.5">
      <dt className="flex items-center gap-1.5 text-xs text-ink-muted">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </dt>
      <dd className="text-right text-xs font-medium text-ink">{value}</dd>
    </div>
  );
}
