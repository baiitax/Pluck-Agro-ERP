import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AccountActivity, AccountStatus, Employee, Profile } from "@/types/database.types";

export type UserAssignments = {
  id: string;
  role_id: string;
  is_active: boolean;
  assigned_at: string;
  expires_at: string | null;
  assigned_by: string | null;
  roles: { code: string; name: string; category: string } | null;
};

export type UserAccountRow = Profile & {
  employee: Pick<
    Employee,
    "id" | "employee_number" | "first_name" | "last_name" | "job_title" | "employment_status" | "department_id"
  > | null;
  assignments: UserAssignments[];
};

const SELECT =
  "*, employee:employees(id, employee_number, first_name, last_name, job_title, employment_status, department_id), assignments:user_roles(id, role_id, is_active, assigned_at, expires_at, assigned_by, roles(code, name, category))";

export type UserQuery = {
  search?: string;
  status?: string;
  roleId?: string;
  /** "none" lists accounts with no active role — the highest-risk configuration. */
  role?: string;
  page?: number;
  pageSize?: number;
};

export async function getUserAccounts(): Promise<UserAccountRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(SELECT)
    .order("created_at", { ascending: true })
    .returns<UserAccountRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getUserAccountsPage(query: UserQuery = {}): Promise<{
  rows: UserAccountRow[];
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
    .from("profiles")
    .select(SELECT, { count: "exact" })
    .order("created_at", { ascending: true })
    .range(from, to);

  if (query.status) request = request.eq("account_status", query.status as AccountStatus);
  if (query.search) {
    const term = query.search.replace(/[%,]/g, " ").trim();
    if (term) request = request.or(`display_name.ilike.%${term}%`);
  }

  const { data, count, error } = await request.returns<UserAccountRow[]>();
  if (error) throw new Error(error.message);

  let rows = data ?? [];

  if (query.roleId) {
    rows = rows.filter((row) => row.assignments.some((assignment) => assignment.role_id === query.roleId && assignment.is_active));
  }
  if (query.role === "none") {
    rows = rows.filter((row) => !row.assignments.some((assignment) => assignment.is_active));
  }

  const filtered = query.roleId || query.role === "none";
  return { rows, total: filtered ? rows.length : (count ?? 0), page, pageSize };
}

export async function getUserAccount(id: string): Promise<UserAccountRow | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle<UserAccountRow>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function getAccountActivityFor(userId: string): Promise<AccountActivity[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("account_activity")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<AccountActivity[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Accounts that can be linked to a new profile (employees without an ERP account). */
export async function getUnlinkedEmployees(): Promise<
  Pick<Employee, "id" | "employee_number" | "first_name" | "last_name" | "email" | "employment_status">[]
> {
  const supabase = await createSupabaseServerClient();
  const [employeesResult, profilesResult] = await Promise.all([
    supabase
      .from("employees")
      .select("id, employee_number, first_name, last_name, email, employment_status")
      .in("employment_status", ["active", "probation", "on_leave"])
      .order("last_name", { ascending: true })
      .returns<
        Pick<Employee, "id" | "employee_number" | "first_name" | "last_name" | "email" | "employment_status">[]
      >(),
    supabase.from("profiles").select("employee_id").returns<{ employee_id: string | null }[]>(),
  ]);

  if (employeesResult.error) throw new Error(employeesResult.error.message);
  if (profilesResult.error) throw new Error(profilesResult.error.message);

  const linked = new Set((profilesResult.data ?? []).map((row) => row.employee_id).filter(Boolean));
  return (employeesResult.data ?? []).filter((employee) => !linked.has(employee.id));
}
