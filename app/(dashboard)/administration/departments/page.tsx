import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Network } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { DeactivateDepartmentButton, DepartmentFormDialog } from "@/components/forms/department-form";
import { flattenTree } from "@/lib/organization/tree";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/services/authorization";
import { departmentTree, getDepartmentsWithMeta } from "@/services/departments/get-departments";
import { getEmployeeOptions } from "@/services/employees/get-employees";

export const metadata: Metadata = { title: "Departments" };
export const dynamic = "force-dynamic";

export default async function DepartmentsPage() {
  const principal = await requirePermission("employees.department.view");
  const [departments, employees] = await Promise.all([getDepartmentsWithMeta(), getEmployeeOptions()]);

  const canCreate = principal.permissions.has("employees.department.create");
  const canUpdate = principal.permissions.has("employees.department.update");

  const tree = departmentTree(departments);
  const ordered = flattenTree(tree);

  const departmentOptions = departments
    .filter((department) => department.is_active)
    .map((department) => ({ id: department.id, label: `${department.name} (${department.code})` }));
  const employeeOptions = employees.map((employee) => ({
    id: employee.id,
    label: `${employee.first_name} ${employee.last_name} · ${employee.employee_number}`,
  }));

  return (
    <div>
      <PageHeader
        title="Departments"
        description="The organisational hierarchy. Departments nest freely, drive department-scoped permissions and later feed cost accounting. A parent cannot be its own descendant and a department with active staff cannot be deactivated."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administration" }, { label: "Departments" }]}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/administration/org-chart" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
              <Network aria-hidden /> Org chart
            </Link>
            {canCreate ? (
              <DepartmentFormDialog departments={departmentOptions} employees={employeeOptions} trigger="create" />
            ) : null}
          </div>
        }
      />

      <div className="erp-card overflow-hidden">
        {ordered.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No departments recorded"
            description={
              canCreate
                ? "Create the first department, then add sub-departments to build the hierarchy."
                : "An administrator with employees.department.create permission creates departments."
            }
          />
        ) : (
          <TableWrapper>
            <Table className="min-w-[48rem]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Department</TH>
                  <TH>Code</TH>
                  <TH>Head</TH>
                  <TH>Parent</TH>
                  <TH>Headcount</TH>
                  <TH>Cost centre</TH>
                  <TH>Status</TH>
                  {canUpdate ? <TH className="text-right">Actions</TH> : null}
                </TR>
              </THead>
              <TBody>
                {ordered.map(({ node, depth }) => (
                  <TR key={node.id}>
                    <TD>
                      <div style={{ paddingLeft: `${depth * 16}px` }} className="flex items-center gap-1.5">
                        {depth > 0 ? <span aria-hidden className="text-ink-subtle">└</span> : null}
                        <span className="text-xs font-semibold text-ink">{node.name}</span>
                        {node.is_active ? null : (
                          <Badge tone="neutral" dot>
                            Inactive
                          </Badge>
                        )}
                      </div>
                      {node.description ? (
                        <p
                          style={{ paddingLeft: `${depth * 16 + (depth > 0 ? 14 : 0)}px` }}
                          className="text-[0.6875rem] text-ink-subtle"
                        >
                          {node.description}
                        </p>
                      ) : null}
                    </TD>
                    <TD className="font-mono text-[0.6875rem] text-ink-muted">{node.code}</TD>
                    <TD className="text-xs">
                      {node.head ? `${node.head.first_name} ${node.head.last_name}` : "—"}
                    </TD>
                    <TD className="text-xs">{node.parent?.name ?? "—"}</TD>
                    <TD className="text-xs">{node.employee_count}</TD>
                    <TD className="font-mono text-[0.6875rem] text-ink-muted">{node.cost_center_code ?? "—"}</TD>
                    <TD>
                      <Badge tone={node.is_active ? "success" : "neutral"} dot>
                        {node.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    {canUpdate ? (
                      <TD className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <DepartmentFormDialog
                            departments={departmentOptions}
                            employees={employeeOptions}
                            department={{
                              id: node.id,
                              name: node.name,
                              code: node.code,
                              description: node.description,
                              parent_department_id: node.parent_department_id,
                              department_head_employee_id: node.department_head_employee_id,
                              cost_center_code: node.cost_center_code,
                              is_active: node.is_active,
                            }}
                            trigger="edit"
                          />
                          {node.is_active ? (
                            <DeactivateDepartmentButton departmentId={node.id} name={node.name} />
                          ) : null}
                        </div>
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
        {departments.length} department(s) · {departments.filter((department) => department.is_active).length} active ·
        hierarchy depth {Math.max(0, ...ordered.map((entry) => entry.depth)) + (ordered.length > 0 ? 1 : 0)} level(s)
      </p>
    </div>
  );
}
