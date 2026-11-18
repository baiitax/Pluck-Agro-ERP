import "server-only";

import { revalidatePath } from "next/cache";

import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { emergencyContactDeleteSchema, emergencyContactSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/services/authorization";
import { recordAuditEvent } from "@/services/audit/record-audit-event";
import type { EmergencyContact } from "@/types/database.types";
import type { RequestMeta } from "@/services/employees/manage-employee";

export async function addEmergencyContact(input: unknown, meta: RequestMeta = {}): Promise<EmergencyContact> {
  const actor = await requirePermission("employees.employee.update");
  const payload = emergencyContactSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("employee_emergency_contacts")
    .insert({
      employee_id: payload.employeeId,
      contact_name: payload.contactName.trim(),
      relationship: payload.relationship?.trim() || null,
      phone: payload.phone.trim(),
    })
    .select("*")
    .single<EmergencyContact>();
  if (error) throw new Error(error.message);

  // Emergency contact details are personal data: the audit row records the change, not the number.
  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "employee.emergency_contact_added",
    eventCategory: "employee_management",
    severity: "info",
    module: "employees",
    entityType: "employee_emergency_contact",
    entityId: data.id,
    description: `Added an emergency contact for employee ${payload.employeeId}.`,
    metadata: { employee_id: payload.employeeId, relationship: data.relationship },
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath(`/administration/employees/${payload.employeeId}`);
  return data;
}

export async function removeEmergencyContact(input: unknown, meta: RequestMeta = {}): Promise<void> {
  const actor = await requirePermission("employees.employee.update");
  const payload = emergencyContactDeleteSchema.parse(input);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("employee_emergency_contacts").delete().eq("id", payload.id);
  if (error) throw new AppError("DATABASE_ERROR", error.message);

  await recordAuditEvent({
    actorUserId: actor.user.id,
    actorEmployeeId: actor.employee?.id ?? null,
    action: "employee.emergency_contact_removed",
    eventCategory: "employee_management",
    severity: "notice",
    module: "employees",
    entityType: "employee_emergency_contact",
    entityId: payload.id,
    description: `Removed an emergency contact for employee ${payload.employeeId}.`,
    requestId: meta.requestId ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  revalidatePath(`/administration/employees/${payload.employeeId}`);
}
