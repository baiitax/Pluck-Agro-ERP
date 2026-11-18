import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { PositionFormDialog } from "@/components/forms/position-form";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/services/authorization";
import { getDepartments } from "@/services/departments/get-departments";
import { getPositions } from "@/services/positions/manage-positions";

export const metadata: Metadata = { title: "Positions" };
export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const principal = await requirePermission("employees.position.view");
  const [positions, departments] = await Promise.all([getPositions(), getDepartments()]);

  const canCreate = principal.permissions.has("employees.position.create");
  const canUpdate = principal.permissions.has("employees.position.update");
  const departmentOptions = departments
    .filter((department) => department.is_active)
    .map((department) => ({ id: department.id, label: `${department.name} (${department.code})` }));

  return (
    <div>
      <PageHeader
        title="Positions"
        description="Position records describe the job a person fills. A position is not a system role: ERP access comes from roles, and neither substitutes for the other."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administration" }, { label: "Positions" }]}
        actions={canCreate ? <PositionFormDialog departments={departmentOptions} trigger="create" /> : null}
      />

      <div className="erp-card overflow-hidden">
        {positions.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No positions defined"
            description={
              canCreate
                ? "Create positions so employees can be placed accurately and the org chart can group people by job."
                : "An administrator with employees.position.create permission maintains positions."
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Position</TH>
                  <TH>Code</TH>
                  <TH>Department</TH>
                  <TH>Grade</TH>
                  <TH>Holders</TH>
                  <TH>Status</TH>
                  {canUpdate ? <TH className="text-right">Actions</TH> : null}
                </TR>
              </THead>
              <TBody>
                {positions.map((position) => (
                  <TR key={position.id}>
                    <TD className="text-xs font-semibold text-ink">{position.title}</TD>
                    <TD className="font-mono text-[0.6875rem] text-ink-muted">{position.code}</TD>
                    <TD className="text-xs">{position.department?.name ?? "Any"}</TD>
                    <TD className="text-xs">{position.grade ?? "—"}</TD>
                    <TD className="text-xs">
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3 text-ink-subtle" aria-hidden />
                        {position.holder_count}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={position.is_active ? "success" : "neutral"} dot>
                        {position.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    {canUpdate ? (
                      <TD className="text-right">
                        <PositionFormDialog
                          departments={departmentOptions}
                          position={{
                            id: position.id,
                            title: position.title,
                            code: position.code,
                            department_id: position.department_id,
                            grade: position.grade,
                            description: position.description,
                            is_active: position.is_active,
                          }}
                          trigger="edit"
                        />
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <p className="mt-3 text-[0.6875rem] text-ink-subtle">
        {positions.length} position(s) · {positions.filter((position) => position.is_active).length} active ·{" "}
        <Link href="/administration/org-chart" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          View the org chart
        </Link>
      </p>
    </div>
  );
}
