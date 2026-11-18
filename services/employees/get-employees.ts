import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EMPLOYMENT_STATUSES, type EmploymentStatusValue } from "@/lib/constants/statuses";
import type { Employee } from "@/types/database.types";

function isEmploymentStatus(value: string): value is EmploymentStatusValue {
  return (EMPLOYMENT_STATUSES as readonly string[]).includes(value);
}

export type EmployeeWithDepartment = Employee & {
  department: { id: string; name: string; code: string } | null;
  position: { id: string; title: string; code: string } | null;
};

export type EmployeeQuery = {
  search?: string;
  departmentId?: string;
  positionId?: string;
  status?: string;
  employmentType?: string;
  page?: number;
  pageSize?: number;
};

const SELECT = "*, department:departments(id, name, code), position:employee_positions(id, title, code)";

export async function getEmployees(query: EmployeeQuery = {}): Promise<{
  rows: EmployeeWithDepartment[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, query.pageSize ?? 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = await createSupabaseServerClient();
  let request = supabase
    .from("employees")
    .select(SELECT, { count: "exact" })
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .range(from, to);

  if (query.departmentId) request = request.eq("department_id", query.departmentId);
  if (query.positionId) request = request.eq("position_id", query.positionId);
  if (query.employmentType) request = request.eq("employment_type", query.employmentType);
  if (query.status && isEmploymentStatus(query.status)) {
    request = request.eq("employment_status", query.status);
  }
  if (query.search) {
    const term = query.search.replace(/[%,]/g, " ").trim();
    if (term) {
      request = request.or(
        `first_name.ilike.%${term}%,last_name.ilike.%${term}%,employee_number.ilike.%${term}%,email.ilike.%${term}%`,
      );
    }
  }

  const { data, count, error } = await request.returns<EmployeeWithDepartment[]>();
  if (error) throw new Error(error.message);

  return { rows: data ?? [], total: count ?? 0, page, pageSize };
}

export async function getEmployee(id: string): Promise<EmployeeWithDepartment | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("employees")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle<EmployeeWithDepartment>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Lightweight option list used by supervisor / delegation pickers. */
export async function getEmployeeOptions(): Promise<
  { id: string; employee_number: string; first_name: string; last_name: string; job_title: string | null }[]
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id, employee_number, first_name, last_name, job_title")
    .in("employment_status", ["active", "probation", "on_leave"])
    .order("last_name", { ascending: true })
    .returns<{ id: string; employee_number: string; first_name: string; last_name: string; job_title: string | null }[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function employeeFullName(employee: Pick<Employee, "first_name" | "middle_name" | "last_name">): string {
  return [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(" ");
}
