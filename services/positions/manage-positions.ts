import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { positionCreateSchema, positionUpdateSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/services/authorization";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import type { RequestMeta } from "@/services/employees/manage-employee";
import type { EmployeePosition } from "@/types/database.types";

export type PositionWithMeta = EmployeePosition & {
  department: { id: string; name: string } | null;
  holder_count: number;
};

export async function getPositions(): Promise<PositionWithMeta[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("employee_positions")
    .select("*, department:departments(id, name)")
    .order("title", { ascending: true })
    .returns<(EmployeePosition & { department: { id: string; name: string } | null })[]>();
  if (error) throw new Error(error.message);

  const { data: holders } = await supabase
    .from("employees")
    .select("position_id")
    .in("employment_status", ["active", "probation", "on_leave", "suspended"])
    .returns<{ position_id: string | null }[]>();

  const counts = new Map<string, number>();
  for (const holder of holders ?? []) {
    if (!holder.position_id) continue;
    counts.set(holder.position_id, (counts.get(holder.position_id) ?? 0) + 1);
  }

  return (data ?? []).map((row) => ({ ...row, holder_count: counts.get(row.id) ?? 0 }));
}

export async function createPosition(input: unknown, meta: RequestMeta = {}): Promise<EmployeePosition> {
  const actor = await requirePermission("employees.position.create");
  const payload = positionCreateSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("employee_positions")
    .insert({
      title: payload.title.trim(),
      code: payload.code,
      department_id: payload.departmentId || null,
      grade: payload.grade?.trim() || null,
      description: payload.description?.trim() || null,
      is_active: payload.isActive,
      created_by: actor.user.id,
    })
    .select("*")
    .single<EmployeePosition>();

  if (error) {
    if (error.code === "23505") throw new AppError("CONFLICT", "That position code is already in use.");
    throw new Error(error.message);
  }

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "position.created",
    eventCategory: "employee_management",
    severity: "notice",
    module: "employees",
    entityType: "employee_position",
    entityId: data.id,
    description: `Created position ${data.title} (${data.code}).`,
    newValues: { title: data.title, code: data.code, department_id: data.department_id },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/positions");
  return data;
}

export async function updatePosition(input: unknown, meta: RequestMeta = {}): Promise<EmployeePosition> {
  const actor = await requirePermission("employees.position.update");
  const payload = positionUpdateSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: readError } = await supabase
    .from("employee_positions")
    .select("*")
    .eq("id", payload.id)
    .maybeSingle<EmployeePosition>();
  if (readError) throw new Error(readError.message);
  if (!existing) throw new AppError("NOT_FOUND", "Position not found.");

  const { data, error } = await supabase
    .from("employee_positions")
    .update({
      title: payload.title.trim(),
      code: payload.code,
      department_id: payload.departmentId || null,
      grade: payload.grade?.trim() || null,
      description: payload.description?.trim() || null,
      is_active: payload.isActive,
    })
    .eq("id", payload.id)
    .select("*")
    .single<EmployeePosition>();

  if (error) {
    if (error.code === "23505") throw new AppError("CONFLICT", "That position code is already in use.");
    throw new Error(error.message);
  }

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "position.updated",
    eventCategory: "employee_management",
    severity: "info",
    module: "employees",
    entityType: "employee_position",
    entityId: data.id,
    description: `Updated position ${data.title} (${data.code}).`,
    oldValues: { title: existing.title, code: existing.code, department_id: existing.department_id, is_active: existing.is_active },
    newValues: { title: data.title, code: data.code, department_id: data.department_id, is_active: data.is_active },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/positions");
  return data;
}
