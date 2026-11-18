import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { descendantIds } from "@/lib/organization/tree";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { departmentCreateSchema, departmentDeactivateSchema, departmentUpdateSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/services/authorization";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import { departmentTree, getDepartmentsWithMeta } from "@/services/departments/get-departments";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { Department } from "@/types/database.types";

async function assertParentIsLegal(departmentId: string | null, parentId: string | null): Promise<void> {
  if (!parentId) return;
  if (departmentId && parentId === departmentId) {
    throw new AppError("VALIDATION_ERROR", "A department cannot be its own parent.");
  }
  if (!departmentId) return;

  const rows = await getDepartmentsWithMeta();
  const forbidden = descendantIds(departmentTree(rows), departmentId);
  if (forbidden.includes(parentId)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "That parent would create a loop in the hierarchy. Choose a department outside this branch.",
    );
  }
}

export async function createDepartment(input: unknown, meta: RequestMeta = {}): Promise<Department> {
  const actor = await requirePermission("employees.department.create");
  const payload = departmentCreateSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("departments")
    .insert({
      name: payload.name.trim(),
      code: payload.code,
      description: payload.description?.trim() || null,
      parent_department_id: payload.parentDepartmentId || null,
      department_head_employee_id: payload.departmentHeadEmployeeId || null,
      cost_center_code: payload.costCenterCode?.trim() || null,
      is_active: payload.isActive,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("*")
    .single<Department>();

  if (error) {
    if (error.code === "23505") throw new AppError("CONFLICT", "That department code is already in use.");
    throw new Error(error.message);
  }

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "department.created",
    eventCategory: "employee_management",
    severity: "notice",
    module: "employees",
    entityType: "department",
    entityId: data.id,
    description: `Created department ${data.name} (${data.code}).`,
    newValues: { name: data.name, code: data.code, parent_department_id: data.parent_department_id },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/departments");
  revalidatePath("/administration/org-chart");
  return data;
}

export async function updateDepartment(input: unknown, meta: RequestMeta = {}): Promise<Department> {
  const actor = await requirePermission("employees.department.update");
  const payload = departmentUpdateSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: readError } = await supabase
    .from("departments")
    .select("*")
    .eq("id", payload.id)
    .maybeSingle<Department>();
  if (readError) throw new Error(readError.message);
  if (!existing) throw new AppError("NOT_FOUND", "Department not found.");

  await assertParentIsLegal(payload.id, payload.parentDepartmentId || null);

  const { data, error } = await supabase
    .from("departments")
    .update({
      name: payload.name.trim(),
      code: payload.code,
      description: payload.description?.trim() || null,
      parent_department_id: payload.parentDepartmentId || null,
      department_head_employee_id: payload.departmentHeadEmployeeId || null,
      cost_center_code: payload.costCenterCode?.trim() || null,
      is_active: payload.isActive,
      updated_by: actor.user.id,
    })
    .eq("id", payload.id)
    .select("*")
    .single<Department>();

  if (error) {
    if (error.code === "23505") throw new AppError("CONFLICT", "That department code is already in use.");
    throw new Error(error.message);
  }

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "department.updated",
    eventCategory: "employee_management",
    severity: "info",
    module: "employees",
    entityType: "department",
    entityId: data.id,
    description: `Updated department ${data.name} (${data.code}).`,
    oldValues: {
      name: existing.name,
      parent_department_id: existing.parent_department_id,
      department_head_employee_id: existing.department_head_employee_id,
      is_active: existing.is_active,
    },
    newValues: {
      name: data.name,
      parent_department_id: data.parent_department_id,
      department_head_employee_id: data.department_head_employee_id,
      is_active: data.is_active,
    },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/departments");
  revalidatePath("/administration/org-chart");
  return data;
}

/**
 * Deactivates a department. The database rejects this when the department still has active
 * employees or active child departments, so the hierarchy can never be silently orphaned.
 */
export async function deactivateDepartment(input: unknown, meta: RequestMeta = {}): Promise<Department> {
  const actor = await requirePermission("employees.department.update");
  const payload = departmentDeactivateSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("departments")
    .update({ is_active: false, updated_by: actor.user.id })
    .eq("id", payload.id)
    .select("*")
    .single<Department>();

  if (error) {
    if (error.code === "23514" || error.message.includes("active employees")) {
      throw new AppError(
        "CONFLICT",
        "This department still has active employees or active sub-departments. Reassign them first.",
      );
    }
    throw new Error(error.message);
  }

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "department.deactivated",
    eventCategory: "employee_management",
    severity: "warning",
    module: "employees",
    entityType: "department",
    entityId: data.id,
    description: `Deactivated department ${data.name} (${data.code}). Reason: ${payload.reason}`,
    oldValues: { is_active: true },
    newValues: { is_active: false },
    metadata: { reason: payload.reason },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/departments");
  revalidatePath("/administration/org-chart");
  return data;
}
