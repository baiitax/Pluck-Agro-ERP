import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AccountActivity,
  ApprovalAuthority,
  ApprovalDelegation,
  EmergencyContact,
  EmployeeHistoryRow,
  Profile,
  UserRole,
} from "@/types/database.types";
import { getEmployee, type EmployeeWithDepartment } from "@/services/employees/get-employees";

export type EmployeeHistoryEntry = EmployeeHistoryRow & {
  department: { id: string; name: string } | null;
  position: { id: string; title: string } | null;
  supervisor: { id: string; first_name: string; last_name: string } | null;
};

export type EmployeeDetail = {
  employee: EmployeeWithDepartment;
  supervisor: { id: string; first_name: string; last_name: string; employee_number: string } | null;
  subordinates: { id: string; first_name: string; last_name: string; employee_number: string; job_title: string | null }[];
  history: EmployeeHistoryEntry[];
  contacts: EmergencyContact[];
  account:
    | (Profile & {
        assignments: { id: string; role_id: string; is_active: boolean; expires_at: string | null; roles: { code: string; name: string } | null }[];
      })
    | null;
  activity: AccountActivity[];
  authorities: ApprovalAuthority[];
  delegationsOut: ApprovalDelegation[];
  delegationsIn: ApprovalDelegation[];
};

/**
 * Loads everything the employee detail page needs, in one place so the page stays dumb.
 * Every caller must have passed `requirePermission("employees.employee.view")` first; the
 * account-related sections are additionally filtered by RLS.
 */
export async function getEmployeeDetail(id: string): Promise<EmployeeDetail | null> {
  const employee = await getEmployee(id);
  if (!employee) return null;

  const supabase = await createSupabaseServerClient();

  const [supervisorResult, subordinatesResult, historyResult, contactsResult, accountResult, authoritiesResult, outResult, inResult] =
    await Promise.all([
      employee.supervisor_employee_id
        ? supabase
            .from("employees")
            .select("id, first_name, last_name, employee_number")
            .eq("id", employee.supervisor_employee_id)
            .maybeSingle<{ id: string; first_name: string; last_name: string; employee_number: string }>()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("employees")
        .select("id, first_name, last_name, employee_number, job_title")
        .eq("supervisor_employee_id", id)
        .order("last_name", { ascending: true })
        .returns<{ id: string; first_name: string; last_name: string; employee_number: string; job_title: string | null }[]>(),
      supabase
        .from("employee_department_history")
        .select(
          "*, department:departments(id, name), position:employee_positions(id, title), supervisor:employees!employee_department_history_supervisor_employee_id_fkey(id, first_name, last_name)",
        )
        .eq("employee_id", id)
        .order("effective_from", { ascending: false })
        .returns<EmployeeHistoryEntry[]>(),
      supabase
        .from("employee_emergency_contacts")
        .select("*")
        .eq("employee_id", id)
        .order("created_at", { ascending: true })
        .returns<EmergencyContact[]>(),
      supabase
        .from("profiles")
        .select("*, assignments:user_roles(id, role_id, is_active, expires_at, roles(code, name))")
        .eq("employee_id", id)
        .maybeSingle<Profile & { assignments: { id: string; role_id: string; is_active: boolean; expires_at: string | null; roles: { code: string; name: string } | null }[] }>(),
      supabase
        .from("approval_authorities")
        .select("*")
        .eq("employee_id", id)
        .order("created_at", { ascending: false })
        .returns<ApprovalAuthority[]>(),
      supabase
        .from("approval_delegations")
        .select("*")
        .eq("delegator_employee_id", id)
        .order("created_at", { ascending: false })
        .returns<ApprovalDelegation[]>(),
      supabase
        .from("approval_delegations")
        .select("*")
        .eq("delegate_employee_id", id)
        .order("created_at", { ascending: false })
        .returns<ApprovalDelegation[]>(),
    ]);

  const account = accountResult.data ?? null;
  let activity: AccountActivity[] = [];
  if (account) {
    const { data } = await supabase
      .from("account_activity")
      .select("*")
      .eq("user_id", account.id)
      .order("created_at", { ascending: false })
      .limit(25)
      .returns<AccountActivity[]>();
    activity = data ?? [];
  }

  return {
    employee,
    supervisor: supervisorResult.data ?? null,
    subordinates: subordinatesResult.data ?? [],
    history: historyResult.data ?? [],
    contacts: contactsResult.data ?? [],
    account,
    activity,
    authorities: authoritiesResult.data ?? [],
    delegationsOut: outResult.data ?? [],
    delegationsIn: inResult.data ?? [],
  };
}

export type { UserRole };
