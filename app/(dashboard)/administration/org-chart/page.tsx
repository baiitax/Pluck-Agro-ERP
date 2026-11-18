import type { Metadata } from "next";
import Link from "next/link";
import { Network } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { EmploymentStatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { EMPLOYMENT_STATUSES_CURRENT } from "@/lib/constants/statuses";
import { buildTree, flattenTree } from "@/lib/organization/tree";
import { requirePermission } from "@/services/authorization";
import { getDepartmentsWithMeta } from "@/services/departments/get-departments";
import { employeeFullName } from "@/services/employees/get-employees";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Employee } from "@/types/database.types";

export const metadata: Metadata = { title: "Organisation chart" };
export const dynamic = "force-dynamic";

type ChartEmployee = Pick<
  Employee,
  "id" | "first_name" | "middle_name" | "last_name" | "job_title" | "employment_status" | "employee_number" | "supervisor_employee_id" | "department_id"
>;

export default async function OrgChartPage() {
  await requirePermission("employees.department.view");

  const supabase = await createSupabaseServerClient();
  const [{ data: employeeRows }, departments] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, first_name, middle_name, last_name, job_title, employment_status, employee_number, supervisor_employee_id, department_id",
      )
      .in("employment_status", [...EMPLOYMENT_STATUSES_CURRENT])
      .order("last_name", { ascending: true })
      .returns<ChartEmployee[]>(),
    getDepartmentsWithMeta(),
  ]);

  const employees = employeeRows ?? [];
  const reportTree = buildTree(
    employees.map((employee) => ({ ...employee, parentId: employee.supervisor_employee_id })),
  );
  const departmentTreeRoots = buildTree(
    departments.map((department) => ({ ...department, parentId: department.parent_department_id })),
  );

  const employeesByDepartment = new Map<string, ChartEmployee[]>();
  for (const employee of employees) {
    if (!employee.department_id) continue;
    const bucket = employeesByDepartment.get(employee.department_id) ?? [];
    bucket.push(employee);
    employeesByDepartment.set(employee.department_id, bucket);
  }

  const unassigned = employees.filter((employee) => !employee.department_id);
  const orphaned = employees.filter(
    (employee) => employee.supervisor_employee_id && !employees.some((other) => other.id === employee.supervisor_employee_id),
  );

  return (
    <div>
      <PageHeader
        title="Organisation chart"
        description="Two complementary views of the same data: the department hierarchy, and the reporting lines recorded against each employee. Both are derived from the live records — nothing is drawn from a static diagram."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administration" },
          { label: "Org chart" },
        ]}
      />

      {departments.length === 0 ? (
        <div className="erp-card">
          <EmptyState
            icon={Network}
            title="Nothing to chart yet"
            description="Create departments and employee records, then return to this page."
          />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="erp-card p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Department hierarchy
            </h2>
            <ul className="space-y-2">
              {flattenTree(departmentTreeRoots).map(({ node, depth }) => {
                const members = employeesByDepartment.get(node.id) ?? [];
                return (
                  <li key={node.id} style={{ marginLeft: `${depth * 18}px` }}>
                    <div className="rounded-md border border-border bg-surface px-2.5 py-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-ink">
                          {depth > 0 ? <span aria-hidden className="mr-1 text-ink-subtle">└</span> : null}
                          {node.name}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Badge tone="neutral">{node.code}</Badge>
                          <Badge tone={node.employee_count > 0 ? "info" : "neutral"}>
                            {node.employee_count} staff
                          </Badge>
                        </span>
                      </div>
                      {node.head ? (
                        <p className="mt-0.5 text-[0.6875rem] text-ink-muted">
                          Head: {node.head.first_name} {node.head.last_name}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[0.6875rem] text-pending-700">No department head recorded</p>
                      )}
                      {members.length > 0 ? (
                        <ul className="mt-1 space-y-0.5">
                          {members.slice(0, 6).map((member) => (
                            <li key={member.id} className="text-[0.6875rem] text-ink-muted">
                              <Link href={`/administration/employees/${member.id}`} className="hover:underline">
                                {employeeFullName(member)}
                              </Link>
                              {member.job_title ? ` · ${member.job_title}` : ""}
                            </li>
                          ))}
                          {members.length > 6 ? (
                            <li className="text-[0.625rem] text-ink-subtle">+{members.length - 6} more</li>
                          ) : null}
                        </ul>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="erp-card p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">Reporting lines</h2>
            <ul className="space-y-2">
              {flattenTree(reportTree).map(({ node, depth }) => (
                <li key={node.id} style={{ marginLeft: `${depth * 18}px` }}>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5">
                    <div>
                      <Link
                        href={`/administration/employees/${node.id}`}
                        className="text-xs font-semibold text-ink hover:text-brand-700 hover:underline"
                      >
                        {depth > 0 ? <span aria-hidden className="mr-1 text-ink-subtle">└</span> : null}
                        {employeeFullName(node)}
                      </Link>
                      <p className="text-[0.6875rem] text-ink-subtle">
                        {node.employee_number}
                        {node.job_title ? ` · ${node.job_title}` : ""}
                      </p>
                    </div>
                    <EmploymentStatusBadge status={node.employment_status} />
                  </div>
                </li>
              ))}
            </ul>

            {unassigned.length > 0 ? (
              <p className="mt-3 text-[0.6875rem] text-pending-700">
                {unassigned.length} active employee(s) have no department and are not shown under a unit.
              </p>
            ) : null}
            {orphaned.length > 0 ? (
              <p className="mt-1 text-[0.6875rem] text-pending-700">
                {orphaned.length} employee(s) reference a supervisor who is no longer active in the register; they appear
                at the top of the reporting view.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
