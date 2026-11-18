import type { Metadata } from "next";
import Link from "next/link";
import { Building2, ClipboardCheck, KeyRound, ShieldCheck, UserCog, UsersRound } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireActiveProfile } from "@/services/authorization";

export const metadata: Metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

const SECTIONS = [
  {
    href: "/administration/employees",
    permission: "employees.employee.view",
    title: "Employees",
    description: "Employee master records, departments and employment status.",
    icon: UsersRound,
  },
  {
    href: "/administration/departments",
    permission: "employees.department.view",
    title: "Departments",
    description: "Organisational units used for assignment and future cost centres.",
    icon: Building2,
  },
  {
    href: "/administration/users",
    permission: "access.accounts.view",
    title: "Users & access",
    description: "ERP accounts, role assignments and account activation.",
    icon: UserCog,
  },
  {
    href: "/administration/roles",
    permission: "access.roles.view",
    title: "Roles",
    description: "Role templates and the permissions each role grants.",
    icon: ShieldCheck,
  },
  {
    href: "/administration/permissions",
    permission: "access.permissions.view",
    title: "Permissions",
    description: "The full permission catalogue in module.action form.",
    icon: KeyRound,
  },
  {
    href: "/audit-logs",
    permission: "governance.audit.view",
    title: "Audit logs",
    description: "Append-only history of administrative and security events.",
    icon: ClipboardCheck,
  },
] as const;

export default async function AdministrationPage() {
  const principal = await requireActiveProfile();
  const sections = SECTIONS.filter((section) => principal.permissions.has(section.permission));

  return (
    <div>
      <PageHeader
        title="Administration"
        description="Identity, organisational structure and access control for the ERP."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administration" }]}
      />

      {sections.length === 0 ? (
        <p className="text-sm text-ink-muted">Your role does not include any administration permissions.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((section) => (
            <Link key={section.href} href={section.href} className="group">
              <Card className="h-full p-5 transition-colors group-hover:border-brand-300 group-hover:bg-brand-50/40">
                <section.icon className="size-5 text-brand-700" aria-hidden />
                <p className="mt-3 text-sm font-semibold text-ink">{section.title}</p>
                <p className="mt-1 text-xs text-ink-muted">{section.description}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle>What this foundation enforces</CardTitle>
            <CardDescription>Security model</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-ink-muted sm:grid-cols-2">
          <p>• Every page and action re-checks authorization on the server.</p>
          <p>• Row Level Security independently filters database rows.</p>
          <p>• Accounts without an active ERP profile cannot sign in.</p>
          <p>• Self-assignment of roles is blocked in the app, policy and trigger.</p>
          <p>• Audit history is append-only, including for administrators.</p>
          <p>• Administrative mutations require an explicit permission.</p>
        </CardContent>
      </Card>
    </div>
  );
}
