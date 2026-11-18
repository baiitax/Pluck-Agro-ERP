import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateRoleDialog } from "@/components/roles/role-form";
import { requirePermission } from "@/services/authorization";
import { getRolesWithStats } from "@/services/roles/get-roles";

export const metadata: Metadata = { title: "Roles" };
export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const principal = await requirePermission("access.roles.view");
  const roles = await getRolesWithStats();
  const canCreate = principal.permissions.has("access.roles.create");

  const byCategory = new Map<string, typeof roles>();
  for (const role of roles) {
    const bucket = byCategory.get(role.category) ?? [];
    bucket.push(role);
    byCategory.set(role.category, bucket);
  }

  return (
    <div>
      <PageHeader
        title="Roles"
        description="Roles bundle permissions. A person may hold several roles and their effective permissions are the union. Roles are configuration data: create, clone, edit and deactivate them here."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administration" }, { label: "Roles" }]}
        actions={canCreate ? <CreateRoleDialog /> : null}
      />

      {roles.length === 0 ? (
        <div className="erp-card">
          <EmptyState
            icon={ShieldCheck}
            title="No roles found"
            description="Run the seed migrations to create the system role templates."
          />
        </div>
      ) : (
        <div className="space-y-5">
          {[...byCategory.entries()].map(([category, categoryRoles]) => (
            <section key={category}>
              <h2 className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-subtle">
                {category.replace(/_/g, " ")} · {categoryRoles.length}
              </h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {categoryRoles.map((role) => (
                  <Card key={role.id} className="flex flex-col">
                    <CardHeader>
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Link
                            href={`/administration/roles/${role.id}`}
                            className="hover:text-brand-700 hover:underline"
                          >
                            {role.name}
                          </Link>
                          {role.is_system_role ? (
                            <Badge tone="brand" className="text-[0.625rem]">
                              System
                            </Badge>
                          ) : (
                            <Badge tone="neutral" className="text-[0.625rem]">
                              Custom
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="font-mono text-[0.6875rem]">{role.code}</CardDescription>
                      </div>
                      <Badge tone={role.is_active ? "success" : "neutral"} dot>
                        {role.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col justify-between gap-3">
                      <p className="text-xs text-ink-muted">{role.description ?? "No description."}</p>
                      <div className="flex items-center justify-between text-[0.6875rem] text-ink-subtle">
                        <span>{role.permission_count} permissions</span>
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3" aria-hidden />
                          {role.member_count} member(s)
                        </span>
                      </div>
                      <Link
                        href={`/administration/roles/${role.id}`}
                        className="text-[0.6875rem] font-medium text-brand-700 hover:underline"
                      >
                        Open permission matrix →
                      </Link>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
