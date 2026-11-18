import type { Metadata } from "next";
import Link from "next/link";
import { IdCard, ShieldAlert, UserRoundPlus } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { Pagination } from "@/components/shared/pagination";
import { EmploymentStatusBadge } from "@/components/shared/status-badge";
import { EmployeeFormDialog } from "@/components/forms/employee-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from "@/components/ui/table";
import { EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_LABELS } from "@/lib/constants/statuses";
import { formatDate } from "@/lib/formatting";
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS } from "@/lib/validation/employee.schemas";
import { requirePermission } from "@/services/authorization";
import { getDepartments } from "@/services/departments/get-departments";
import { getEmployeeOptions, getEmployees } from "@/services/employees/get-employees";
import { getPositions } from "@/services/positions/manage-positions";
import type { PageSearchParams } from "@/types/common.types";

export const metadata: Metadata = { title: "Employees" };
export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function EmployeesPage({ searchParams }: { searchParams: PageSearchParams }) {
  // Server-side authorization: independent of the sidebar and of any hidden button.
  const principal = await requirePermission("employees.employee.view");

  const params = await searchParams;
  const search = single(params.search) ?? "";
  const departmentId = single(params.department) ?? "";
  const status = single(params.status) ?? "";
  const employmentType = single(params.employmentType) ?? "";
  const page = Number(single(params.page) ?? "1") || 1;

  const [departments, positions, supervisorOptions, employees] = await Promise.all([
    getDepartments(),
    getPositions(),
    getEmployeeOptions(),
    getEmployees({ search, departmentId, status, employmentType, page, pageSize: 20 }),
  ]);

  const canCreate = principal.permissions.has("employees.employee.create");
  const canUpdate = principal.permissions.has("employees.employee.update");

  const departmentOptions = departments.map((department) => ({
    id: department.id,
    label: `${department.name} (${department.code})`,
  }));
  const positionOptions = positions
    .filter((position) => position.is_active)
    .map((position) => ({ id: position.id, label: `${position.title} (${position.code})` }));
  const supervisorSelectOptions = supervisorOptions.map((employee) => ({
    id: employee.id,
    label: `${employee.first_name} ${employee.last_name} · ${employee.employee_number}`,
  }));

  return (
    <div>
      <PageHeader
        title="Employees"
        description="The employee register. Employment status is tracked separately from ERP account status: a person can be employed without a system login, and a login can outlive employment until it is deactivated."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administration" }, { label: "Employees" }]}
        actions={
          canCreate ? (
            <EmployeeFormDialog
              departments={departmentOptions}
              positions={positionOptions}
              supervisors={supervisorSelectOptions}
              trigger="create"
            />
          ) : null
        }
      />

      <div className="erp-card overflow-hidden">
        <FilterBar
          action="/administration/employees"
          fields={[
            {
              type: "search",
              name: "search",
              label: "Search",
              placeholder: "Name, number or email",
              defaultValue: search,
            },
            {
              type: "select",
              name: "department",
              label: "Department",
              defaultValue: departmentId,
              options: [
                { value: "", label: "All departments" },
                ...departments.map((department) => ({ value: department.id, label: department.name })),
              ],
            },
            {
              type: "select",
              name: "status",
              label: "Employment status",
              defaultValue: status,
              options: [
                { value: "", label: "All statuses" },
                ...EMPLOYMENT_STATUSES.map((value) => ({ value, label: EMPLOYMENT_STATUS_LABELS[value] })),
              ],
            },
            {
              type: "select",
              name: "employmentType",
              label: "Employment type",
              defaultValue: employmentType,
              options: [
                { value: "", label: "All types" },
                ...EMPLOYMENT_TYPES.map((value) => ({ value, label: EMPLOYMENT_TYPE_LABELS[value] })),
              ],
            },
          ]}
        />

        {employees.rows.length === 0 ? (
          <EmptyState
            icon={IdCard}
            title={search || departmentId || status ? "No employees match those filters" : "No employee records yet"}
            description={
              search || departmentId || status
                ? "Adjust the filters, or clear them to see the full register."
                : canCreate
                  ? "Create the first employee record to begin building the staff register."
                  : "An administrator with employees.employee.create permission can add employee records."
            }
            action={
              canCreate && !search ? (
                <EmployeeFormDialog
                  departments={departmentOptions}
                  positions={positionOptions}
                  supervisors={supervisorSelectOptions}
                  trigger="create"
                />
              ) : null
            }
          />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Employee</TH>
                    <TH>Number</TH>
                    <TH>Department</TH>
                    <TH>Job title</TH>
                    <TH>Type</TH>
                    <TH>Status</TH>
                    <TH>Joined</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {employees.rows.map((employee) => (
                    <TR key={employee.id}>
                      <TD>
                        <Link
                          href={`/administration/employees/${employee.id}`}
                          className="text-xs font-semibold text-ink hover:text-brand-700 hover:underline"
                        >
                          {employee.first_name} {employee.middle_name ? `${employee.middle_name} ` : ""}
                          {employee.last_name}
                        </Link>
                        <p className="text-[0.6875rem] text-ink-subtle">{employee.email ?? "No email recorded"}</p>
                      </TD>
                      <TD className="font-mono text-[0.6875rem] text-ink-muted">{employee.employee_number}</TD>
                      <TD className="text-xs">{employee.department?.name ?? "—"}</TD>
                      <TD className="text-xs">{employee.job_title ?? employee.position?.title ?? "—"}</TD>
                      <TD className="text-xs">
                        <Badge tone="neutral">
                          {EMPLOYMENT_TYPE_LABELS[employee.employment_type as keyof typeof EMPLOYMENT_TYPE_LABELS] ??
                            employee.employment_type}
                        </Badge>
                      </TD>
                      <TD>
                        <EmploymentStatusBadge status={employee.employment_status} />
                      </TD>
                      <TD className="text-xs text-ink-muted">{formatDate(employee.date_joined)}</TD>
                      <TD className="text-right">
                        {canUpdate ? (
                          <EmployeeFormDialog
                            departments={departmentOptions}
                            positions={positionOptions}
                            supervisors={supervisorSelectOptions}
                            employee={employee}
                            trigger="edit"
                          />
                        ) : (
                          <Link
                            href={`/administration/employees/${employee.id}`}
                            className="text-[0.6875rem] font-medium text-brand-700 hover:underline"
                          >
                            View
                          </Link>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>

            <Pagination
              page={employees.page}
              pageSize={employees.pageSize}
              total={employees.total}
              baseHref="/administration/employees"
              params={{ search, department: departmentId, status, employmentType }}
            />
          </>
        )}
      </div>

      {!canCreate ? (
        <p className="mt-3 flex items-center gap-1.5 text-[0.6875rem] text-ink-subtle">
          <UserRoundPlus className="size-3.5" aria-hidden />
          You have read-only access to employee records.
        </p>
      ) : null}
      {status === "" && departmentId === "" ? (
        <p className="mt-2 flex items-center gap-1.5 text-[0.6875rem] text-ink-subtle">
          <ShieldAlert className="size-3.5" aria-hidden />
          Filtering by employment status never reveals account access: open an employee to see their ERP account
          separately.
        </p>
      ) : null}
    </div>
  );
}
