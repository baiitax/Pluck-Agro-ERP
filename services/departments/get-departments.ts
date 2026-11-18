import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildTree, type TreeNode } from "@/lib/organization/tree";
import type { Department } from "@/types/database.types";

export type DepartmentWithMeta = Department & {
  head: { id: string; first_name: string; last_name: string; employee_number: string } | null;
  parent: { id: string; name: string } | null;
  employee_count: number;
};

const SELECT =
  "*, head:employees!departments_department_head_employee_id_fkey(id, first_name, last_name, employee_number), parent:departments!departments_parent_department_id_fkey(id, name)";

export async function getDepartments(): Promise<Department[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("departments")
    .select("*")
    .order("name", { ascending: true })
    .returns<Department[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getDepartmentsWithMeta(): Promise<DepartmentWithMeta[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("departments")
    .select(SELECT)
    .order("name", { ascending: true })
    .returns<DepartmentWithMeta[]>();
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const counts = await getDepartmentHeadcounts();
  return rows.map((row) => ({ ...row, employee_count: counts.get(row.id) ?? 0 }));
}

/** Headcount per department, counting live employment only. */
export async function getDepartmentHeadcounts(): Promise<Map<string, number>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("employees")
    .select("department_id")
    .in("employment_status", ["active", "probation", "on_leave", "suspended"])
    .returns<{ department_id: string | null }[]>();
  if (error) throw new Error(error.message);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.department_id) continue;
    counts.set(row.department_id, (counts.get(row.department_id) ?? 0) + 1);
  }
  return counts;
}

export function departmentTree(rows: DepartmentWithMeta[]): TreeNode<DepartmentWithMeta>[] {
  return buildTree(rows.map((row) => ({ ...row, parentId: row.parent_department_id })));
}
