import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { employeeCreateSchema, employeeDeactivateSchema, employeeUpdateSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/services/authorization";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import type { Employee } from "@/types/database.types";

export type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

const AUDIT_FIELDS = [
  "first_name",
  "middle_name",
  "last_name",
  "email",
  "phone",
  "department_id",
  "position_id",
  "supervisor_employee_id",
  "job_title",
  "employment_type",
  "employment_status",
  "employee_category",
  "work_location",
  "date_joined",
  "employment_end_date",
] as const;

function snapshot(employee: Employee): Record<string, string | null> {
  const output: Record<string, string | null> = {};
  for (const field of AUDIT_FIELDS) {
    const value = employee[field];
    output[field] = value === undefined ? null : (value as string | null);
  }
  return output;
}

/**
 * Creates an employee record.
 *
 * The employee number is allocated from the central sequence when the caller leaves it blank,
 * so two administrators creating records at the same time cannot collide.
 */
export async function createEmployee(input: unknown, meta: RequestMeta = {}): Promise<Employee> {
  const actor = await requirePermission("employees.employee.create");
  const payload = employeeCreateSchema.parse(input);

  const supabase = await createSupabaseServerClient();

  let employeeNumber = payload.employeeNumber.trim();
  if (!employeeNumber) {
    const { data, error } = await supabase.rpc("next_employee_number");
    if (error) throw new Error(error.message);
    if (!data) throw new AppError("CONFIGURATION_ERROR", "The employee number sequence is not configured.");
    employeeNumber = data;
  }

  if (payload.supervisorId && payload.supervisorId === "") {
    throw new AppError("VALIDATION_ERROR", "Invalid supervisor.");
  }

  const { data, error } = await supabase
    .from("employees")
    .insert({
      employee_number: employeeNumber,
      first_name: payload.firstName.trim(),
      middle_name: payload.middleName?.trim() || null,
      last_name: payload.lastName.trim(),
      email: payload.email?.trim().toLowerCase() || null,
      phone: payload.phone?.trim() || null,
      department_id: payload.departmentId || null,
      position_id: payload.positionId || null,
      supervisor_employee_id: payload.supervisorId || null,
      job_title: payload.jobTitle?.trim() || null,
      employment_type: payload.employmentType,
      employment_status: payload.employmentStatus,
      employee_category: payload.employeeCategory || null,
      work_location: payload.workLocation?.trim() || null,
      notes: payload.notes?.trim() || null,
      date_joined: payload.dateJoined || null,
      employment_end_date: payload.employmentEndDate || null,
      created_by: actor.user.id,
    })
    .select("*")
    .single<Employee>();

  if (error) {
    if (error.code === "23505") {
      throw new AppError("CONFLICT", "That employee number or email is already in use.");
    }
    throw new Error(error.message);
  }

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "employee.created",
    eventCategory: "employee_management",
    severity: "notice",
    module: "employees",
    entityType: "employee",
    entityId: data.id,
    description: `Created employee ${data.employee_number} (${data.first_name} ${data.last_name}).`,
    newValues: snapshot(data),
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/employees");
  return data;
}

export async function updateEmployee(input: unknown, meta: RequestMeta = {}): Promise<Employee> {
  const actor = await requirePermission("employees.employee.update");
  const payload = employeeUpdateSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: readError } = await supabase
    .from("employees")
    .select("*")
    .eq("id", payload.id)
    .maybeSingle<Employee>();

  if (readError) throw new Error(readError.message);
  if (!existing) throw new AppError("NOT_FOUND", "Employee record not found.");

  if (payload.supervisorId && payload.supervisorId === payload.id) {
    throw new AppError("VALIDATION_ERROR", "An employee cannot be their own supervisor.");
  }

  const { data, error } = await supabase
    .from("employees")
    .update({
      first_name: payload.firstName.trim(),
      middle_name: payload.middleName?.trim() || null,
      last_name: payload.lastName.trim(),
      email: payload.email?.trim().toLowerCase() || null,
      phone: payload.phone?.trim() || null,
      department_id: payload.departmentId || null,
      position_id: payload.positionId || null,
      supervisor_employee_id: payload.supervisorId || null,
      job_title: payload.jobTitle?.trim() || null,
      employment_type: payload.employmentType,
      employment_status: payload.employmentStatus,
      employee_category: payload.employeeCategory || null,
      work_location: payload.workLocation?.trim() || null,
      notes: payload.notes?.trim() || null,
      date_joined: payload.dateJoined || null,
      employment_end_date: payload.employmentEndDate || null,
    })
    .eq("id", payload.id)
    .select("*")
    .single<Employee>();

  if (error) throw new Error(error.message);

  const before = snapshot(existing);
  const after = snapshot(data);
  const changed = AUDIT_FIELDS.filter((field) => before[field] !== after[field]);

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "employee.updated",
    eventCategory: "employee_management",
    severity: changed.includes("employment_status") ? "warning" : "info",
    module: "employees",
    entityType: "employee",
    entityId: data.id,
    description: `Updated employee ${data.employee_number} (${changed.length} field${changed.length === 1 ? "" : "s"} changed).`,
    oldValues: Object.fromEntries(changed.map((field) => [field, before[field]])),
    newValues: Object.fromEntries(changed.map((field) => [field, after[field]])),
    metadata: { changed_fields: changed },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/employees");
  revalidatePath(`/administration/employees/${data.id}`);
  return data;
}

/**
 * Deactivates employment. The record is retained (never hard-deleted) so history, approvals and
 * audit references stay intact. The linked ERP account is NOT touched here: account lifecycle
 * is a separate, separately-authorized decision.
 */
export async function deactivateEmployee(input: unknown, meta: RequestMeta = {}): Promise<Employee> {
  const actor = await requirePermission("employees.employee.deactivate");
  const payload = employeeDeactivateSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: readError } = await supabase
    .from("employees")
    .select("*")
    .eq("id", payload.id)
    .maybeSingle<Employee>();
  if (readError) throw new Error(readError.message);
  if (!existing) throw new AppError("NOT_FOUND", "Employee record not found.");
  if (existing.employment_status === "terminated") {
    throw new AppError("CONFLICT", "This employee record is already terminated.");
  }

  const { data, error } = await supabase
    .from("employees")
    .update({
      employment_status: "terminated",
      employment_end_date: payload.employmentEndDate || new Date().toISOString().slice(0, 10),
      deactivated_at: new Date().toISOString(),
    })
    .eq("id", payload.id)
    .select("*")
    .single<Employee>();
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "employee.deactivated",
    eventCategory: "employee_management",
    severity: "critical",
    module: "employees",
    entityType: "employee",
    entityId: data.id,
    description: `Deactivated employment for ${data.employee_number}. Reason: ${payload.reason}`,
    oldValues: { employment_status: existing.employment_status, employment_end_date: existing.employment_end_date },
    newValues: { employment_status: data.employment_status, employment_end_date: data.employment_end_date },
    metadata: { reason: payload.reason },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath("/administration/employees");
  revalidatePath(`/administration/employees/${data.id}`);
  return data;
}
